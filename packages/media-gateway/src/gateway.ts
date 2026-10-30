import { createHash, randomBytes } from "node:crypto";
import { formatUsd, type Micros, type WordTiming } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import type { CostLedger } from "./ledger.ts";
import { billing } from "./pricing.ts";
import { HealthTracker, rankProviders, type RankedProvider, type RoutePolicy } from "./router.ts";
import { ContentRejectedError, type GenerationRequest, type ProviderAdapter, type Quota } from "./types.ts";

export class NoProviderError extends Error {}
export class BudgetExceededError extends Error {}
export class AllProvidersFailedError extends Error {
  constructor(readonly failures: { providerId: string; error: unknown }[]) {
    super(
      `Tüm sağlayıcılar başarısız: ${failures
        .map((f) => `${f.providerId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
        .join(" | ")}`,
    );
  }
}

export interface StoredFile {
  key: string;
  uri: string;
  mimeType: string;
}

export interface GeneratedAsset {
  requestHash: string;
  providerId: string;
  files: StoredFile[];
  words?: WordTiming[];
  costMicros: Micros;
  cacheHit: boolean;
}

export interface RunOptions {
  policy: RoutePolicy;
  episodeId?: string;
  stage?: string;
  /** Bölüm harcama tavanı; aşılacaksa daha ucuz adaya geçilir, kalmazsa hata. */
  budgetCapMicros?: Micros;
  /** true: önbelleği atla (ör. reddedilen bir üretimi yeniden denemek için). */
  noCache?: boolean;
  /** Maliyet kaydında çağrının ait olduğu çekim/sahne/varlık. */
  refId?: string;
  signal?: AbortSignal;
}

export interface GatewayOptions {
  providers: ProviderAdapter[];
  store: AssetStore;
  ledger: CostLedger;
  fetch?: typeof fetch;
  health?: HealthTracker;
  log?: (message: string) => void;
}

interface CacheEntry {
  providerId: string;
  files: StoredFile[];
  words?: WordTiming[];
}

/** Aynı istek farklı sağlayıcılarla üretilmiş olabilir; her biri ayrı saklanır. */
interface CacheManifest {
  entries: Record<string, CacheEntry>;
}

/** Eski (tek sağlayıcılı) önbellek kayıtlarını yeni biçime çevirir. */
function normalizeManifest(raw: CacheManifest | CacheEntry | null): CacheManifest {
  if (!raw) return { entries: {} };
  if ("entries" in raw) return raw;
  return { entries: { [raw.providerId]: raw } };
}

/** Sağlayıcı kimliğini dosya yoluna güvenli parçaya çevirir ("fal:flux-dev" → "fal_flux-dev"). */
const providerSlug = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, "_");

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

/** İsteğin içerik hash'i; referans görseller kendi hash'leriyle temsil edilir. */
export function hashRequest(req: GenerationRequest): string {
  const canonical = {
    ...req,
    refs: req.refs?.map((r) => ({
      role: r.role,
      mimeType: r.mimeType,
      sha256: createHash("sha256").update(r.bytes).digest("hex"),
    })),
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class MediaGateway {
  private readonly fetchFn: typeof fetch;
  private readonly health: HealthTracker;
  private readonly log: (message: string) => void;

  constructor(private readonly opts: GatewayOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.health = opts.health ?? new HealthTracker();
    this.log = opts.log ?? (() => {});
  }

  get providers(): readonly ProviderAdapter[] {
    return this.opts.providers;
  }

  /** Sağlayıcının kalan hesap kotası; desteklemiyorsa veya sorgu başarısızsa undefined. */
  async quota(providerId: string): Promise<Quota | undefined> {
    const adapter = this.opts.providers.find((p) => p.id === providerId);
    if (!adapter?.quota) return undefined;
    try {
      return await adapter.quota({ fetch: this.fetchFn });
    } catch (e) {
      this.log(`kota sorgulanamadı: ${providerId}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  /** Para harcamadan hangi sağlayıcıların hangi sırayla deneneceğini gösterir. */
  plan(req: GenerationRequest, policy: RoutePolicy): RankedProvider[] {
    return rankProviders(this.opts.providers, req, policy, this.health);
  }

  async generate(req: GenerationRequest, run: RunOptions): Promise<GeneratedAsset> {
    const requestHash = hashRequest(req);
    const manifestKey = `cache/${requestHash}.json`;
    const { store, ledger } = this.opts;

    const manifest = normalizeManifest(await getJson<CacheManifest | CacheEntry>(store, manifestKey));

    if (!run.noCache) {
      // Önbellekteki sonuç ancak bu politikanın seçebileceği bir sağlayıcıdan geliyorsa kullanılır
      // (ör. --provider ile başka model istendiyse veya premium bölümde ucuz model sonucu varsa kullanılmaz).
      // Sağlık durumu dikkate alınmaz: soğumadaki sağlayıcının eski sonucu hâlâ geçerlidir.
      const acceptable = rankProviders(this.opts.providers, req, run.policy).map((r) => r.adapter.id);
      const cachedId = acceptable.find((id) => manifest.entries[id]);
      const cached = cachedId ? manifest.entries[cachedId] : undefined;
      if (cached) {
        this.log(`önbellek: ${requestHash.slice(0, 12)} (${cached.providerId})`);
        await ledger.record({
          at: new Date().toISOString(),
          episodeId: run.episodeId,
          stage: run.stage,
          refId: run.refId,
          providerId: cached.providerId,
          capability: req.capability,
          estimateMicros: 0,
          cacheHit: true,
          requestHash,
        });
        return { requestHash, ...cached, costMicros: 0, cacheHit: true };
      }
    }

    const candidates = this.plan(req, run.policy);
    if (candidates.length === 0) {
      throw new NoProviderError(
        `"${req.capability}" (${req.quality}, ${run.policy.tier}) için uygun sağlayıcı yok`,
      );
    }

    const failures: { providerId: string; error: unknown }[] = [];
    let skippedForBudget = 0;

    for (const { adapter, estimateMicros } of candidates) {
      const bill = billing(adapter.price, req);
      if (run.budgetCapMicros !== undefined && run.episodeId) {
        const spent = await ledger.spent(run.episodeId);
        if (spent + estimateMicros > run.budgetCapMicros) {
          this.log(`bütçe: ${adapter.id} atlandı (${formatUsd(spent)} + ${formatUsd(estimateMicros)})`);
          skippedForBudget++;
          continue;
        }
      }

      const startedAt = Date.now();
      try {
        this.log(`üretiliyor: ${adapter.id} ~${formatUsd(estimateMicros)}`);
        const result = await adapter.generate(req, {
          fetch: this.fetchFn,
          signal: run.signal,
          onProgress: (m) => this.log(`${adapter.id}: ${m}`),
        });
        if (result.files.length === 0) throw new Error("Sağlayıcı dosya döndürmedi");
        this.health.recordSuccess(adapter.id);

        // Her üretim kendi klasörüne yazılır: başka sağlayıcının veya önceki üretimin
        // (başka bir bölümün referans verdiği) dosyası asla ezilmez.
        const generationDir = `assets/${requestHash}/${providerSlug(adapter.id)}-${randomBytes(4).toString("hex")}`;
        const files: StoredFile[] = [];
        for (const [i, file] of result.files.entries()) {
          const key = `${generationDir}/${i}.${EXTENSIONS[file.mimeType] ?? "bin"}`;
          files.push({ key, uri: await store.put(key, file.bytes, file.mimeType), mimeType: file.mimeType });
        }
        const entry: CacheEntry = { providerId: adapter.id, files, words: result.words };
        manifest.entries[adapter.id] = entry;
        await putJson(store, manifestKey, manifest);
        await ledger.record({
          at: new Date().toISOString(),
          episodeId: run.episodeId,
          stage: run.stage,
          refId: run.refId,
          providerId: adapter.id,
          capability: req.capability,
          estimateMicros,
          cacheHit: false,
          requestHash,
          durationMs: Date.now() - startedAt,
          units: bill.units,
          unitLabel: bill.unitLabel,
        });
        return { requestHash, ...entry, costMicros: estimateMicros, cacheHit: false };
      } catch (error) {
        if (run.signal?.aborted) throw error;
        // İçerik reddi sağlayıcı arızası değildir; sayılırsa birkaç ret tüm sağlayıcıyı kapatır (30 Eki).
        if (!(error instanceof ContentRejectedError)) this.health.recordFailure(adapter.id);
        const message = error instanceof Error ? error.message : String(error);
        this.log(`hata: ${adapter.id}: ${message}`);
        failures.push({ providerId: adapter.id, error });
        // Başarısız deneme de kayda geçer: hangi sağlayıcı ne kadar süre sonra neden düştü görünsün.
        await ledger.record({
          at: new Date().toISOString(),
          episodeId: run.episodeId,
          stage: run.stage,
          refId: run.refId,
          providerId: adapter.id,
          capability: req.capability,
          estimateMicros: 0,
          cacheHit: false,
          requestHash,
          durationMs: Date.now() - startedAt,
          error: message.slice(0, 300),
        });
      }
    }

    if (failures.length === 0 && skippedForBudget > 0) {
      throw new BudgetExceededError(`Bölüm ${run.episodeId} bütçe tavanını aşacak; onay gerekli`);
    }
    throw new AllProvidersFailedError(failures);
  }
}
