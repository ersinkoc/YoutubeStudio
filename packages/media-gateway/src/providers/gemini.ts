import { LocalizedError, msg, type Capability } from "@ys/core";
import { toWav } from "../audio.ts";
import { afterSubmit } from "../types.ts";
import { fromBase64, pollUntil, requestBytes, requestJson, toBase64 } from "../http.ts";
import {
  ContentRejectedError,
  promptWithAvoid,
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

/** Eşzamanlı üretim çağrıları (görsel, TTS) dakikalar sürebilir; varsayılan 120 sn yerine bu sınır. */
const GENERATION_TIMEOUT_MS = 300_000;

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
  if (res.promptFeedback?.blockReason) throw new ContentRejectedError(msg("gw.gemini.blocked", { reason: res.promptFeedback.blockReason }));
  const candidate = res.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const data = parts.flatMap((p) => (p.inlineData ? [p.inlineData] : []));
  if (data.length === 0) {
    // Görsel yerine metin ya da güvenlik sonlandırması: nedeni hata mesajına taşı ki prompt düzeltilebilsin.
    const text = parts.map((p) => p.text ?? "").join(" ").trim();
    const reason = candidate?.finishReason ?? msg("gw.noReason");
    throw new ContentRejectedError(
      text ? msg("gw.gemini.noImageText", { reason, text: text.slice(0, 200) }) : msg("gw.gemini.noImage", { reason }),
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
      // generateContent'te olumsuz prompt alanı yok: kaçınılacaklar prompt'a "Avoid:" olarak eklenir.
      { text: promptWithAvoid(req.prompt, req.negativePrompt) ?? "" },
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
        timeoutMs: GENERATION_TIMEOUT_MS,
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
        timeoutMs: GENERATION_TIMEOUT_MS,
      },
    );
    const audio = inlineParts(res)[0];
    // inlineParts boş listede zaten hata verir; bu satır yalnız tip daraltması için.
    /* v8 ignore next */
    if (!audio) throw new LocalizedError(msg("gw.gemini.noAudio"));
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? 24_000);
    return { files: [{ bytes: toWav(fromBase64(audio.data), rate), mimeType: "audio/wav" }] };
  }
}

/** Omni video üretimi dakikalar sürebilir; eşzamanlı çağrı bu sınırla beklenir. */
const OMNI_TIMEOUT_MS = 900_000;

interface OmniContent {
  type: string;
  data?: string;
  uri?: string;
  mime_type?: string;
  text?: string;
}

interface OmniInteraction {
  id?: string;
  status?: string;
  steps?: { type: string; content?: OmniContent[] }[];
  error?: { message?: string };
}

interface GeminiFile {
  state?: "PROCESSING" | "ACTIVE" | "FAILED";
}

/**
 * Gemini Omni 1.1 Flash ile video (Gemini API'de kapatılan Veo'nun önerilen yerine geçeni). Kaynak:
 * https://ai.google.dev/gemini-api/docs/omni (31 Eki 2026). POST /interactions eşzamanlıdır: görsel(ler) ve metin
 * `input` listesinde, görev `generation_config.video_config.task = "image_to_video"`, en-boy ve çözünürlük
 * `response_format`'ta. İki görsel verilirse ilk ve son kare arası geçiş üretir. Süre parametresi yok: istenen süre
 * metne yazılır, klip render'da çekim süresine kırpılır. Video `steps[type=model_output].content[type=video]`
 * içinde base64 (`data`) ya da büyükse dosya adresi (`uri`; dosya ACTIVE olana dek beklenir) olarak gelir.
 *
 * DOĞRULANMADI: yanıt biçimi yalnız belgeden; gerçek bir çağrıyla denenmedi. registry yalnız GEMINI_OMNI_VIDEO=1 iken kurar.
 */
export class OmniVideoAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["t2v", "i2v", "first_last_frame"];
  readonly limits: ProviderLimits = { maxRefs: 2, minDurationSec: 2, maxDurationSec: 10, aspectRatios: ["16:9", "9:16"] };
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
    const images = [first, last].flatMap((r) => (r ? [{ type: "image", data: toBase64(r.bytes), mime_type: r.mimeType }] : []));
    const seconds = Math.round(req.durationSec ?? 5);
    // Süre ve ses alanı yok: ikisi de metinle yönlendirilir (belge önerisi). Ses kendi hattımızdan gelir.
    const text = [
      promptWithAvoid(req.prompt, req.negativePrompt),
      `Duration: about ${seconds} seconds.`,
      req.withAudio ? "" : "No dialogue, no music.",
      last ? "Transition from the first image to the second image." : "",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await requestJson<OmniInteraction>(ctx.fetch, `${BASE}/interactions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.cfg.model,
        input: [...images, { type: "text", text }],
        ...(images.length ? { generation_config: { video_config: { task: "image_to_video" } } } : {}),
        response_format: { type: "video", aspect_ratio: req.aspectRatio ?? "16:9", resolution: "720p" },
      }),
      signal: ctx.signal,
      timeoutMs: OMNI_TIMEOUT_MS,
    });
    if (res.error?.message) throw new LocalizedError(msg("gw.omni.error", { error: res.error.message }));
    const video = (res.steps ?? []).flatMap((s) => (s.type === "model_output" ? (s.content ?? []) : [])).find((c) => c.type === "video");
    if (!video?.data && !video?.uri) throw new ContentRejectedError(msg("gw.omni.noVideo", { status: res.status ?? msg("gw.unknown") }));
    if (video.data) return { files: [{ bytes: fromBase64(video.data), mimeType: video.mime_type ?? "video/mp4" }], providerMeta: { requestId: res.id } };

    // Büyük çıktı dosya olarak gelir: işlenmesi bitene dek beklenir, sonra indirilir.
    const uri = video.uri!;
    const name = /files\/[^/?:]+/.exec(uri)?.[0];
    if (!name) throw new LocalizedError(msg("gw.omni.badUri", { uri }));
    return afterSubmit(res.id ?? name, async () => {
      await pollUntil(
        async () => {
          const f = await requestJson<GeminiFile>(ctx.fetch, `${BASE}/${name}`, { headers, signal: ctx.signal });
          if (f.state === "FAILED") throw new LocalizedError(msg("gw.omni.fileFailed", { name }));
          return f.state === "ACTIVE" ? f : undefined;
        },
        { intervalMs: 5_000, signal: ctx.signal },
      );
      const file = await requestBytes(ctx.fetch, `${BASE}/${name}:download?alt=media`, { headers: { "x-goog-api-key": this.cfg.apiKey }, signal: ctx.signal });
      return { files: [{ bytes: file.bytes, mimeType: "video/mp4" }], providerMeta: { requestId: res.id } };
    });
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

/**
 * Veo 3.x: metinden/keyframe'den video, ilk+son kare geçişi. Uzun süren işlem olarak çalışır.
 *
 * DOĞRULANMADI: varsayılan model veo-3.1-generate-preview 22 Eki 2026'da Gemini API'de kapatıldı
 * (https://ai.google.dev/gemini-api/docs/deprecations); registry bu adapter'ı yalnız GEMINI_VEO_MODEL verilince kurar.
 * Görsel alanları (`bytesBase64Encoded`) ve sayı olarak `durationSeconds` kapanmadan önce çalışan biçimdi; resmî
 * Gemini API belgesinde predictLongRunning gövdesi artık yayımlanmıyor, `inlineData`/metin süre biçimi teyit
 * edilemedi. Yeni modelde 400 alınırsa önce bu iki alana bakın.
 */
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
      if (done.error) throw new LocalizedError(msg("gw.veo.error", { error: done.error.message }));
      const res = done.response?.generateVideoResponse;
      const uri = res?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new LocalizedError(msg("gw.veo.noVideo", { reasons: res?.raiMediaFilteredReasons?.join(", ") ?? msg("gw.unknown") }));

      const video = await requestBytes(ctx.fetch, uri, { headers: { "x-goog-api-key": this.cfg.apiKey } });
      return { files: [{ bytes: video.bytes, mimeType: "video/mp4" }] };
    });
  }
}
