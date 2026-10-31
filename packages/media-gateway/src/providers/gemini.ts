import type { Capability } from "@ys/core";
import { toWav } from "../audio.ts";
import { afterSubmit } from "../types.ts";
import { fromBase64, pollUntil, requestBytes, requestJson, toBase64 } from "../http.ts";
import {
  ContentRejectedError,
  type GenerateContext,
  type GenerationRequest,
  type GenerationResult,
  type OutputFile,
  type PriceRule,
  type PriceSource,
  type ProviderAdapter,
  type ProviderLimits,
} from "../types.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface InlineData {
  mimeType: string;
  data: string;
}

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string; inlineData?: InlineData }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

interface GeminiModelConfig {
  id: string;
  model: string;
  apiKey: string;
  qualityPrior: number;
  price: PriceRule;
  priceSource?: PriceSource;
}

function inlineParts(res: GenerateContentResponse): InlineData[] {
  if (res.promptFeedback?.blockReason) throw new ContentRejectedError(`Gemini engelledi: ${res.promptFeedback.blockReason}`);
  const candidate = res.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const data = parts.flatMap((p) => (p.inlineData ? [p.inlineData] : []));
  if (data.length === 0) {
    // Görsel yerine metin ya da güvenlik sonlandırması: nedeni hata mesajına taşı ki prompt düzeltilebilsin.
    const text = parts.map((p) => p.text ?? "").join(" ").trim();
    throw new ContentRejectedError(
      `Gemini görsel döndürmedi (${candidate?.finishReason ?? "neden yok"})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  return data;
}

/** Nano Banana ailesi (Gemini görsel modelleri): metinden ve çok referanstan görsel. */
export class GeminiImageAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["t2i", "i2i_multiref"];
  readonly limits: ProviderLimits = { maxRefs: 14 };
  readonly id: string;
  readonly qualityPrior: number;
  readonly price: PriceRule;
  readonly priceSource?: PriceSource;

  constructor(private readonly cfg: GeminiModelConfig) {
    this.id = cfg.id;
    this.qualityPrior = cfg.qualityPrior;
    this.price = cfg.price;
    this.priceSource = cfg.priceSource;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const parts = [
      ...(req.refs ?? []).map((r) => ({ inlineData: { mimeType: r.mimeType, data: toBase64(r.bytes) } })),
      { text: req.prompt ?? "" },
    ];
    const res = await requestJson<GenerateContentResponse>(
      ctx.fetch,
      `${BASE}/models/${this.cfg.model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: req.aspectRatio ?? "16:9" },
          },
        }),
        signal: ctx.signal,
      },
    );
    const files: OutputFile[] = inlineParts(res).map((d) => ({ bytes: fromBase64(d.data), mimeType: d.mimeType }));
    return { files };
  }
}

/** Gemini TTS: çok ucuz, token bazlı; ham PCM döner, WAV'a sarılır. Kelime zamanlaması yok (yerel Whisper ile hizalanır). */
export class GeminiTtsAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["tts"];
  readonly limits: ProviderLimits = {};
  readonly id: string;
  readonly qualityPrior: number;
  readonly price: PriceRule;
  readonly priceSource?: PriceSource;

  constructor(
    private readonly cfg: GeminiModelConfig,
    private readonly defaultVoice = "Kore",
  ) {
    this.id = cfg.id;
    this.qualityPrior = cfg.qualityPrior;
    this.price = cfg.price;
    this.priceSource = cfg.priceSource;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const res = await requestJson<GenerateContentResponse>(
      ctx.fetch,
      `${BASE}/models/${this.cfg.model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: req.prompt ? `${req.prompt}\n\n${req.text ?? ""}` : (req.text ?? "") }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voiceId ?? this.defaultVoice } } },
          },
        }),
        signal: ctx.signal,
      },
    );
    const audio = inlineParts(res)[0];
    // inlineParts boş listede zaten hata verir; bu satır yalnız tip daraltması için.
    /* v8 ignore next */
    if (!audio) throw new Error("Gemini TTS ses döndürmedi");
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? 24_000);
    return { files: [{ bytes: toWav(fromBase64(audio.data), rate), mimeType: "audio/wav" }] };
  }
}

interface VeoOperation {
  name: string;
  done?: boolean;
  error?: { message: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
      raiMediaFilteredReasons?: string[];
    };
  };
}

/** Veo 3.x: metinden/keyframe'den video, ilk+son kare geçişi. Uzun süren işlem olarak çalışır. */
export class VeoAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["t2v", "i2v", "first_last_frame"];
  readonly limits: ProviderLimits = { maxRefs: 2, minDurationSec: 4, maxDurationSec: 8, aspectRatios: ["16:9", "9:16"] };
  readonly id: string;
  readonly qualityPrior: number;
  readonly price: PriceRule;
  readonly priceSource?: PriceSource;

  constructor(private readonly cfg: GeminiModelConfig) {
    this.id = cfg.id;
    this.qualityPrior = cfg.qualityPrior;
    this.price = cfg.price;
    this.priceSource = cfg.priceSource;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const headers = { "x-goog-api-key": this.cfg.apiKey, "Content-Type": "application/json" };
    const first = req.refs?.find((r) => r.role === "first_frame" || r.role === "character");
    const last = req.refs?.find((r) => r.role === "last_frame");
    const asImage = (r: { bytes: Uint8Array; mimeType: string }) => ({
      bytesBase64Encoded: toBase64(r.bytes),
      mimeType: r.mimeType,
    });

    const op = await requestJson<VeoOperation>(ctx.fetch, `${BASE}/models/${this.cfg.model}:predictLongRunning`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instances: [
          {
            prompt: req.prompt,
            ...(first ? { image: asImage(first) } : {}),
            ...(last ? { lastFrame: asImage(last) } : {}),
          },
        ],
        parameters: {
          aspectRatio: req.aspectRatio ?? "16:9",
          // Veo yalnız 4/6/8 sn üretir; faturalama ile aynı yuvarlama (2 sn adım, en az 4).
          durationSeconds: Math.min(8, Math.max(4, Math.ceil((req.durationSec ?? 5) / 2) * 2)),
          ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
      }),
      signal: ctx.signal,
    });
    ctx.onProgress?.(`işlem başladı (${op.name})`);

    // Gönderildi: bundan sonraki hata ücretlendirilmiş bir işin hatasıdır.
    return afterSubmit(op.name, async () => {
      const done = await pollUntil(
        async () => {
          const o = await requestJson<VeoOperation>(ctx.fetch, `${BASE}/${op.name}`, { headers, signal: ctx.signal });
          return o.done ? o : undefined;
        },
        { intervalMs: 10_000, signal: ctx.signal },
      );
      if (done.error) throw new Error(`Veo: ${done.error.message}`);
      const res = done.response?.generateVideoResponse;
      const uri = res?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new Error(`Veo video döndürmedi: ${res?.raiMediaFilteredReasons?.join(", ") ?? "bilinmiyor"}`);

      const video = await requestBytes(ctx.fetch, uri, { headers: { "x-goog-api-key": this.cfg.apiKey } });
      return { files: [{ bytes: video.bytes, mimeType: "video/mp4" }] };
    });
  }
}
