import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatText, msg, trText, usd } from "@ys/core";
import {
  HealthTracker,
  InMemoryLedger,
  JsonlLedger,
  billing,
  charAlignmentToWords,
  AllProvidersFailedError,
  ContentRejectedError,
  HttpError,
  PollTimeoutError,
  RequestTimeoutError,
  SubmittedJobError,
  afterSubmit,
  describePrice,
  unitText,
  estimateCost,
  groupCosts,
  isWav,
  measuredLatency,
  pcm16ToWav,
  rankProviders,
  supports,
  unwrapNestedWav,
  type CostEntry,
  type GenerationRequest,
  type ProviderAdapter,
} from "../src/index.ts";

const entry = (over: Partial<CostEntry> = {}): CostEntry => ({
  at: "2026-10-30T00:00:00Z",
  episodeId: "e1",
  providerId: "p",
  capability: "t2i",
  estimateMicros: usd(0.1),
  cacheHit: false,
  requestHash: "h",
  ...over,
});

describe("JsonlLedger", () => {
  it("dosya yoksa boş döner; kayıtları klasörü oluşturarak ekler ve geri okur", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ys-ledger-")), "alt", "klasor", "costs.jsonl");
    const ledger = new JsonlLedger(path);
    expect(await ledger.all()).toEqual([]);
    expect(await ledger.spent("e1")).toBe(0);

    await ledger.record(entry());
    await ledger.record(entry({ episodeId: "e2", estimateMicros: usd(1) }));
    await ledger.record(entry({ capability: "llm", estimateMicros: usd(5) }));
    await ledger.record(entry({ cacheHit: true }));

    expect(await ledger.all()).toHaveLength(4);
    expect(await ledger.list()).toHaveLength(4);
    expect((await ledger.list("e2")).map((e) => e.estimateMicros)).toEqual([usd(1)]);
    expect(await ledger.spent("e1")).toBe(usd(0.1));
  });

  it("ENOENT dışındaki okuma hatasını yutmaz", async () => {
    // Klasörü dosya gibi okumaya çalışmak EISDIR verir.
    const dir = mkdtempSync(join(tmpdir(), "ys-ledger-"));
    await expect(new JsonlLedger(dir).all()).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("boş satırları atlar", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ys-ledger-")), "c.jsonl");
    writeFileSync(path, `\n${JSON.stringify(entry())}\n\n`);
    expect(await new JsonlLedger(path).all()).toEqual([entry()]);
  });
});

describe("InMemoryLedger.list", () => {
  it("bölüm verilmezse tüm kayıtları döndürür", async () => {
    const l = new InMemoryLedger();
    await l.record(entry());
    await l.record(entry({ episodeId: undefined }));
    expect(await l.list()).toHaveLength(2);
    expect(await l.list("e1")).toHaveLength(1);
  });
});

describe("groupCosts / measuredLatency", () => {
  it("süre/birim alanı olmayan başarılı kayıtları sıfır sayar; ilk birim etiketini korur", () => {
    const [g] = groupCosts([entry(), entry({ units: 2, unitLabel: "sn" }), entry({ units: 1, unitLabel: "görsel" })], () => "k");
    expect(g).toEqual({ key: "k", calls: 3, cacheHits: 0, failures: 0, micros: usd(0.3), durationMs: 0, units: 3, unitLabel: "sn" });
  });

  it("yalnız önbellek isabeti olan sağlayıcıya süre yazmaz", () => {
    expect(measuredLatency([entry({ cacheHit: true, durationMs: 10 })])).toEqual({});
  });
});

describe("billing / describePrice / estimateCost", () => {
  const req = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({ capability: "i2v", quality: "standard", ...over });

  it("ücretsiz, görsel başı ve dakika başı", () => {
    expect(billing({ unit: "free" }, req())).toEqual({ units: 0, unitLabel: "—", micros: 0 });
    expect(billing({ unit: "per_output", usd: 0.04 }, req())).toEqual({ units: 1, unitLabel: "görsel", micros: usd(0.04) });
    expect(billing({ unit: "per_minute", usd: 0.12 }, req({ durationSec: 30 }))).toEqual({ units: 0.5, unitLabel: "dk", micros: usd(0.06) });
    // Süre yoksa bir dakika sayılır.
    expect(billing({ unit: "per_minute", usd: 0.8 }, req())).toEqual({ units: 1, unitLabel: "dk", micros: usd(0.8) });
  });

  it("saniye başı: süre yoksa 5 sn; metin yoksa karakter sıfır", () => {
    expect(billing({ unit: "per_second", usd: 0.1 }, req())).toMatchObject({ units: 5, micros: usd(0.5) });
    expect(billing({ unit: "per_1k_chars", usd: 0.1 }, req())).toEqual({ units: 0, unitLabel: "karakter", micros: 0 });
    expect(estimateCost({ unit: "per_second", usd: 0.4, stepSec: 2, minSec: 4 }, req({ durationSec: 5 }))).toBe(usd(2.4));
  });

  it("her birimi insan okunur yazar", () => {
    expect(trText(describePrice({ unit: "free" }))).toBe("ücretsiz (yerel)");
    expect(trText(describePrice({ unit: "per_output", usd: 0.134 }))).toBe("$0.134/görsel");
    expect(trText(describePrice({ unit: "per_second", usd: 0.23 }))).toBe("$0.23/sn");
    expect(trText(describePrice({ unit: "per_second", usd: 0.1, stepSec: 1 }))).toBe("$0.1/sn");
    expect(trText(describePrice({ unit: "per_second", usd: 0.4, stepSec: 2 }))).toBe("$0.4/sn (2 sn adımlarla)");
    expect(trText(describePrice({ unit: "per_second", usd: 0.23, minSec: 4 }))).toBe("$0.23/sn, en az 4 sn");
    expect(trText(describePrice({ unit: "per_1k_chars", usd: 0.03 }))).toBe("$0.03/1000 karakter");
    expect(trText(describePrice({ unit: "per_minute", usd: 0.8 }))).toBe("$0.8/dk");
    expect(trText(describePrice({ unit: "per_second", usd: 0.084, minSec: 3, withAudioUsd: 0.126 }))).toBe(
      "$0.084/sn, en az 3 sn; sesli $0.126/sn",
    );
    expect(formatText("en", describePrice({ unit: "per_second", usd: 0.4, stepSec: 2, minSec: 4, withAudioUsd: 0.6 }))).toBe(
      "$0.4/s (in 2 s steps), at least 4 s; with audio $0.6/s",
    );
    expect(formatText("en", describePrice({ unit: "per_output", usd: 0.025 }))).toBe("$0.025/image");
    // Defterdeki Türkçe birim etiketleri arayüzde çevrilir; tanınmayan etiket olduğu gibi kalır.
    expect(["görsel", "sn", "karakter", "dk", "—", "x"].map((l) => formatText("en", unitText(l)))).toEqual(["images", "s", "characters", "min", "—", "x"]);
  });

  it("sesli istek sesli fiyatla; SFX süresizse varsayılan süreyle (30 sn) faturalanır", () => {
    const kling3 = { unit: "per_second", usd: 0.084, minSec: 3, withAudioUsd: 0.126 } as const;
    expect(billing(kling3, req({ durationSec: 7 }))).toMatchObject({ units: 7, micros: usd(0.588) });
    expect(billing(kling3, req({ durationSec: 7, withAudio: true }))).toMatchObject({ units: 7, micros: usd(0.882) });
    expect(billing(kling3, req({ durationSec: 2 }))).toMatchObject({ units: 3 });
    // withAudioUsd yoksa ses fiyatı değiştirmez.
    expect(billing({ unit: "per_second", usd: 0.3 }, req({ durationSec: 4, withAudio: true }))).toMatchObject({ micros: usd(1.2) });
    expect(billing({ unit: "per_minute", usd: 0.12, defaultSec: 30 }, req({ capability: "sfx" }))).toEqual({
      units: 0.5,
      unitLabel: "dk",
      micros: usd(0.06),
    });
  });
});

describe("supports", () => {
  const adapter = (limits: ProviderAdapter["limits"]): ProviderAdapter => ({
    id: "a",
    local: false,
    capabilities: ["i2v", "tts"],
    limits,
    qualityPrior: 0.5,
    price: { unit: "free" },
    generate: async () => ({ files: [] }),
  });
  const ref = { role: "character" as const, bytes: new Uint8Array(), mimeType: "image/png" };

  it("yetenek, referans sayısı, süre, oran ve ses kimliği sınırlarını uygular", () => {
    const i2v: GenerationRequest = { capability: "i2v", quality: "standard" };
    expect(supports(adapter({}), { capability: "t2i", quality: "standard" })).toBe(false);
    expect(supports(adapter({}), i2v)).toBe(true);
    expect(supports(adapter({ maxRefs: 1 }), { ...i2v, refs: [ref, ref] })).toBe(false);
    expect(supports(adapter({ maxRefs: 1 }), { ...i2v, refs: [ref] })).toBe(true);
    expect(supports(adapter({ minDurationSec: 4 }), { ...i2v, durationSec: 3 })).toBe(false);
    expect(supports(adapter({ minDurationSec: 4, maxDurationSec: 8 }), { ...i2v, durationSec: 6 })).toBe(true);
    expect(supports(adapter({ maxDurationSec: 8 }), { ...i2v, durationSec: 9 })).toBe(false);
    // Süre verilmezse süre sınırı uygulanmaz.
    expect(supports(adapter({ minDurationSec: 4 }), i2v)).toBe(true);
    expect(supports(adapter({ aspectRatios: ["16:9"] }), { ...i2v, aspectRatio: "1:1" })).toBe(false);
    expect(supports(adapter({ aspectRatios: ["16:9"] }), { ...i2v, aspectRatio: "16:9" })).toBe(true);
    expect(supports(adapter({}), { ...i2v, aspectRatio: "1:1" })).toBe(true);
    expect(supports(adapter({ requiresVoiceId: true }), { capability: "tts", quality: "standard" })).toBe(false);
    expect(supports(adapter({ requiresVoiceId: true }), { capability: "tts", quality: "standard", voiceId: "v" })).toBe(true);
  });
});

describe("rankProviders politika filtreleri", () => {
  const mk = (id: string, usdPrice: number): ProviderAdapter => ({
    id,
    local: false,
    capabilities: ["t2i"],
    limits: {},
    qualityPrior: 0.7,
    price: { unit: "per_output", usd: usdPrice },
    generate: async () => ({ files: [] }),
  });
  const req: GenerationRequest = { capability: "t2i", quality: "draft" };

  it("allow, deny ve maxCostMicros uygular; ultra'da fiyat belirleyicidir", () => {
    const list = [mk("a", 0.1), mk("b", 0.01), mk("c", 0.05)];
    expect(rankProviders(list, req, { tier: "ultra" }).map((r) => r.adapter.id)).toEqual(["b", "c", "a"]);
    expect(rankProviders(list, req, { tier: "ultra", allow: ["a", "c"] }).map((r) => r.adapter.id)).toEqual(["c", "a"]);
    expect(rankProviders(list, req, { tier: "ultra", deny: ["b"] }).map((r) => r.adapter.id)).toEqual(["c", "a"]);
    expect(rankProviders(list, req, { tier: "ultra", maxCostMicros: usd(0.05) }).map((r) => r.adapter.id)).toEqual(["b", "c"]);
  });
});

describe("HealthTracker", () => {
  it("başarı sayacı sıfırlar; eşik altındaki hatalar sağlayıcıyı kapatmaz", () => {
    let now = 0;
    const h = new HealthTracker(2, 100, () => now);
    h.recordFailure("x");
    expect(h.isAvailable("x")).toBe(true);
    h.recordFailure("x");
    expect(h.isAvailable("x")).toBe(false);
    now = 100;
    // Tam soğuma sınırında hâlâ kapalı.
    expect(h.isAvailable("x")).toBe(false);
    h.recordSuccess("x");
    expect(h.isAvailable("x")).toBe(true);
  });

  it("varsayılan eşik 3 ve gerçek saat", () => {
    const h = new HealthTracker();
    for (let i = 0; i < 2; i++) h.recordFailure("y");
    expect(h.isAvailable("y")).toBe(true);
    h.recordFailure("y");
    expect(h.isAvailable("y")).toBe(false);
  });
});

describe("audio kenar durumları", () => {
  it("isWav kısa veya RIFF olmayan veriyi reddeder", () => {
    expect(isWav(new Uint8Array(4))).toBe(false);
    const wav = pcm16ToWav(new Uint8Array(2));
    expect(isWav(wav)).toBe(true);
    const notWave = wav.slice();
    notWave.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI "
    expect(isWav(notWave)).toBe(false);
  });

  it("unwrapNestedWav: RIFF olmayan, kısa ve içi WAV olmayan veride undefined", () => {
    expect(unwrapNestedWav(new Uint8Array(60))).toBeUndefined();
    expect(unwrapNestedWav(pcm16ToWav(new Uint8Array(4)))).toBeUndefined();
    expect(unwrapNestedWav(pcm16ToWav(new Uint8Array(40)))).toBeUndefined();
  });

  it("unwrapNestedWav içteki WAV'ı başlıktaki boyutla keser; boyut taşarsa eldekini alır", () => {
    const inner = pcm16ToWav(new Uint8Array([1, 0, 2, 0]));
    const withTrailer = pcm16ToWav(new Uint8Array([...inner, 9, 9, 9]));
    expect(unwrapNestedWav(withTrailer)).toEqual(inner);
    const truncatedInner = inner.slice();
    new DataView(truncatedInner.buffer).setUint32(4, 10_000, true);
    expect(unwrapNestedWav(pcm16ToWav(truncatedInner))).toEqual(truncatedInner);
  });

  it("pcm16ToWav çok kanallı başlık yazar", () => {
    const view = new DataView(pcm16ToWav(new Uint8Array(8), 48_000, 2).buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(28, true)).toBe(48_000 * 4);
    expect(view.getUint16(32, true)).toBe(4);
  });

  it("charAlignmentToWords: eksik zamanlarda 0 ve başlangıcı kullanır, art arda boşlukları atlar", () => {
    expect(charAlignmentToWords([..."ab  c"], [0.5], [])).toEqual([
      { text: "ab", startMs: 500, endMs: 500 },
      { text: "c", startMs: 0, endMs: 0 },
    ]);
    expect(charAlignmentToWords([], [], [])).toEqual([]);
  });
});

describe("çevrilebilir hatalar", () => {
  it("Türkçe message aynı kalır, text seçili dilde biçimlenir; alanlar korunur", async () => {
    const http = new HttpError(503, "https://x", "meşgul");
    expect(http.message).toBe("HTTP 503 https://x: meşgul");
    expect(http.status).toBe(503);
    expect(formatText("en", new RequestTimeoutError("https://x", 5).text)).toBe("Request timed out (5 ms): https://x");
    expect(formatText("en", new PollTimeoutError(9).text)).toBe("Timed out (9 ms)");
    const all = new AllProvidersFailedError([
      { providerId: "a", error: new PollTimeoutError(1) },
      { providerId: "b", error: "düz" },
    ]);
    expect(all.message).toBe("Tüm sağlayıcılar başarısız: a: Zaman aşımı (1 ms) | b: düz");
    expect(formatText("en", all.text)).toBe("All providers failed: a: Timed out (1 ms) | b: düz");
    expect(new AllProvidersFailedError([]).message).toBe("Tüm sağlayıcılar başarısız: ");
    const rejected = new ContentRejectedError(msg("gw.fal.nsfw", { n: 2 }), { billed: true });
    expect([rejected.billed, formatText("en", rejected.text)]).toEqual([true, "fal safety filter flagged 2 image(s) (black image)"]);
    const sub = await afterSubmit("j1", async () => Promise.reject(new PollTimeoutError(3))).catch((e: SubmittedJobError) => e);
    expect(sub.message).toBe("gönderilmiş iş başarısız (j1): Zaman aşımı (3 ms)");
    expect(formatText("en", sub.text)).toBe("submitted job failed (j1): Timed out (3 ms)");
  });
});
