import type { Capability } from "@ys/core";
import { charAlignmentToWords } from "../audio.ts";
import { fromBase64, requestBytes, requestJson } from "../http.ts";
import type {
  GenerateContext,
  GenerationRequest,
  GenerationResult,
  PriceRule,
  ProviderAdapter,
  ProviderLimits,
} from "../types.ts";

const BASE = "https://api.elevenlabs.io/v1";

interface TimestampResponse {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

/** Eleven v3 TTS + karakter hizalaması → kelime zamanlamaları (timeline'ın omurgası). */
export class ElevenLabsTtsAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["tts", "tts_timestamps"];
  readonly limits: ProviderLimits = { requiresVoiceId: true };
  readonly id = "elevenlabs:tts";
  readonly qualityPrior = 0.9;
  readonly price: PriceRule = { unit: "per_1k_chars", usd: 0.1 };

  constructor(
    private readonly apiKey: string,
    private readonly model = "eleven_v3",
  ) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    if (!req.voiceId || !req.text) throw new Error("ElevenLabs TTS için voiceId ve text gerekli");
    const res = await requestJson<TimestampResponse>(
      ctx.fetch,
      `${BASE}/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: req.text,
          model_id: this.model,
          ...(req.language ? { language_code: req.language } : {}),
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        }),
        signal: ctx.signal,
      },
    );
    const a = res.alignment;
    return {
      files: [{ bytes: fromBase64(res.audio_base64), mimeType: "audio/mpeg" }],
      words: a
        ? charAlignmentToWords(a.characters, a.character_start_times_seconds, a.character_end_times_seconds)
        : undefined,
    };
  }
}

/** Ses efekti üretimi. Kanal SFX kütüphanesini bir kez doldurmak için (§18). */
export class ElevenLabsSfxAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["sfx"];
  readonly limits: ProviderLimits = { maxDurationSec: 30 };
  readonly id = "elevenlabs:sfx";
  readonly qualityPrior = 0.85;
  readonly price: PriceRule = { unit: "per_minute", usd: 0.12 };

  constructor(private readonly apiKey: string) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const audio = await requestBytes(ctx.fetch, `${BASE}/sound-generation`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: req.prompt,
        ...(req.durationSec !== undefined ? { duration_seconds: req.durationSec } : {}),
      }),
      signal: ctx.signal,
    });
    return { files: [{ bytes: audio.bytes, mimeType: "audio/mpeg" }] };
  }
}

/** Eleven Music: ticari lisanslı müzik. Kanal müzik kütüphanesi için tek seferlik üretim (§18). */
export class ElevenLabsMusicAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["music"];
  readonly limits: ProviderLimits = { minDurationSec: 10, maxDurationSec: 300 };
  readonly id = "elevenlabs:music";
  readonly qualityPrior = 0.85;
  readonly price: PriceRule = { unit: "per_minute", usd: 0.8 };

  constructor(private readonly apiKey: string) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const audio = await requestBytes(ctx.fetch, `${BASE}/music`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: req.prompt, music_length_ms: Math.round((req.durationSec ?? 60) * 1000) }),
      signal: ctx.signal,
    });
    return { files: [{ bytes: audio.bytes, mimeType: "audio/mpeg" }] };
  }
}
