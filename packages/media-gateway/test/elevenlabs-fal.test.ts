import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
    expect(sfx).toMatchObject({ id: "elevenlabs:sfx", capabilities: ["sfx"], price: { unit: "per_minute" } });
  });

  it("müzik: süreyi milisaniyeye çevirir, varsayılan 60 sn", async () => {
    const { fetch, calls } = mockFetch(() => new Response(new Uint8Array([2])));
    const music = new ElevenLabsMusicAdapter("k");
    const res = await music.generate({ capability: "music", quality: "standard", prompt: "lo-fi", durationSec: 12.3456 }, { fetch });
    await music.generate({ capability: "music", quality: "standard", prompt: "epik" }, { fetch });
    expect(res.files).toEqual([{ bytes: new Uint8Array([2]), mimeType: "audio/mpeg" }]);
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      [`${EL}/music`, { prompt: "lo-fi", music_length_ms: 12346 }],
      [`${EL}/music`, { prompt: "epik", music_length_ms: 60_000 }],
    ]);
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

  it("flux-kontext: ilk referansı data URI olarak gönderir", () => {
    const m = model("fal:flux-kontext-pro");
    expect(m.buildInput({ capability: "i2i_multiref", quality: "draft", prompt: "p", refs: [png("style", 3)] })).toEqual({
      prompt: "p",
      image_url: uri(3),
      aspect_ratio: "16:9",
      seed: undefined,
    });
    expect(m.buildInput({ capability: "i2i_multiref", quality: "draft", aspectRatio: "1:1" })).toMatchObject({
      image_url: undefined,
      aspect_ratio: "1:1",
    });
  });

  it("kling 2.1: ilk kare/karakter referansı, süre 5 veya 10; video URL'sini okur", () => {
    const m = model("fal:kling-v2.1-std-i2v");
    const req: GenerationRequest = { capability: "i2v", quality: "standard", prompt: "p", negativePrompt: "n", refs: [png("character", 1)] };
    expect(m.buildInput(req)).toEqual({ prompt: "p", image_url: uri(1), duration: "5", negative_prompt: "n" });
    expect(m.buildInput({ ...req, durationSec: 5 }).duration).toBe("5");
    expect(m.buildInput({ ...req, durationSec: 6 }).duration).toBe("10");
    expect(m.outputUrls({ video: { url: "v" } })).toEqual(["v"]);
    expect(m.outputUrls({})).toEqual([]);
  });

  it("kling 3: ilk ve son kare ayrı alanlara gider; ses isteği iletilir", () => {
    const m = model("fal:kling-v3-pro-i2v");
    expect(
      m.buildInput({ capability: "first_last_frame", quality: "hero", refs: [png("last_frame", 2), png("first_frame", 1)], withAudio: true, durationSec: 10 }),
    ).toEqual({ prompt: undefined, image_url: uri(1), tail_image_url: uri(2), duration: "10", negative_prompt: undefined, generate_audio: true });
    expect(m.buildInput({ capability: "i2v", quality: "hero" })).toMatchObject({ image_url: undefined, tail_image_url: undefined, generate_audio: false });
    expect(m.outputUrls({ video: { url: "v3" } })).toEqual(["v3"]);
  });

  it("seedance: yalnız görsel referansları gönderir, varsayılan 5 sn 720p", () => {
    const m = model("fal:seedance-2-ref2v");
    const audio = { role: "source_audio" as const, bytes: new Uint8Array([9]), mimeType: "audio/wav" };
    expect(m.buildInput({ capability: "ref2v", quality: "hero", prompt: "p", refs: [png("character", 1), audio, png("style", 2)] })).toEqual({
      prompt: "p",
      image_urls: [uri(1), uri(2)],
      duration: 5,
      resolution: "720p",
      generate_audio: false,
    });
    expect(m.buildInput({ capability: "ref2v", quality: "hero", durationSec: 8, withAudio: true })).toMatchObject({
      image_urls: undefined,
      duration: 8,
      generate_audio: true,
    });
    expect(m.outputUrls({ video: { url: "s" } })).toEqual(["s"]);
  });
});
