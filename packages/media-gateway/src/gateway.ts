import { createHash, randomBytes } from "node:crypto";
import { formatUsd, type Micros, type WordTiming } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import type { CostLedger } from "./ledger.ts";
import { billing } from "./pricing.ts";
import { HealthTracker, rankProviders, type RankedProvider, type RoutePolicy } from "./router.ts";
import { ContentRejectedError, SubmittedJobError, type GenerationRequest, type ProviderAdapter, type Quota } from "./types.ts";

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
  /** Bölüm başına süren (henüz deftere yazılmamış) üretimlerin tahmini. */
  private readonly reserved = new Map<string, number>();
  /** Bölüm başına bütçe sırası (bkz. budgetTurn). */
  private readonly budgetQueue = new Map<string, Promise<unknown>>();

  /**
   * Bütçe kontrolü + rezervasyon ile defter kaydı + rezervasyonu bırakma birbirinin arasına girmesin: yoksa kontrol
   * defteri okurken biten bir çağrı hem deftere yazıp hem rezervasyonunu bırakabilir ve o tutar hiç sayılmaz.
   */
  private async budgetTurn<T>(episode: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!episode) return fn();
    const turn = (this.budgetQueue.get(episode) ?? Promise.resolve()).then(fn);
    const tail = turn.catch(() => {});
    this.budgetQueue.set(episode, tail);
    try {
      return await turn;
    } finally {
      if (this.budgetQueue.get(episode) === tail) this.budgetQueue.delete(episode);
    }
  }

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
      // Paralel çağrılar aynı anda "tavanın altında" görmesin: süren çağrıların tahmini de sayılır (rezervasyon).
      const episode = run.episodeId;
      const fits = await this.budgetTurn(episode, async () => {
        if (run.budgetCapMicros !== undefined && episode) {
          const spent = (await ledger.spent(episode)) + (this.reserved.get(episode) ?? 0);
          if (spent + estimateMicros > run.budgetCapMicros) {
            this.log(`bütçe: ${adapter.id} atlandı (${formatUsd(spent)} + ${formatUsd(estimateMicros)})`);
            return false;
          }
        }
        if (episode) this.reserved.set(episode, (this.reserved.get(episode) ?? 0) + estimateMicros);
        return true;
      });
      if (!fits) {
        skippedForBudget++;
        continue;
      }
      let held = true;
      const release = () => {
        if (!episode || !held) return;
        held = false;
        const left = (this.reserved.get(episode) ?? 0) - estimateMicros;
        if (left > 0) this.reserved.set(episode, left);
        else this.reserved.delete(episode);
      };

      const startedAt = Date.now();
      let result: Awaited<ReturnType<typeof adapter.generate>>;
      try {
        this.log(`üretiliyor: ${adapter.id} ~${formatUsd(estimateMicros)}`);
        result = await adapter.generate(req, {
          fetch: this.fetchFn,
          signal: run.signal,
          onProgress: (m) => this.log(`${adapter.id}: ${m}`),
        });
        if (result.files.length === 0) throw new Error("Sağlayıcı dosya döndürmedi");
        this.health.recordSuccess(adapter.id);
      } catch (error) {
        // İş kabul edildikten sonra düştü: sağlayıcı büyük olasılıkla ücretlendirdi. Tahmin deftere yazılır (tavan doğru
        // kalsın) ve başka sağlayıcıya geçilmez (aynı varlık ikinci kez ödenmesin); hata yukarı çıkar. Rezervasyon
        // ancak defter kaydından sonra bırakılır.
        if (error instanceof SubmittedJobError) {
          this.health.recordFailure(adapter.id);
          const message = error.message;
          this.log(`hata (ücretlendirilmiş olabilir): ${adapter.id}: ${message}`);
          try {
            await this.budgetTurn(episode, async () => {
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
                error: message.slice(0, 300),
              });
              release();
            });
          } finally {
            release();
          }
          throw error;
        }
        // Çıktı filtreye takıldı ama üretim ücretlendi (ör. fal NSFW → siyah görsel): tahmin deftere yazılır, rezervasyon
        // kayıtla aynı sırada bırakılır; yine de başka sağlayıcı denenir (içerik reddi sağlayıcı arızası değil).
        if (run.signal?.aborted) {
          release();
          throw error;
        }
        const billed = error instanceof ContentRejectedError && error.billed;
        if (!billed) release();
        // İçerik reddi sağlayıcı arızası değildir; sayılırsa birkaç ret tüm sağlayıcıyı kapatır (30 Eki).
        if (!(error instanceof ContentRejectedError)) this.health.recordFailure(adapter.id);
        const message = error instanceof Error ? error.message : String(error);
        this.log(`hata${billed ? " (ücretlendi)" : ""}: ${adapter.id}: ${message}`);
        failures.push({ providerId: adapter.id, error });
        // Başarısız deneme de kayda geçer: hangi sağlayıcı ne kadar süre sonra neden düştü görünsün.
        const record = () =>
          ledger.record({
            at: new Date().toISOString(),
            episodeId: run.episodeId,
            stage: run.stage,
            refId: run.refId,
            providerId: adapter.id,
            capability: req.capability,
            estimateMicros: billed ? estimateMicros : 0,
            cacheHit: false,
            requestHash,
            durationMs: Date.now() - startedAt,
            error: message.slice(0, 300),
          });
        if (billed) {
          try {
            await this.budgetTurn(episode, async () => {
              await record();
              release();
            });
          } finally {
            release();
          }
        } else {
          await record();
        }
        continue;
      }

      // Üretim ödendi: buradan sonraki depo/defter hataları sağlayıcı arızası sayılmaz ve başka sağlayıcıya
      // yeniden ödetilmez; hata yukarı çıkar (aynı istek tekrar çalışınca önbellek ya da yeni üretim karar verir).
      try {
        // Önce defter: dosya yazımı başarısız olsa da ödenen üretim tavana sayılır. Kayıt ve rezervasyonun bırakılması
        // aynı sırada: arada bir bütçe kontrolü tutarı iki yerde de göremez.
        await this.budgetTurn(episode, async () => {
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
          release();
        });
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
        return { requestHash, ...entry, costMicros: estimateMicros, cacheHit: false };
      } finally {
        release();
      }
    }

    // Bir sağlayıcı düştü, kalanlar bütçe yüzünden atlandıysa da kullanıcıya bütçe onayı sorulmalı.
    if (skippedForBudget > 0) {
      const tried = failures.length
        ? ` (başarısız: ${failures.map((f) => `${f.providerId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`).join("; ")})`
        : "";
      throw new BudgetExceededError(`Bölüm ${run.episodeId} bütçe tavanını aşacak; onay gerekli${tried}`);
    }
    throw new AllProvidersFailedError(failures);
  }
}
