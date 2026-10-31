import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usd } from "@ys/core";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import {
  AllProvidersFailedError,
  BudgetExceededError,
  ContentRejectedError,
  HealthTracker,
  InMemoryLedger,
  MediaGateway,
  NoProviderError,
  hashRequest,
  type GenerationRequest,
  type GenerationResult,
  type ProviderAdapter,
} from "../src/index.ts";

const img: GenerationRequest = { capability: "t2i", quality: "standard", prompt: "kedi" };

function provider(id: string, over: Partial<ProviderAdapter> & { usd?: number } = {}): ProviderAdapter {
  return {
    id,
    local: false,
    capabilities: ["t2i"],
    limits: {},
    qualityPrior: 0.7,
    price: { unit: "per_output", usd: over.usd ?? 0.1 },
    generate: async () => ({ files: [{ bytes: new Uint8Array([1]), mimeType: "image/png" }] }),
    ...over,
  };
}

const tempStore = () => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-gwx-")));

function setup(providers: ProviderAdapter[], store: AssetStore = tempStore()) {
  const ledger = new InMemoryLedger();
  const logs: string[] = [];
  const gateway = new MediaGateway({ providers, store, ledger, log: (m) => logs.push(m) });
  return { gateway, ledger, logs, store };
}

describe("MediaGateway.quota", () => {
  it("sağlayıcı yoksa veya kota desteklemiyorsa undefined", async () => {
    const { gateway } = setup([provider("a")]);
    expect(await gateway.quota("yok")).toBeUndefined();
    expect(await gateway.quota("a")).toBeUndefined();
  });

  it("kotayı enjekte edilen fetch ile sorar", async () => {
    const fakeFetch = (async () => new Response("")) as typeof fetch;
    let gotFetch: unknown;
    const a = provider("a", {
      quota: async (ctx) => {
        gotFetch = ctx.fetch;
        return { unit: "chars", used: 1, limit: 10 };
      },
    });
    const gateway = new MediaGateway({ providers: [a], store: tempStore(), ledger: new InMemoryLedger(), fetch: fakeFetch });
    expect(await gateway.quota("a")).toEqual({ unit: "chars", used: 1, limit: 10 });
    expect(gotFetch).toBe(fakeFetch);
    expect(gateway.providers).toEqual([a]);
  });

  it("sorgu hatasını loglayıp undefined döndürür (Error ve düz değer)", async () => {
    const { gateway, logs } = setup([
      provider("a", { quota: async () => Promise.reject(new Error("401")) }),
      provider("b", { quota: async () => Promise.reject("zaman aşımı") }),
    ]);
    expect(await gateway.quota("a")).toBeUndefined();
    expect(await gateway.quota("b")).toBeUndefined();
    expect(logs).toEqual(["kota sorgulanamadı: a: 401", "kota sorgulanamadı: b: zaman aşımı"]);
  });

  it("log verilmezse sessizce yutar", async () => {
    const gateway = new MediaGateway({
      providers: [provider("a", { quota: async () => Promise.reject(new Error("x")) })],
      store: tempStore(),
      ledger: new InMemoryLedger(),
    });
    expect(await gateway.quota("a")).toBeUndefined();
  });
});

describe("MediaGateway.generate kenar durumları", () => {
  it("uygun sağlayıcı yoksa NoProviderError", async () => {
    const { gateway } = setup([provider("a")]);
    await expect(gateway.generate({ ...img, capability: "i2v" }, { policy: { tier: "economy" } })).rejects.toThrow(NoProviderError);
    await expect(gateway.generate({ ...img, capability: "i2v" }, { policy: { tier: "economy" } })).rejects.toThrow(
      '"i2v" (standard, economy) için uygun sağlayıcı yok',
    );
  });

  it("boş dosya listesi hata sayılır ve sonraki sağlayıcıya geçilir", async () => {
    const { gateway, ledger } = setup([
      provider("bos", { usd: 0.01, generate: async () => ({ files: [] }) }),
      provider("dolu", { usd: 0.05 }),
    ]);
    const res = await gateway.generate(img, { policy: { tier: "ultra" } });
    expect(res.providerId).toBe("dolu");
    expect(ledger.entries[0]).toMatchObject({ providerId: "bos", error: "Sağlayıcı dosya döndürmedi", estimateMicros: 0 });
  });

  it("Error olmayan hata da nedeniyle raporlanır; hata mesajı 300 karakterle kırpılır", async () => {
    const { gateway, ledger, logs } = setup([
      provider("a", { generate: async () => Promise.reject("düz metin hata") }),
      provider("b", { generate: async () => Promise.reject(new Error("u".repeat(400))) }),
    ]);
    const err = (await gateway.generate(img, { policy: { tier: "economy" } }).catch((e: unknown) => e)) as AllProvidersFailedError;
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect(err.failures.map((f) => f.providerId).sort()).toEqual(["a", "b"]);
    expect(err.message).toContain("a: düz metin hata");
    expect(ledger.entries.find((e) => e.providerId === "b")!.error).toHaveLength(300);
    expect(logs).toContain("hata: a: düz metin hata");
  });

  it("çağrı iptal edildiyse başka sağlayıcıya geçmeden hatayı fırlatır", async () => {
    const ac = new AbortController();
    const calls: string[] = [];
    const { gateway } = setup([
      provider("a", {
        usd: 0.01,
        generate: async (_req, ctx) => {
          calls.push("a");
          expect(ctx.signal).toBe(ac.signal);
          ac.abort();
          throw new Error("iptal");
        },
      }),
      provider("b", { usd: 0.05, generate: async () => (calls.push("b"), { files: [] }) }),
    ]);
    await expect(gateway.generate(img, { policy: { tier: "ultra" }, signal: ac.signal })).rejects.toThrow("iptal");
    expect(calls).toEqual(["a"]);
  });

  it("ilerleme mesajlarını sağlayıcı önekiyle loglar; bilinmeyen tür .bin, kelimeler önbelleğe girer", async () => {
    const words = [{ text: "selam", startMs: 0, endMs: 300 }];
    const { gateway, logs } = setup([
      provider("fal:x", {
        generate: async (_r, ctx) => {
          ctx.onProgress?.("kuyrukta");
          return {
            files: [
              { bytes: new Uint8Array([1]), mimeType: "application/x-ozel" },
              { bytes: new Uint8Array([2]), mimeType: "audio/mpeg" },
            ],
            words,
          };
        },
      }),
    ]);
    const res = await gateway.generate(img, { policy: { tier: "economy" } });
    expect(logs).toContain("fal:x: kuyrukta");
    expect(res.files[0]!.key).toMatch(new RegExp(`^assets/${res.requestHash}/fal_x-[0-9a-f]{8}/0\\.bin$`));
    expect(res.files[1]!.key).toMatch(/\/1\.mp3$/);
    expect(res.words).toEqual(words);
    const cached = await gateway.generate(img, { policy: { tier: "economy" } });
    expect(cached).toMatchObject({ cacheHit: true, words, costMicros: 0 });
    expect(logs.some((l) => l.startsWith(`önbellek: ${res.requestHash.slice(0, 12)} (fal:x)`))).toBe(true);
  });

  it("eski tek sağlayıcılı önbellek kaydını okur", async () => {
    const store = tempStore();
    const files = [{ key: "assets/eski/0.png", uri: "file://eski", mimeType: "image/png" }];
    await putJson(store, `cache/${hashRequest(img)}.json`, { providerId: "a", files });
    const calls: string[] = [];
    const { gateway, ledger } = setup([provider("a", { generate: async () => (calls.push("a"), { files: [] }) })], store);
    const res = await gateway.generate(img, { policy: { tier: "economy" }, episodeId: "e", stage: "kf", refId: "r" });
    expect(res).toEqual({ requestHash: hashRequest(img), providerId: "a", files, costMicros: 0, cacheHit: true });
    expect(calls).toEqual([]);
    expect(ledger.entries[0]).toMatchObject({ cacheHit: true, estimateMicros: 0, episodeId: "e", stage: "kf", refId: "r" });
  });

  it("yeni üretim eski biçimli kaydı yeni biçime taşır", async () => {
    const store = tempStore();
    const key = `cache/${hashRequest(img)}.json`;
    await putJson(store, key, { providerId: "eski", files: [] });
    const { gateway } = setup([provider("yeni")], store);
    await gateway.generate(img, { policy: { tier: "economy" } });
    const manifest = await getJson<{ entries: Record<string, unknown> }>(store, key);
    expect(Object.keys(manifest!.entries).sort()).toEqual(["eski", "yeni"]);
  });

  it("ödenmiş üretimden sonra depo hatası başka sağlayıcıya geçmez; defter kaydı ve rezervasyon temizlenir", async () => {
    const real: AssetStore = tempStore();
    let fail = true;
    const store: AssetStore = {
      get: (k) => real.get(k),
      list: (p) => real.list(p),
      put: async (k, b, m) => {
        if (fail && k.startsWith("assets/")) throw new Error("disk dolu");
        return real.put(k, b, m);
      },
    };
    const calls: string[] = [];
    const { gateway, ledger } = setup(
      [
        provider("a", { usd: 0.3, generate: async () => (calls.push("a"), { files: [{ bytes: new Uint8Array([1]), mimeType: "image/png" }] }) }),
        provider("b", { usd: 0.4, generate: async () => (calls.push("b"), { files: [{ bytes: new Uint8Array([1]), mimeType: "image/png" }] }) }),
      ],
      store,
    );
    const run = { policy: { tier: "ultra" as const }, episodeId: "ep", budgetCapMicros: usd(0.65) };
    await expect(gateway.generate(img, run)).rejects.toThrow("disk dolu");
    expect(calls).toEqual(["a"]);
    expect(await ledger.spent("ep")).toBe(usd(0.3));
    // Rezervasyon bırakıldı: kalan bütçe yalnız deftere göre hesaplanır (0.3 + 0.3 ≤ 0.65).
    fail = false;
    const res = await gateway.generate({ ...img, prompt: "köpek" }, run);
    expect(res.providerId).toBe("a");
  });

  it("paralel çağrılar süren çağrının tahminini rezerve sayar", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    let n = 0;
    const slow = provider("a", {
      usd: 0.5,
      generate: async (): Promise<GenerationResult> => {
        if (n++ === 0) await gate;
        return { files: [{ bytes: new Uint8Array([n]), mimeType: "image/png" }] };
      },
    });
    const { gateway, logs } = setup([slow]);
    const run = { policy: { tier: "economy" as const }, episodeId: "ep", budgetCapMicros: usd(0.8) };
    const first = gateway.generate(img, run);
    // İlk çağrı sağlayıcıya ulaşana kadar bekle.
    while (n === 0) await new Promise((r) => setImmediate(r));
    // İlk çağrı sürerken 0.5 rezerve; ikinci 0.5 tavanı (0.8) aşar.
    const err = await gateway.generate({ ...img, prompt: "ikinci" }, run).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toBe("Bölüm ep bütçe tavanını aşacak; onay gerekli");
    expect(logs).toContain("bütçe: a atlandı ($0.5000 + $0.5000)");
    releaseFirst();
    expect((await first).providerId).toBe("a");
  });

  it("iki süren çağrıdan biri bitince diğerinin rezervasyonu korunur, ikisi bitince boşalır", async () => {
    // Kapılar isteğin prompt'uyla anahtarlanır: hangi çağrının sağlayıcıya önce ulaşacağı yüke bağlı.
    const gates = new Map<string, () => void>();
    const gated = (id: string, usdPrice: number) =>
      provider(id, {
        usd: usdPrice,
        generate: async (req) => {
          await new Promise<void>((r) => gates.set(req.prompt!, r));
          return { files: [{ bytes: new Uint8Array([gates.size]), mimeType: "image/png" }] };
        },
      });
    const { gateway } = setup([gated("a", 0.5)]);
    const run = { policy: { tier: "economy" as const }, episodeId: "ep", budgetCapMicros: usd(1.2) };
    const p1 = gateway.generate({ ...img, prompt: "1" }, run);
    const p2 = gateway.generate({ ...img, prompt: "2" }, run);
    while (gates.size < 2) await new Promise((r) => setImmediate(r));
    gates.get("1")!();
    await p1;
    // Defter 0.5 + süren çağrının rezervasyonu 0.5 + yeni 0.5 > 1.2.
    await expect(gateway.generate({ ...img, prompt: "3" }, run)).rejects.toBeInstanceOf(BudgetExceededError);
    gates.get("2")!();
    await p2;
    // Rezervasyon bitti; defter 1.0 + 0.5 yine aşar, ama tavan 1.5 iken sığar.
    const p4 = gateway.generate({ ...img, prompt: "4" }, { ...run, budgetCapMicros: usd(1.5) });
    while (gates.size < 3) await new Promise((r) => setImmediate(r));
    gates.get("4")!();
    expect((await p4).costMicros).toBe(usd(0.5));
  });

  it("defter yazımı hata verirse hata yukarı çıkar, rezervasyon bırakılır ve bütçe sırası tıkanmaz", async () => {
    const ledger = new InMemoryLedger();
    const realRecord = ledger.record.bind(ledger);
    let failNext = true;
    ledger.record = async (entry) => {
      if (failNext) {
        failNext = false;
        throw new Error("defter yazılamadı");
      }
      return realRecord(entry);
    };
    const gateway = new MediaGateway({ providers: [provider("a", { usd: 0.5 })], store: tempStore(), ledger, log: () => {} });
    const run = { policy: { tier: "economy" as const }, episodeId: "ep", budgetCapMicros: usd(0.7) };
    await expect(gateway.generate({ ...img, prompt: "1" }, run)).rejects.toThrow("defter yazılamadı");
    // Rezervasyon kalsaydı 0.5 + 0.5 > 0.7 olurdu; sıra tıkansaydı bu çağrı hiç bitmezdi.
    expect((await gateway.generate({ ...img, prompt: "2" }, run)).costMicros).toBe(usd(0.5));
  });

  it("bütçe kontrolü defteri okurken biten çağrının tutarı kaybolmaz (kayıt ve rezervasyon bırakma sırayı bekler)", async () => {
    const gates = new Map<string, () => void>();
    const a = provider("a", {
      usd: 0.5,
      generate: async (req) => {
        await new Promise<void>((r) => gates.set(req.prompt!, r));
        return { files: [{ bytes: new Uint8Array([1]), mimeType: "image/png" }] };
      },
    });
    // Defter okuması elle bırakılana kadar bekletilebilir.
    const ledger = new InMemoryLedger();
    let hold: Promise<void> | undefined;
    let held = false;
    const realSpent = ledger.spent.bind(ledger);
    ledger.spent = async (id: string) => {
      const value = await realSpent(id);
      if (hold) {
        held = true;
        await hold;
      }
      return value;
    };
    const gateway = new MediaGateway({ providers: [a], store: tempStore(), ledger, log: () => {} });
    const run = { policy: { tier: "economy" as const }, episodeId: "ep", budgetCapMicros: usd(0.7) };
    const p1 = gateway.generate({ ...img, prompt: "1" }, run);
    while (!gates.has("1")) await new Promise((r) => setImmediate(r));
    let unhold!: () => void;
    hold = new Promise((r) => (unhold = r));
    // İkinci çağrının kontrolü defteri okurken birinci biter.
    const p2 = gateway.generate({ ...img, prompt: "2" }, run).catch((e: unknown) => e);
    while (!held) await new Promise((r) => setImmediate(r));
    gates.get("1")!();
    await new Promise((r) => setTimeout(r, 20));
    hold = undefined;
    unhold();
    await p1;
    // Eski davranışta ikinci çağrı tavanı aşıp sağlayıcıya giderdi; test asılı kalmasın diye kapısı açılır.
    setTimeout(() => gates.get("2")?.(), 50);
    // Süren 0.5 + yeni 0.5 > 0.7: ikinci çağrı atlanır, tavan aşılmaz.
    expect(await p2).toBeInstanceOf(BudgetExceededError);
    expect(await ledger.spent("ep")).toBe(usd(0.5));
  });

  it("ücretsiz sağlayıcıyla paralel çağrılar rezervasyonu sıfırda bırakır", async () => {
    const gates: (() => void)[] = [];
    const free: ProviderAdapter = {
      ...provider("yerel"),
      local: true,
      price: { unit: "free" },
      generate: async () => {
        await new Promise<void>((r) => gates.push(r));
        return { files: [{ bytes: new Uint8Array([1]), mimeType: "image/png" }] };
      },
    };
    const { gateway, ledger } = setup([free]);
    const run = { policy: { tier: "economy" as const }, episodeId: "ep", budgetCapMicros: 0 };
    const ps = [gateway.generate({ ...img, prompt: "1" }, run), gateway.generate({ ...img, prompt: "2" }, run)];
    while (gates.length < 2) await new Promise((r) => setImmediate(r));
    gates.forEach((g) => g());
    expect((await Promise.all(ps)).map((r) => r.costMicros)).toEqual([0, 0]);
    expect(await ledger.spent("ep")).toBe(0);
  });

  it("bir sağlayıcı düşüp kalanı bütçeye takılırsa bütçe hatası başarısızları da anlatır", async () => {
    const { gateway } = setup([
      provider("ucuz", { usd: 0.1, generate: async () => Promise.reject(new Error("503")) }),
      provider("ucuz2", { usd: 0.2, generate: async () => Promise.reject("düz") }),
      provider("pahali", { usd: 5 }),
    ]);
    const err = await gateway
      .generate(img, { policy: { tier: "ultra" }, episodeId: "ep", budgetCapMicros: usd(1) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toBe("Bölüm ep bütçe tavanını aşacak; onay gerekli (başarısız: ucuz: 503; ucuz2: düz)");
  });

  it("ücretlendirilmiş içerik reddi (ör. fal NSFW) deftere tahminle yazılır, sağlık bozulmaz, sonraki sağlayıcı denenir", async () => {
    const health = new HealthTracker(1);
    const ledger = new InMemoryLedger();
    const logs: string[] = [];
    const gateway = new MediaGateway({
      providers: [
        provider("flux", { usd: 0.03, qualityPrior: 0.9, generate: async () => Promise.reject(new ContentRejectedError("siyah", { billed: true })) }),
        provider("yedek", { usd: 0.05, qualityPrior: 0.8 }),
      ],
      store: tempStore(),
      ledger,
      health,
      log: (m) => logs.push(m),
    });
    const res = await gateway.generate(img, { policy: { tier: "economy" }, episodeId: "ep", budgetCapMicros: usd(1) });
    expect(res.providerId).toBe("yedek");
    expect(ledger.entries[0]).toMatchObject({ providerId: "flux", estimateMicros: usd(0.03), error: "siyah" });
    expect(await ledger.spent("ep")).toBe(usd(0.08));
    expect(health.isAvailable("flux")).toBe(true);
    expect(logs).toContain("hata (ücretlendi): flux: siyah");
    // Ücretsiz içerik reddi eskisi gibi 0 yazılır.
    expect(new ContentRejectedError("x").billed).toBe(false);
  });

  it("bölümsüz çağrıda tavan uygulanmaz ve rezervasyon tutulmaz", async () => {
    const { gateway } = setup([provider("a", { usd: 5 })]);
    const res = await gateway.generate(img, { policy: { tier: "economy" }, budgetCapMicros: usd(1) });
    expect(res.costMicros).toBe(usd(5));
  });

  it("sağlık izleyicisi verilirse başarısızlıkları ona yazar", async () => {
    const health = new HealthTracker(1);
    const gateway = new MediaGateway({
      providers: [provider("a", { generate: async () => Promise.reject(new Error("x")) })],
      store: tempStore(),
      ledger: new InMemoryLedger(),
      health,
    });
    await expect(gateway.generate(img, { policy: { tier: "economy" } })).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(health.isAvailable("a")).toBe(false);
    expect(gateway.plan(img, { tier: "economy" })).toEqual([]);
  });

  it("hash: dizi ve iç içe nesneleri anahtar sırasından bağımsız hesaplar", () => {
    const a = hashRequest({ ...img, params: { b: [1, { y: 2, x: 1 }], a: null } });
    const b = hashRequest({ params: { a: null, b: [1, { x: 1, y: 2 }] }, ...img });
    expect(a).toBe(b);
    expect(hashRequest({ ...img, params: { b: [{ x: 1, y: 2 }, 1], a: null } })).not.toBe(a);
  });
});
