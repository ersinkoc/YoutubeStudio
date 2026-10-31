import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentRejectedError,
  ElevenLabsMusicAdapter,
  ElevenLabsSfxAdapter,
  ElevenLabsTtsAdapter,
  FAL_MODELS,
  FalAdapter,
  SubmittedJobError,
  type FalModelSpec,
  type GenerationRequest,
} from "../src/index.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  signal?: AbortSignal | null;
}

function mockFetch(handler: (url: string, call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      signal: init?.signal,
    };
    calls.push(call);
    return handler(call.url, call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
const EL = "https://api.elevenlabs.io/v1";

describe("ElevenLabs", () => {
  it("TTS: voiceId veya metin yoksa istek atmadan hata verir", async () => {
    const { fetch, calls } = mockFetch(() => json({}));
    const tts = new ElevenLabsTtsAdapter("k");
    await expect(tts.generate({ capability: "tts", quality: "standard", text: "a" }, { fetch })).rejects.toThrow("voiceId ve text gerekli");
    await expect(tts.generate({ capability: "tts", quality: "standard", voiceId: "v" }, { fetch })).rejects.toThrow("voiceId ve text gerekli");
    expect(calls).toHaveLength(0);
  });

  it("TTS: özel model ve tohumu gönderir, voiceId'yi kodlar; hizalama yoksa kelime yok", async () => {
    const { fetch, calls } = mockFetch(() => json({ audio_base64: Buffer.from([4]).toString("base64") }));
    const res = await new ElevenLabsTtsAdapter("anahtar", "eleven_flash").generate(
      { capability: "tts", quality: "standard", text: "selam", voiceId: "a/b", seed: 0 },
      { fetch },
    );
    expect(calls[0]).toMatchObject({
      url: `${EL}/text-to-speech/a%2Fb/with-timestamps?output_format=mp3_44100_128`,
      method: "POST",
      headers: { "xi-api-key": "anahtar" },
      body: { text: "selam", model_id: "eleven_flash", seed: 0 },
    });
    expect(calls[0]?.body).not.toHaveProperty("language_code");
    // Flash/Turbo v3'ün yarı fiyatı.
    expect(new ElevenLabsTtsAdapter("k", "eleven_flash").price).toEqual({ unit: "per_1k_chars", usd: 0.04 });
    expect(new ElevenLabsTtsAdapter("k").price).toEqual({ unit: "per_1k_chars", usd: 0.08 });
    expect(res).toEqual({ files: [{ bytes: new Uint8Array([4]), mimeType: "audio/mpeg" }], words: undefined });
  });

  it("kota: abonelik bilgisini karakter kotasına çevirir", async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ tier: "creator", character_count: 1200, character_limit: 100_000, next_character_count_reset_unix: 1_800_000_000 }),
    );
    expect(await new ElevenLabsTtsAdapter("k").quota({ fetch })).toEqual({
      unit: "chars",
      used: 1200,
      limit: 100_000,
      plan: "creator",
      resetsAt: new Date(1_800_000_000_000).toISOString(),
    });
    expect(calls[0]).toMatchObject({ url: `${EL}/user/subscription`, method: "GET", headers: { "xi-api-key": "k" } });
  });

  it("kota: sıfırlama zamanı yoksa resetsAt boş kalır", async () => {
    const { fetch } = mockFetch(() => json({ tier: "free", character_count: 0, character_limit: 10_000 }));
    expect((await new ElevenLabsTtsAdapter("k").quota({ fetch })).resetsAt).toBeUndefined();
  });

  it("SFX: süre verilirse gönderir, verilmezse alanı atlar", async () => {
    const { fetch, calls } = mockFetch(() => new Response(new Uint8Array([1, 1])));
    const sfx = new ElevenLabsSfxAdapter("k");
    const res = await sfx.generate({ capability: "sfx", quality: "standard", prompt: "kapı", durationSec: 2 }, { fetch });
    await sfx.generate({ capability: "sfx", quality: "standard", prompt: "rüzgar" }, { fetch });
    expect(res.files).toEqual([{ bytes: new Uint8Array([1, 1]), mimeType: "audio/mpeg" }]);
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      [`${EL}/sound-generation`, { text: "kapı", duration_seconds: 2 }],
      [`${EL}/sound-generation`, { text: "rüzgar" }],
    ]);
    expect(sfx).toMatchObject({
      id: "elevenlabs:sfx",
      capabilities: ["sfx"],
      price: { unit: "per_minute", usd: 0.12, defaultSec: 30 },
      priceSource: { url: "https://elevenlabs.io/pricing/api", checked: "2026-10-31" },
    });
  });

  it("müzik: süreyi milisaniyeye çevirir, varsayılan 60 sn; model ve enstrümantal açıkça gönderilir", async () => {
    const { fetch, calls } = mockFetch(() => new Response(new Uint8Array([2])));
    const music = new ElevenLabsMusicAdapter("k");
    const res = await music.generate({ capability: "music", quality: "standard", prompt: "lo-fi", durationSec: 12.3456 }, { fetch });
    await new ElevenLabsMusicAdapter("k", "music_v2").generate({ capability: "music", quality: "standard", prompt: "epik" }, { fetch });
    expect(res.files).toEqual([{ bytes: new Uint8Array([2]), mimeType: "audio/mpeg" }]);
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      [`${EL}/music`, { prompt: "lo-fi", music_length_ms: 12346, model_id: "music_v1", force_instrumental: true }],
      [`${EL}/music`, { prompt: "epik", music_length_ms: 60_000, model_id: "music_v2", force_instrumental: true }],
    ]);
    expect(music).toMatchObject({
      price: { unit: "per_minute", usd: 0.15 },
      priceSource: { url: "https://elevenlabs.io/pricing/api", checked: "2026-10-31" },
    });
  });
});

describe("FalAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const spec: FalModelSpec = {
    id: "fal:test",
    endpoint: "fal-ai/test",
    capabilities: ["i2v"],
    limits: { maxRefs: 1 },
    qualityPrior: 0.7,
    price: { unit: "per_second", usd: 0.1 },
    priceSource: { url: "https://fal", checked: "2026-10-01" },
    verified: true,
    buildInput: (req) => ({ prompt: req.prompt, a: 1 }),
    outputUrls: (r) => (r.urls as string[]) ?? [],
  };

  it("params'ı girdiye ekler, sıra konumunu bildirir, birden çok çıktıyı indirir", async () => {
    let polls = 0;
    const progress: string[] = [];
    const { fetch, calls } = mockFetch((url) => {
      if (url === "https://queue.fal.run/fal-ai/test")
        return json({ request_id: "r9", status_url: "https://q/s", response_url: "https://q/r" });
      if (url === "https://q/s") {
        polls++;
        if (polls === 1) return json({ status: "IN_QUEUE", queue_position: 3 });
        if (polls === 2) return json({ status: "IN_QUEUE" });
        return json({ status: "COMPLETED" });
      }
      if (url === "https://q/r") return json({ urls: ["https://c/1.mp4", "https://c/2.mp4"], seed: 11 });
      return new Response(new Uint8Array([url.endsWith("1.mp4") ? 1 : 2]), { headers: { "content-type": "video/mp4" } });
    });
    const adapter = new FalAdapter(spec, "fal-anahtar");
    expect(adapter).toMatchObject({ id: "fal:test", local: false, qualityPrior: 0.7, priceSource: { checked: "2026-10-01" } });
    const p = adapter.generate(
      { capability: "i2v", quality: "standard", prompt: "deniz", params: { a: 2, extra: true } },
      { fetch, onProgress: (m) => progress.push(m) },
    );
    await vi.runAllTimersAsync();
    const res = await p;
    expect(calls[0]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Key fal-anahtar", "Content-Type": "application/json" },
      body: { prompt: "deniz", a: 2, extra: true },
    });
    expect(calls[1]?.headers).toMatchObject({ Authorization: "Key fal-anahtar" });
    expect(progress).toEqual(["kuyrukta (r9)", "sıra: 3"]);
    expect(res).toEqual({
      files: [
        { bytes: new Uint8Array([1]), mimeType: "video/mp4" },
        { bytes: new Uint8Array([2]), mimeType: "video/mp4" },
      ],
      providerMeta: { requestId: "r9", seed: 11 },
    });
  });

  it("gönderimden sonraki indirme hatası ücretlendirilmiş iş hatasıdır", async () => {
    const { fetch } = mockFetch((url) => {
      if (url.startsWith("https://queue.fal.run")) return json({ request_id: "r1", status_url: "https://q/s", response_url: "https://q/r" });
      if (url === "https://q/s") return json({ status: "COMPLETED" });
      if (url === "https://q/r") return json({ urls: ["https://c/x"] });
      return new Response("yok", { status: 404 });
    });
    const err = await new FalAdapter(spec, "k").generate({ capability: "i2v", quality: "draft" }, { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubmittedJobError);
    expect(err).toMatchObject({ jobId: "r1", message: expect.stringContaining("HTTP 404 https://c/x") });
  });

  /** Gönderim + durum + yanıt uçları; durum ve yanıt gövdeleri özelleştirilebilir. */
  function queue(statusBody: () => Response, responseBody: () => Response = () => json({ urls: [] }), cancelUrl?: string) {
    return mockFetch((url) => {
      if (url.startsWith("https://queue.fal.run"))
        return json({ request_id: "r2", status_url: "https://q/s", response_url: "https://q/r", cancel_url: cancelUrl });
      if (url === "https://q/s") return statusBody();
      if (url === "https://q/r") return responseBody();
      return json({ status: "OK" });
    });
  }
  const draft: GenerationRequest = { capability: "i2v", quality: "draft" };

  it("COMPLETED + içerik hatası: ContentRejectedError, sonuç indirilmez", async () => {
    const { fetch, calls } = queue(() => json({ status: "COMPLETED", error: "flagged", error_type: "content_policy_violation" }));
    const err = await new FalAdapter(spec, "k").generate(draft, { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentRejectedError);
    expect(err).toMatchObject({ billed: false, message: "fal content_policy_violation: flagged" });
    expect(calls.map((c) => c.url)).not.toContain("https://q/r");
  });

  it("COMPLETED + başka hata: açık mesajlı ücretlendirilmiş iş hatası; eksik alanlar varsayılanla", async () => {
    const a = queue(() => json({ status: "COMPLETED", error: "runner çöktü" }));
    const err = await new FalAdapter(spec, "k").generate(draft, { fetch: a.fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubmittedJobError);
    expect((err as Error).message).toContain("fal hata: runner çöktü");
    const b = queue(() => json({ status: "COMPLETED", error_type: "runner_disconnected" }));
    const err2 = await new FalAdapter(spec, "k").generate(draft, { fetch: b.fetch }).catch((e: unknown) => e);
    expect((err2 as Error).message).toContain("fal runner_disconnected: ayrıntı yok");
  });

  it("yanıt 422 içerik reddi dönerse ContentRejectedError; başka 422 ücretlendirilmiş iş hatası", async () => {
    const a = queue(
      () => json({ status: "COMPLETED" }),
      () => new Response('{"detail":[{"type":"content_policy_violation"}]}', { status: 422 }),
    );
    const err = await new FalAdapter(spec, "k").generate(draft, { fetch: a.fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentRejectedError);
    expect((err as Error).message).toContain("fal içerik reddi");
    const b = queue(
      () => json({ status: "COMPLETED" }),
      () => new Response("bozuk girdi", { status: 422 }),
    );
    expect(await new FalAdapter(spec, "k").generate(draft, { fetch: b.fetch }).catch((e: unknown) => e)).toBeInstanceOf(SubmittedJobError);
  });

  it("bekleme süresi dolunca işi PUT cancel_url ile iptal eder", async () => {
    const progress: string[] = [];
    const { fetch, calls } = queue(() => json({ status: "IN_PROGRESS" }), undefined, "https://q/c");
    const p = new FalAdapter(spec, "k").generate(draft, { fetch, onProgress: (m) => progress.push(m) }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(21 * 60_000);
    const err = await p;
    expect(err).toBeInstanceOf(SubmittedJobError);
    expect((err as Error).message).toContain("Zaman aşımı");
    expect(calls.at(-1)).toMatchObject({ url: "https://q/c", method: "PUT", headers: { Authorization: "Key k" } });
    expect(progress.at(-1)).toBe("iptal istendi (r2)");
  });

  it("çağıran iptal edince işi iptal eder; iptal isteği hatası yutulur", async () => {
    const ac = new AbortController();
    const base = queue(() => json({ status: "IN_QUEUE" }), undefined, "https://q/c");
    const cancels: string[] = [];
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "https://q/c") {
        cancels.push(init?.method ?? "");
        throw new Error("ağ yok");
      }
      return base.fetch(input, init);
    }) as typeof fetch;
    const p = new FalAdapter(spec, "k").generate(draft, { fetch: failing, signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    ac.abort(new Error("vazgeçildi"));
    await vi.advanceTimersByTimeAsync(10);
    expect(((await p) as Error).message).toContain("vazgeçildi");
    expect(cancels).toEqual(["PUT"]);
  });

  it("cancel_url yoksa iptal isteği atılmaz; durum hatası (iptal/zaman aşımı değil) iptal göndermez", async () => {
    const ac = new AbortController();
    const none = queue(() => json({ status: "IN_QUEUE" }));
    const p = new FalAdapter(spec, "k").generate(draft, { fetch: none.fetch, signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    ac.abort(new Error("dur"));
    await vi.advanceTimersByTimeAsync(10);
    expect(((await p) as Error).message).toContain("dur");
    expect(none.calls.some((c) => c.method === "PUT")).toBe(false);

    const broken = queue(() => new Response("yok", { status: 404 }), undefined, "https://q/c");
    expect(await new FalAdapter(spec, "k").generate(draft, { fetch: broken.fetch }).catch((e: unknown) => e)).toBeInstanceOf(SubmittedJobError);
    expect(broken.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("gönderim reddedilirse SubmittedJobError değildir (ücret yok)", async () => {
    const { fetch } = mockFetch(() => new Response("kötü istek", { status: 422 }));
    const err = await new FalAdapter(spec, "k").generate({ capability: "i2v", quality: "draft" }, { fetch }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SubmittedJobError);
    expect(err).toMatchObject({ status: 422 });
  });
});

describe("FAL_MODELS girdileri", () => {
  const model = (id: string) => FAL_MODELS.find((m) => m.id === id)!;
  const png = (role: "first_frame" | "last_frame" | "character" | "style", b: number) => ({
    role,
    bytes: new Uint8Array([b]),
    mimeType: "image/png",
  });
  const uri = (b: number) => `data:image/png;base64,${Buffer.from([b]).toString("base64")}`;

  it("flux-dev: orana göre ~1 MP boyut, varsayılan 16:9; görsel URL'lerini okur", () => {
    const m = model("fal:flux-dev");
    expect(m.buildInput({ capability: "t2i", quality: "draft", prompt: "p", seed: 1, aspectRatio: "1:1" })).toEqual({
      prompt: "p",
      image_size: { width: 1024, height: 1024 },
      seed: 1,
      num_images: 1,
    });
    expect(m.buildInput({ capability: "t2i", quality: "draft" }).image_size).toEqual({ width: 1344, height: 768 });
    expect(m.buildInput({ capability: "t2i", quality: "draft", aspectRatio: "9:16" }).image_size).toEqual({ width: 768, height: 1344 });
    expect(m.outputUrls({ images: [{ url: "u1" }, { url: "u2" }] })).toEqual(["u1", "u2"]);
    expect(m.outputUrls({})).toEqual([]);
  });

  it("flux-dev: olumsuz prompt alanı yok; 'Avoid:' olarak prompt'a eklenir", () => {
    const m = model("fal:flux-dev");
    expect(m.buildInput({ capability: "t2i", quality: "draft", prompt: "kedi", negativePrompt: " yazı " }).prompt).toBe("kedi\n\nAvoid: yazı");
    expect(m.buildInput({ capability: "t2i", quality: "draft", negativePrompt: "yazı" }).prompt).toBe("Avoid: yazı");
    expect(m.buildInput({ capability: "t2i", quality: "draft", prompt: "kedi", negativePrompt: "  " }).prompt).toBe("kedi");
  });

  it("flux: NSFW işaretli (siyah) görseller atılır; hepsi işaretliyse ücretlendirilmiş içerik reddi", () => {
    const m = model("fal:flux-dev");
    expect(m.outputUrls({ images: [{ url: "a" }, { url: "b" }], has_nsfw_concepts: [true, false] })).toEqual(["b"]);
    let err: unknown;
    try {
      m.outputUrls({ images: [{ url: "a" }], has_nsfw_concepts: [true] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContentRejectedError);
    expect(err).toMatchObject({ billed: true, message: "fal güvenlik filtresi 1 görseli işaretledi (siyah görsel)" });
  });

  it("flux-kontext: ilk referansı data URI olarak gönderir; olumsuz prompt prompt'a eklenir", () => {
    const m = model("fal:flux-kontext-pro");
    expect(m.buildInput({ capability: "i2i_multiref", quality: "draft", prompt: "p", refs: [png("style", 3)] })).toEqual({
      prompt: "p",
      image_url: uri(3),
      aspect_ratio: "16:9",
      seed: undefined,
    });
    expect(m.buildInput({ capability: "i2i_multiref", quality: "draft", aspectRatio: "1:1", negativePrompt: "n" })).toMatchObject({
      prompt: "Avoid: n",
      image_url: undefined,
      aspect_ratio: "1:1",
    });
  });

  it("kling 3 standart: v2.1'in yerine; start/end alanları, 3–15 sn metin süre, sesli fiyat", () => {
    const m = model("fal:kling-v3-std-i2v");
    expect(m).toMatchObject({
      endpoint: "fal-ai/kling-video/v3/standard/image-to-video",
      verified: true,
      price: { unit: "per_second", usd: 0.084, minSec: 3, withAudioUsd: 0.126 },
    });
    expect(FAL_MODELS.some((x) => x.endpoint.includes("v2.1"))).toBe(false);
    const req: GenerationRequest = { capability: "i2v", quality: "standard", prompt: "p", negativePrompt: "n", refs: [png("character", 1)] };
    expect(m.buildInput(req)).toEqual({
      prompt: "p",
      start_image_url: uri(1),
      end_image_url: undefined,
      duration: "5",
      negative_prompt: "n",
      generate_audio: false,
    });
    expect(m.buildInput({ ...req, durationSec: 6.2 }).duration).toBe("7");
    expect(m.buildInput({ ...req, durationSec: 6 }).duration).toBe("6");
    expect(m.buildInput({ ...req, durationSec: 1.5 }).duration).toBe("3");
    expect(m.buildInput({ ...req, durationSec: 40 }).duration).toBe("15");
    expect(m.outputUrls({ video: { url: "v" } })).toEqual(["v"]);
    expect(m.outputUrls({})).toEqual([]);
  });

  it("kling 3 pro: ilk ve son kare start_image_url/end_image_url'e gider; ses isteği iletilir", () => {
    const m = model("fal:kling-v3-pro-i2v");
    expect(
      m.buildInput({ capability: "first_last_frame", quality: "hero", refs: [png("last_frame", 2), png("first_frame", 1)], withAudio: true, durationSec: 10 }),
    ).toEqual({ prompt: undefined, start_image_url: uri(1), end_image_url: uri(2), duration: "10", negative_prompt: undefined, generate_audio: true });
    expect(m.buildInput({ capability: "i2v", quality: "hero" })).toMatchObject({ start_image_url: undefined, end_image_url: undefined, generate_audio: false });
    expect(m.price).toEqual({ unit: "per_second", usd: 0.112, minSec: 3, withAudioUsd: 0.168 });
    expect(m.outputUrls({ video: { url: "v3" } })).toEqual(["v3"]);
  });

  it("seedance: yalnız görsel referansları gönderir, varsayılan 5 sn 720p 16:9; süre metin", () => {
    const m = model("fal:seedance-2-ref2v");
    const audio = { role: "source_audio" as const, bytes: new Uint8Array([9]), mimeType: "audio/wav" };
    expect(m.buildInput({ capability: "ref2v", quality: "hero", prompt: "p", refs: [png("character", 1), audio, png("style", 2)] })).toEqual({
      prompt: "p",
      image_urls: [uri(1), uri(2)],
      duration: "5",
      aspect_ratio: "16:9",
      resolution: "720p",
      generate_audio: false,
    });
    expect(m.buildInput({ capability: "ref2v", quality: "hero", durationSec: 8.4, withAudio: true, aspectRatio: "9:16" })).toMatchObject({
      image_urls: undefined,
      duration: "9",
      aspect_ratio: "9:16",
      generate_audio: true,
    });
    expect(m.buildInput({ capability: "ref2v", quality: "hero", durationSec: 2 }).duration).toBe("4");
    expect(m.price).toEqual({ unit: "per_second", usd: 0.3024, minSec: 4 });
    expect(m.outputUrls({ video: { url: "s" } })).toEqual(["s"]);
  });
});
