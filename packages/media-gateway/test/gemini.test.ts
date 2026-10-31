import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentRejectedError,
  GeminiImageAdapter,
  GeminiTtsAdapter,
  SubmittedJobError,
  VeoAdapter,
  pcm16ToWav,
  type GenerationRequest,
} from "../src/index.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

function mockFetch(handler: (url: string, call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call.url, call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const cfg = (id: string, model: string) => ({
  id,
  model,
  apiKey: "sahte-anahtar",
  qualityPrior: 0.8,
  price: { unit: "per_output" as const, usd: 0.05 },
  priceSource: { url: "https://ornek", checked: "2026-10-18" },
});

describe("GeminiImageAdapter", () => {
  const adapter = new GeminiImageAdapter(cfg("gemini:img", "img-model"));

  it("referansları inlineData olarak gönderir, dönen görselleri çözer", async () => {
    const { fetch, calls } = mockFetch(() =>
      json({
        candidates: [
          { content: { parts: [{ text: "işte" }, { inlineData: { mimeType: "image/png", data: b64([1, 2]) } }] } },
        ],
      }),
    );
    const req: GenerationRequest = {
      capability: "i2i_multiref",
      quality: "standard",
      prompt: "kedi",
      aspectRatio: "9:16",
      refs: [{ role: "character", bytes: new Uint8Array([5]), mimeType: "image/jpeg" }],
    };
    const res = await adapter.generate(req, { fetch });
    expect(res.files).toEqual([{ bytes: new Uint8Array([1, 2]), mimeType: "image/png" }]);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/models/img-model:generateContent`,
      method: "POST",
      headers: { "x-goog-api-key": "sahte-anahtar", "Content-Type": "application/json" },
    });
    expect(calls[0]?.body).toEqual({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: b64([5]) } }, { text: "kedi" }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } },
    });
    expect(adapter).toMatchObject({ id: "gemini:img", qualityPrior: 0.8, local: false, priceSource: { checked: "2026-10-18" } });
  });

  it("prompt ve oran yoksa boş metin ve 16:9 gönderir", async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: b64([1]) } }] } }] }),
    );
    await adapter.generate({ capability: "t2i", quality: "draft" }, { fetch });
    expect(calls[0]?.body).toMatchObject({
      contents: [{ parts: [{ text: "" }] }],
      generationConfig: { imageConfig: { aspectRatio: "16:9" } },
    });
  });

  it("istem engellenirse ContentRejectedError verir", async () => {
    const { fetch } = mockFetch(() => json({ promptFeedback: { blockReason: "SAFETY" } }));
    const err = await adapter.generate({ capability: "t2i", quality: "draft", prompt: "x" }, { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentRejectedError);
    expect((err as Error).message).toBe("Gemini engelledi: SAFETY");
  });

  it("görsel yerine metin dönerse nedeni ve metni hataya taşır", async () => {
    const { fetch } = mockFetch(() =>
      json({ candidates: [{ finishReason: "IMAGE_OTHER", content: { parts: [{ text: "  çizemem " }, {}] } }] }),
    );
    await expect(adapter.generate({ capability: "t2i", quality: "draft", prompt: "x" }, { fetch })).rejects.toThrow(
      "Gemini görsel döndürmedi (IMAGE_OTHER): çizemem",
    );
  });

  it("aday hiç yoksa 'neden yok' der ve metin eklemez", async () => {
    const { fetch } = mockFetch(() => json({}));
    const err = await adapter.generate({ capability: "t2i", quality: "draft" }, { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentRejectedError);
    expect((err as Error).message).toBe("Gemini görsel döndürmedi (neden yok)");
  });

  it("içeriksiz adayda da 'neden yok' der", async () => {
    const { fetch } = mockFetch(() => json({ candidates: [{}] }));
    await expect(adapter.generate({ capability: "t2i", quality: "draft" }, { fetch })).rejects.toThrow("(neden yok)");
  });
});

describe("GeminiTtsAdapter", () => {
  it("ham PCM'i örnekleme hızıyla WAV'a sarar; varsayılan sesi kullanır", async () => {
    const pcm = [1, 0, 2, 0];
    const { fetch, calls } = mockFetch(() =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=16000", data: b64(pcm) } }] } }] }),
    );
    const adapter = new GeminiTtsAdapter(cfg("gemini:tts", "tts-model"));
    const res = await adapter.generate({ capability: "tts", quality: "standard", text: "merhaba" }, { fetch });
    expect(res.files[0]?.mimeType).toBe("audio/wav");
    expect(res.files[0]?.bytes).toEqual(pcm16ToWav(new Uint8Array(pcm), 16_000));
    expect(calls[0]?.url).toBe(`${BASE}/models/tts-model:generateContent`);
    expect(calls[0]?.body).toEqual({
      contents: [{ parts: [{ text: "merhaba" }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
  });

  it("prompt'u metnin önüne ekler, voiceId'yi kullanır; hız yoksa 24 kHz, hazır WAV'ı yeniden sarmaz", async () => {
    const wav = pcm16ToWav(new Uint8Array([3, 0]), 24_000);
    const { fetch, calls } = mockFetch(() =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: b64([...wav]) } }] } }] }),
    );
    const adapter = new GeminiTtsAdapter(cfg("gemini:tts", "m"), "Puck");
    const res = await adapter.generate(
      { capability: "tts", quality: "standard", prompt: "neşeli oku", text: "selam", voiceId: "Charon" },
      { fetch },
    );
    expect(res.files[0]?.bytes).toEqual(wav);
    expect(calls[0]?.body).toMatchObject({
      contents: [{ parts: [{ text: "neşeli oku\n\nselam" }] }],
      generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } } },
    });
  });

  it("metin yoksa boş metin, prompt varsa yalnız prompt gönderir; özel varsayılan sesi kullanır", async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/pcm", data: b64([0, 0]) } }] } }] }),
    );
    const adapter = new GeminiTtsAdapter(cfg("gemini:tts", "m"), "Puck");
    await adapter.generate({ capability: "tts", quality: "standard" }, { fetch });
    await adapter.generate({ capability: "tts", quality: "standard", prompt: "fısılda" }, { fetch });
    expect(calls[0]?.body).toMatchObject({
      contents: [{ parts: [{ text: "" }] }],
      generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } },
    });
    expect(calls[1]?.body).toMatchObject({ contents: [{ parts: [{ text: "fısılda\n\n" }] }] });
  });

  it("ses dönmezse içerik reddi verir", async () => {
    const { fetch } = mockFetch(() => json({ candidates: [{ finishReason: "OTHER", content: { parts: [] } }] }));
    await expect(
      new GeminiTtsAdapter(cfg("gemini:tts", "m")).generate({ capability: "tts", quality: "standard", text: "a" }, { fetch }),
    ).rejects.toBeInstanceOf(ContentRejectedError);
  });
});

describe("VeoAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const adapter = new VeoAdapter(cfg("gemini:veo", "veo-model"));
  const frame = (role: "first_frame" | "last_frame" | "character", b: number) => ({
    role,
    bytes: new Uint8Array([b]),
    mimeType: "image/png",
  });

  it("işlemi başlatır, tamamlanana kadar sorar ve videoyu indirir", async () => {
    let polls = 0;
    const progress: string[] = [];
    const { fetch, calls } = mockFetch((url) => {
      if (url.endsWith(":predictLongRunning")) return json({ name: "operations/op1" });
      if (url === `${BASE}/operations/op1`)
        return json(
          ++polls < 2
            ? { name: "operations/op1" }
            : {
                name: "operations/op1",
                done: true,
                response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://cdn/v.mp4" } }] } },
              },
        );
      if (url === "https://cdn/v.mp4") return new Response(new Uint8Array([9]), { headers: { "content-type": "video/mp4" } });
      throw new Error(`beklenmeyen ${url}`);
    });
    const p = adapter.generate(
      {
        capability: "first_last_frame",
        quality: "hero",
        prompt: "uçan kuş",
        negativePrompt: "bulanık",
        seed: 3,
        durationSec: 5,
        aspectRatio: "9:16",
        refs: [frame("last_frame", 2), frame("first_frame", 1)],
      },
      { fetch, onProgress: (m) => progress.push(m) },
    );
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.files).toEqual([{ bytes: new Uint8Array([9]), mimeType: "video/mp4" }]);
    expect(progress).toEqual(["işlem başladı (operations/op1)"]);
    expect(calls[0]?.body).toEqual({
      instances: [
        {
          prompt: "uçan kuş",
          image: { bytesBase64Encoded: b64([1]), mimeType: "image/png" },
          lastFrame: { bytesBase64Encoded: b64([2]), mimeType: "image/png" },
        },
      ],
      parameters: { aspectRatio: "9:16", durationSeconds: 6, negativePrompt: "bulanık", seed: 3 },
    });
    // İndirme isteği de anahtarla yapılır.
    expect(calls.at(-1)).toMatchObject({ url: "https://cdn/v.mp4", headers: { "x-goog-api-key": "sahte-anahtar" } });
    expect(polls).toBe(2);
  });

  it("süreyi Veo'nun 4/6/8 sn adımlarına sıkıştırır; görselsiz istekte resim alanı göndermez", async () => {
    const bodies: unknown[] = [];
    const { fetch } = mockFetch((url, call) => {
      if (url.endsWith(":predictLongRunning")) {
        bodies.push(call.body);
        return json({ name: "op" });
      }
      if (url.endsWith("/op"))
        return json({ name: "op", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://v" } }] } } });
      return new Response(new Uint8Array([1]));
    });
    for (const durationSec of [undefined, 1, 7, 30]) {
      await adapter.generate({ capability: "t2v", quality: "standard", durationSec }, { fetch });
    }
    const params = bodies.map((b) => (b as { parameters: Record<string, unknown> }).parameters);
    expect(params).toEqual([
      { aspectRatio: "16:9", durationSeconds: 6 },
      { aspectRatio: "16:9", durationSeconds: 4 },
      { aspectRatio: "16:9", durationSeconds: 8 },
      { aspectRatio: "16:9", durationSeconds: 8 },
    ]);
    expect(bodies[0]).toMatchObject({ instances: [{}] });
    expect(Object.keys((bodies[0] as { instances: object[] }).instances[0]!)).toEqual([]);
  });

  it("karakter referansını ilk kare olarak kullanır", async () => {
    let body: Record<string, unknown> | undefined;
    const { fetch } = mockFetch((url, call) => {
      if (url.endsWith(":predictLongRunning")) {
        body = call.body;
        return json({ name: "op" });
      }
      if (url.endsWith("/op"))
        return json({ name: "op", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://v" } }] } } });
      return new Response(new Uint8Array([1]));
    });
    await adapter.generate({ capability: "i2v", quality: "standard", refs: [frame("character", 4)] }, { fetch });
    expect(body).toMatchObject({ instances: [{ image: { bytesBase64Encoded: b64([4]) } }] });
    expect((body as { instances: Record<string, unknown>[] }).instances[0]).not.toHaveProperty("lastFrame");
  });

  const failing = async (done: Record<string, unknown>) => {
    const { fetch } = mockFetch((url) => {
      if (url.endsWith(":predictLongRunning")) return json({ name: "op" });
      return json({ name: "op", done: true, ...done });
    });
    return adapter.generate({ capability: "t2v", quality: "standard" }, { fetch }).catch((e: unknown) => e);
  };

  it("işlem hatası gönderilmiş iş hatası olarak döner", async () => {
    const err = await failing({ error: { message: "kota" } });
    expect(err).toBeInstanceOf(SubmittedJobError);
    expect(err).toMatchObject({ jobId: "op", message: "gönderilmiş iş başarısız (op): Veo: kota" });
  });

  it("video yoksa filtre nedenlerini, neden de yoksa 'bilinmiyor' der", async () => {
    expect(await failing({ response: { generateVideoResponse: { raiMediaFilteredReasons: ["çocuk", "şiddet"] } } })).toMatchObject({
      message: "gönderilmiş iş başarısız (op): Veo video döndürmedi: çocuk, şiddet",
    });
    expect(await failing({})).toMatchObject({ message: "gönderilmiş iş başarısız (op): Veo video döndürmedi: bilinmiyor" });
    expect(await failing({ response: { generateVideoResponse: { generatedSamples: [{}] } } })).toMatchObject({
      message: expect.stringContaining("bilinmiyor"),
    });
    expect(await failing({ response: { generateVideoResponse: { generatedSamples: [] } } })).toBeInstanceOf(SubmittedJobError);
  });
});
