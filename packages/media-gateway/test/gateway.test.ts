import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usd } from "@ys/core";
import { FsAssetStore } from "@ys/storage";
import {
  AllProvidersFailedError,
  BudgetExceededError,
  billing,
  describePrice,
  groupCosts,
  HealthTracker,
  measuredLatency,
  InMemoryLedger,
  MediaGateway,
  hashRequest,
  rankProviders,
  type CostEntry,
  type GenerationRequest,
  type PriceRule,
  type ProviderAdapter,
} from "../src/index.ts";

function fakeProvider(
  id: string,
  opts: { local?: boolean; quality: number; price: PriceRule; fail?: boolean; calls?: string[] },
): ProviderAdapter {
  return {
    id,
    local: opts.local ?? false,
    capabilities: ["t2i", "i2v"],
    limits: { maxDurationSec: 10 },
    qualityPrior: opts.quality,
    price: opts.price,
    async generate() {
      opts.calls?.push(id);
      if (opts.fail) throw new Error(`${id} çöktü`);
      return { files: [{ bytes: new TextEncoder().encode(id), mimeType: "image/png" }] };
    },
  };
}

const img: GenerationRequest = { capability: "t2i", quality: "standard", prompt: "kedi" };

describe("rankProviders", () => {
  const local = fakeProvider("comfy:flux", { local: true, quality: 0.65, price: { unit: "free" } });
  const cheap = fakeProvider("fal:flux", { quality: 0.6, price: { unit: "per_output", usd: 0.025 } });
  const pro = fakeProvider("gemini:pro", { quality: 0.9, price: { unit: "per_output", usd: 0.134 } });

  it("ekonomi seviyesinde yerel (bedava) sağlayıcıyı öne alır", () => {
    const ids = rankProviders([pro, cheap, local], img, { tier: "economy" }).map((r) => r.adapter.id);
    expect(ids[0]).toBe("comfy:flux");
  });

  it("premium seviyede kalite tabanının altındakileri eler", () => {
    const ids = rankProviders([pro, cheap, local], img, { tier: "premium" }).map((r) => r.adapter.id);
    expect(ids).toEqual(["gemini:pro"]);
  });

  it("hero çekimde düşük kaliteli yerel modeli kullanmaz", () => {
    const ids = rankProviders([pro, cheap, local], { ...img, quality: "hero" }, { tier: "economy" }).map(
      (r) => r.adapter.id,
    );
    expect(ids).toEqual(["gemini:pro"]);
  });

  it("useLocal=false yerel sağlayıcıları çıkarır", () => {
    const ids = rankProviders([pro, cheap, local], img, { tier: "economy", useLocal: false }).map((r) => r.adapter.id);
    expect(ids).not.toContain("comfy:flux");
  });

  it("video süresine göre maliyet tahmin eder ve limit dışını eler", () => {
    const veo = fakeProvider("veo", { quality: 0.9, price: { unit: "per_second", usd: 0.4 } });
    const req: GenerationRequest = { capability: "i2v", quality: "standard", durationSec: 5 };
    expect(rankProviders([veo], req, { tier: "standard" })[0]?.estimateMicros).toBe(usd(2));
    expect(rankProviders([veo], { ...req, durationSec: 20 }, { tier: "standard" })).toHaveLength(0);
  });

  it("art arda hata veren sağlayıcıyı soğuma süresince atlar", () => {
    let now = 0;
    const health = new HealthTracker(2, 1000, () => now);
    health.recordFailure("fal:flux");
    health.recordFailure("fal:flux");
    expect(rankProviders([cheap], img, { tier: "economy" }, health)).toHaveLength(0);
    now = 2000;
    expect(rankProviders([cheap], img, { tier: "economy" }, health)).toHaveLength(1);
  });
});

describe("billing", () => {
  it("Kling gibi adımlı faturalamada yukarı yuvarlar (6 sn → 10 sn)", () => {
    const kling = { unit: "per_second", usd: 0.05, stepSec: 5, minSec: 5 } as const;
    const req = (durationSec: number): GenerationRequest => ({ capability: "i2v", quality: "standard", durationSec });
    expect(billing(kling, req(3))).toMatchObject({ units: 5, unitLabel: "sn", micros: usd(0.25) });
    expect(billing(kling, req(5))).toMatchObject({ units: 5 });
    expect(billing(kling, req(6))).toMatchObject({ units: 10, micros: usd(0.5) });
    // Adımsız saniye fiyatı tam saniyeye yuvarlanır.
    expect(billing({ unit: "per_second", usd: 0.025 }, req(4.2)).units).toBe(5);
  });

  it("karakter ve görsel birimlerini raporlar", () => {
    expect(billing({ unit: "per_1k_chars", usd: 0.1 }, { capability: "tts", quality: "standard", text: "a".repeat(2500) })).toEqual({
      units: 2500,
      unitLabel: "karakter",
      micros: usd(0.25),
    });
    expect(describePrice({ unit: "per_second", usd: 0.05, stepSec: 5, minSec: 5 })).toBe("$0.05/sn (5 sn adımlarla), en az 5 sn");
  });
});

describe("maliyet özetleri", () => {
  const e = (over: Partial<CostEntry>): CostEntry => ({
    at: "2026-10-30T00:00:00Z",
    providerId: "p",
    capability: "t2i",
    estimateMicros: usd(0.1),
    cacheHit: false,
    requestHash: "h",
    ...over,
  });

  it("aşamaya göre toplar; önbellek ve hataları ayrı sayar", () => {
    const groups = groupCosts(
      [
        e({ stage: "keyframes", durationMs: 4000, units: 1, unitLabel: "görsel" }),
        e({ stage: "keyframes", durationMs: 6000, units: 1, unitLabel: "görsel" }),
        e({ stage: "keyframes", cacheHit: true, estimateMicros: 0 }),
        e({ stage: "keyframes", error: "429", estimateMicros: 0, durationMs: 900 }),
        e({ stage: "voice", estimateMicros: usd(0.3) }),
      ],
      (x) => x.stage ?? "",
    );
    expect(groups.find((g) => g.key === "keyframes")).toEqual({
      key: "keyframes",
      calls: 2,
      cacheHits: 1,
      failures: 1,
      micros: usd(0.2),
      durationMs: 10_000,
      units: 2,
      unitLabel: "görsel",
    });
  });

  it("sağlayıcı başına ortalama süre; süresi olmayan eski kayıtları atlar", () => {
    expect(
      measuredLatency([e({ durationMs: 3000 }), e({ durationMs: 5000 }), e({}), e({ durationMs: 99_000, error: "x" })]),
    ).toEqual({ p: { avgMs: 4000, n: 2 } });
  });
});

describe("MediaGateway", () => {
  const setup = (providers: ProviderAdapter[]) => {
    const ledger = new InMemoryLedger();
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-gw-")));
    return { ledger, gateway: new MediaGateway({ providers, store, ledger }) };
  };

  it("aynı isteği ikinci kez ödemez (önbellek)", async () => {
    const calls: string[] = [];
    const { gateway, ledger } = setup([
      fakeProvider("fal:flux", { quality: 0.6, price: { unit: "per_output", usd: 0.025 }, calls }),
    ]);
    const run = { policy: { tier: "economy" as const }, episodeId: "ep1" };
    const first = await gateway.generate(img, run);
    const second = await gateway.generate(img, run);
    expect(calls).toEqual(["fal:flux"]);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.files).toEqual(first.files);
    expect(await ledger.spent("ep1")).toBe(usd(0.025));
  });

  it("hata veren sağlayıcıdan sonrakine düşer", async () => {
    const calls: string[] = [];
    const { gateway } = setup([
      fakeProvider("a", { quality: 0.6, price: { unit: "per_output", usd: 0.01 }, fail: true, calls }),
      fakeProvider("b", { quality: 0.6, price: { unit: "per_output", usd: 0.02 }, calls }),
    ]);
    const res = await gateway.generate(img, { policy: { tier: "economy" } });
    expect(calls).toEqual(["a", "b"]);
    expect(res.providerId).toBe("b");
  });

  it("başarılı çağrının süresini/birimini, başarısız denemenin hatasını kaydeder", async () => {
    const { gateway, ledger } = setup([
      fakeProvider("a", { quality: 0.6, price: { unit: "per_output", usd: 0.01 }, fail: true }),
      fakeProvider("b", { quality: 0.6, price: { unit: "per_output", usd: 0.02 } }),
    ]);
    await gateway.generate(img, { policy: { tier: "economy" }, episodeId: "ep", stage: "keyframes", refId: "s1-sh1" });
    const [failed, ok] = ledger.entries;
    expect(failed).toMatchObject({ providerId: "a", error: "a çöktü", estimateMicros: 0, refId: "s1-sh1" });
    expect(ok).toMatchObject({ providerId: "b", units: 1, unitLabel: "görsel", refId: "s1-sh1", estimateMicros: usd(0.02) });
    expect(ok!.durationMs).toBeGreaterThanOrEqual(0);
    expect(await ledger.spent("ep")).toBe(usd(0.02));
  });

  it("hepsi başarısızsa nedenleriyle hata verir", async () => {
    const { gateway } = setup([fakeProvider("a", { quality: 0.6, price: { unit: "free" }, fail: true })]);
    await expect(gateway.generate(img, { policy: { tier: "economy" } })).rejects.toBeInstanceOf(
      AllProvidersFailedError,
    );
  });

  it("bütçe tavanını aşacak sağlayıcıyı atlayıp daha ucuzuna geçer, kalmazsa durur", async () => {
    const calls: string[] = [];
    const { gateway, ledger } = setup([
      fakeProvider("pahali", { quality: 0.95, price: { unit: "per_output", usd: 1 }, calls }),
      fakeProvider("ucuz", { quality: 0.6, price: { unit: "per_output", usd: 0.1 }, calls }),
    ]);
    await ledger.record({
      at: new Date().toISOString(),
      episodeId: "ep2",
      providerId: "x",
      capability: "t2i",
      estimateMicros: usd(0.5),
      cacheHit: false,
      requestHash: "h",
    });
    const run = { policy: { tier: "premium" as const, allow: undefined }, episodeId: "ep2", budgetCapMicros: usd(0.8) };

    // Premium'da sadece "pahali" aday; tavanı aşacağı için bütçe hatası.
    await expect(gateway.generate(img, run)).rejects.toBeInstanceOf(BudgetExceededError);

    const res = await gateway.generate(img, { ...run, policy: { tier: "standard" } });
    expect(res.providerId).toBe("ucuz");
    expect(calls).toEqual(["ucuz"]);
  });

  it("başka sağlayıcı istenince diğerinin önbellek sonucunu döndürmez ve dosyasını ezmez (gerçek denemede bulundu)", async () => {
    const calls: string[] = [];
    const { gateway } = setup([
      fakeProvider("fal:flux", { quality: 0.6, price: { unit: "per_output", usd: 0.025 }, calls }),
      fakeProvider("gemini:nb2", { quality: 0.8, price: { unit: "per_output", usd: 0.067 }, calls }),
    ]);
    const flux = await gateway.generate(img, { policy: { tier: "economy", allow: ["fal:flux"] } });
    const nb2 = await gateway.generate(img, { policy: { tier: "economy", allow: ["gemini:nb2"] } });
    expect(calls).toEqual(["fal:flux", "gemini:nb2"]);
    expect(nb2.cacheHit).toBe(false);
    expect(nb2.files[0]!.key).not.toBe(flux.files[0]!.key);

    // İkisi de artık önbellekte; ikisi de kendi sonucunu alır.
    const again = await gateway.generate(img, { policy: { tier: "economy", allow: ["fal:flux"] } });
    expect(again).toMatchObject({ cacheHit: true, providerId: "fal:flux", files: flux.files });
    expect(calls).toHaveLength(2);
  });

  it("premium bölüm, ucuz modelin önbellekteki sonucunu kullanmaz", async () => {
    const calls: string[] = [];
    const { gateway } = setup([
      fakeProvider("ucuz", { quality: 0.6, price: { unit: "per_output", usd: 0.02 }, calls }),
      fakeProvider("iyi", { quality: 0.9, price: { unit: "per_output", usd: 0.1 }, calls }),
    ]);
    await gateway.generate(img, { policy: { tier: "economy" } });
    const res = await gateway.generate(img, { policy: { tier: "premium" } });
    expect(res).toMatchObject({ providerId: "iyi", cacheHit: false });
    expect(calls).toEqual(["ucuz", "iyi"]);
  });

  it("--no-cache ile yeniden üretim önceki dosyanın üzerine yazmaz", async () => {
    const { gateway } = setup([fakeProvider("a", { quality: 0.6, price: { unit: "free" } })]);
    const first = await gateway.generate(img, { policy: { tier: "economy" } });
    const second = await gateway.generate(img, { policy: { tier: "economy" }, noCache: true });
    expect(second.files[0]!.key).not.toBe(first.files[0]!.key);
  });

  it("referans içeriği değişince hash değişir, aynıysa değişmez", () => {
    const ref = (b: number) => ({ role: "character" as const, mimeType: "image/png", bytes: new Uint8Array([b]) });
    const a = hashRequest({ ...img, refs: [ref(1)] });
    expect(hashRequest({ ...img, refs: [ref(1)] })).toBe(a);
    expect(hashRequest({ ...img, refs: [ref(2)] })).not.toBe(a);
    expect(hashRequest({ prompt: "kedi", quality: "standard", capability: "t2i" })).toBe(hashRequest(img));
  });
});
