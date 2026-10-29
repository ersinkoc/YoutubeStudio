import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usd } from "@ys/core";
import { FsAssetStore } from "@ys/storage";
import {
  AllProvidersFailedError,
  BudgetExceededError,
  HealthTracker,
  InMemoryLedger,
  MediaGateway,
  hashRequest,
  rankProviders,
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
