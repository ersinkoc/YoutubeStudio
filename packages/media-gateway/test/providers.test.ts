import { describe, expect, it } from "vitest";
import {
  ElevenLabsTtsAdapter,
  FAL_MODELS,
  FalAdapter,
  charAlignmentToWords,
  fillPlaceholders,
  pcm16ToWav,
  type GenerateContext,
} from "../src/index.ts";

type Handler = (url: string, init?: RequestInit) => Response;

function mockFetch(handler: Handler): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });

describe("audio", () => {
  it("karakter hizalamasını kelimelere çevirir", () => {
    const chars = [..."Merhaba dünya"];
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.1);
    expect(charAlignmentToWords(chars, starts, ends)).toEqual([
      { text: "Merhaba", startMs: 0, endMs: 700 },
      { text: "dünya", startMs: 800, endMs: 1300 },
    ]);
  });

  it("PCM'i geçerli WAV başlığıyla sarar", () => {
    const wav = pcm16ToWav(new Uint8Array(480), 24_000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(40, true)).toBe(480);
    expect(wav.length).toBe(524);
  });
});

describe("fillPlaceholders", () => {
  it("tek yer tutucuda tipi korur, metin içinde gömer", () => {
    const graph = { "3": { inputs: { seed: "{{seed}}", text: "stil: {{prompt}}", keep: "{{unknown}}" } } };
    expect(fillPlaceholders(graph, { seed: 42, prompt: "kedi" })).toEqual({
      "3": { inputs: { seed: 42, text: "stil: kedi", keep: "{{unknown}}" } },
    });
  });
});

describe("FalAdapter", () => {
  it("kuyruğa gönderir, tamamlanmayı bekler, çıktıyı indirir", async () => {
    let polls = 0;
    const { fetch, calls } = mockFetch((url) => {
      if (url === "https://queue.fal.run/fal-ai/flux/dev")
        return json({ request_id: "r1", status_url: "https://q/status", response_url: "https://q/resp" });
      if (url === "https://q/status") return json({ status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" });
      if (url === "https://q/resp") return json({ images: [{ url: "https://cdn/img.png" }], seed: 7 });
      if (url === "https://cdn/img.png") return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } });
      throw new Error(`beklenmeyen ${url}`);
    });
    const spec = FAL_MODELS.find((m) => m.id === "fal:flux-dev")!;
    const ctx: GenerateContext = { fetch };
    const realSetTimeout = globalThis.setTimeout;
    // Testte bekleme süresini sıfırla.
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      const res = await new FalAdapter(spec, "k").generate({ capability: "t2i", quality: "draft", prompt: "kedi" }, ctx);
      expect(res.files).toEqual([{ bytes: new Uint8Array([1, 2]), mimeType: "image/png" }]);
      expect(res.providerMeta).toMatchObject({ requestId: "r1", seed: 7 });
      expect(calls[0]).toBe("POST https://queue.fal.run/fal-ai/flux/dev");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

describe("ElevenLabsTtsAdapter", () => {
  it("sesi ve kelime zamanlamalarını döndürür", async () => {
    let body: Record<string, unknown> = {};
    const { fetch, calls } = mockFetch((_url, init) => {
      body = JSON.parse(String(init?.body));
      return json({
        audio_base64: Buffer.from([9, 9]).toString("base64"),
        alignment: {
          characters: [..."Hi yo"],
          character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4],
          character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5],
        },
      });
    });
    const res = await new ElevenLabsTtsAdapter("k").generate(
      { capability: "tts_timestamps", quality: "standard", text: "Hi yo", voiceId: "v1", language: "en" },
      { fetch },
    );
    expect(calls[0]).toContain("/text-to-speech/v1/with-timestamps");
    expect(body).toMatchObject({ text: "Hi yo", model_id: "eleven_v3", language_code: "en" });
    expect(res.files[0]?.mimeType).toBe("audio/mpeg");
    expect(res.words).toEqual([
      { text: "Hi", startMs: 0, endMs: 200 },
      { text: "yo", startMs: 300, endMs: 500 },
    ]);
  });
});
