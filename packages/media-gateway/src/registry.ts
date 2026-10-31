import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ComfyUiAdapter, type ComfyWorkflowSpec } from "./providers/comfyui.ts";
import { ElevenLabsMusicAdapter, ElevenLabsSfxAdapter, ElevenLabsTtsAdapter } from "./providers/elevenlabs.ts";
import { FalAdapter } from "./providers/fal.ts";
import { FAL_MODELS } from "./providers/fal-models.ts";
import { GeminiImageAdapter, GeminiTtsAdapter, OmniVideoAdapter, VeoAdapter } from "./providers/gemini.ts";
import { msg, type Msg } from "@ys/core";
import type { ProviderAdapter } from "./types.ts";

const GEMINI_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";

/**
 * Gemini 3.8 Flash TTS 1000 karakter başı tahmini. Kaynak: https://ai.google.dev/gemini-api/docs/pricing (31 Eki 2026):
 * ses çıktısı $9/1M token (31 Ara 2026'ya kadar), 1 Oca 2027'den $18/1M; 25 token = 1 sn ses; metin girdisi
 * $0.50 → $1.00/1M token. Varsayım: anlatım ~14 karakter/sn (Türkçe/İngilizce olağan hız) → 1000 karakter ≈ 71 sn ses
 * ≈ 1786 ses tokeni ≈ $0.0161; girdi (~400 token) ≈ $0.0002. Toplam ≈ $0.0163 → $0.017 (2027'den $0.033).
 */
export function geminiTtsPricePer1k(now: Date): number {
  return now.getTime() >= Date.UTC(2027, 0, 1) ? 0.033 : 0.017;
}

/**
 * Gemini API'de kapatılmış Veo kimlikleri (https://ai.google.dev/gemini-api/docs/deprecations, 31 Eki 2026): hepsinin
 * kapanış tarihi geçti, yerine gemini-omni-1.1-flash öneriliyor. Bunlardan biri yazılıysa sağlayıcı kurulmaz; yoksa
 * premium seviyede yönlendirici ölü modeli seçip her çekimde hata alıyordu.
 */
const VEO_SHUT_DOWN = new Set([
  "veo-2.0-generate-001",
  "veo-3.0-generate-001",
  "veo-3.0-fast-generate-001",
  "veo-3.0-generate-preview",
  "veo-3.0-fast-generate-preview",
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
]);

export const DEFAULT_COMFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../comfy-workflows");

export interface RegistryReport {
  providers: ProviderAdapter[];
  /** Kurulmayan sağlayıcılar ve nedenleri (Stüdyo'da seçili dilde, CLI'da trText ile). */
  skipped: Msg[];
}

/** Anahtarı tanımlı olan sağlayıcıları kurar; eksik olanları nedeniyle birlikte raporlar. */
export function createProvidersFromEnv(
  env: NodeJS.ProcessEnv,
  comfyDir = DEFAULT_COMFY_DIR,
  now = new Date(),
): RegistryReport {
  const providers: ProviderAdapter[] = [];
  const skipped: Msg[] = [];

  // --- Yerel GPU (ComfyUI) ---
  const manifestPath = join(comfyDir, "manifest.json");
  if (env.COMFYUI_URL && existsSync(manifestPath)) {
    const specs = JSON.parse(readFileSync(manifestPath, "utf8")) as ComfyWorkflowSpec[];
    for (const spec of specs) {
      const file = join(comfyDir, spec.file);
      if (!existsSync(file)) {
        skipped.push(msg("gw.skip.comfyFile", { id: spec.id, file: spec.file }));
        continue;
      }
      providers.push(new ComfyUiAdapter(spec, JSON.parse(readFileSync(file, "utf8")), env.COMFYUI_URL));
    }
  } else {
    skipped.push(msg("gw.skip.comfy"));
  }

  // --- fal ---
  if (env.FAL_KEY) {
    const allowUnverified = env.FAL_ENABLE_UNVERIFIED === "1";
    for (const spec of FAL_MODELS) {
      if (spec.verified || allowUnverified) providers.push(new FalAdapter(spec, env.FAL_KEY));
      else skipped.push(msg("gw.skip.unverified", { id: spec.id }));
    }
  } else {
    skipped.push(msg("gw.skip.noKey", { scope: "fal:*", key: "FAL_KEY" }));
  }

  // --- Google Gemini ---
  if (env.GEMINI_API_KEY) {
    const apiKey = env.GEMINI_API_KEY;
    providers.push(
      new GeminiImageAdapter({
        id: "gemini:nano-banana-pro",
        model: env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image",
        apiKey,
        qualityPrior: 0.9,
        price: { unit: "per_output", usd: 0.134 },
        priceSource: { url: GEMINI_PRICING, checked: "2026-10-18", note: "1K–2K; 4K $0.24" },
      }),
      new GeminiImageAdapter({
        id: "gemini:nano-banana-2.1",
        model: env.GEMINI_IMAGE_CHEAP_MODEL ?? "gemini-nano-banana-2.1",
        apiKey,
        qualityPrior: 0.8,
        price: { unit: "per_output", usd: 0.0336 },
        priceSource: {
          url: "https://www.developersdigest.tech/blog/image-video-generation-api-pricing-2026",
          checked: "2026-10-18",
          note: msg("price.note.nanoBanana21"),
        },
      }),
      new GeminiImageAdapter({
        id: "gemini:nano-banana-2",
        model: env.GEMINI_IMAGE_FAST_MODEL ?? "gemini-3.1-flash-image",
        apiKey,
        qualityPrior: 0.8,
        price: { unit: "per_output", usd: 0.067 },
        priceSource: { url: GEMINI_PRICING, checked: "2026-10-18", note: msg("price.note.nanoBanana2") },
      }),
      new GeminiTtsAdapter({
        id: "gemini:tts",
        model: env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-tts",
        apiKey,
        qualityPrior: 0.75,
        price: { unit: "per_1k_chars", usd: geminiTtsPricePer1k(now) },
        priceSource: {
          url: GEMINI_PRICING,
          checked: "2026-10-31",
          note: msg("price.note.geminiTts"),
        },
      }),
    );
    // veo-3.1-generate-preview 22 Eki 2026'da kapatıldı (https://ai.google.dev/gemini-api/docs/deprecations; yerine
    // gemini-omni-1.1-flash önerilir, o ayrı bir API). Veo yalnız açıkça model verilince kurulur, doğrulanmamış sayılır.
    // Veo'nun yerine Gemini Omni Flash: yanıt biçimi gerçek çağrıyla doğrulanana dek yalnız açıkça.
    if (env.GEMINI_OMNI_VIDEO === "1") {
      providers.push(
        new OmniVideoAdapter({
          id: "gemini:omni-video",
          model: env.GEMINI_OMNI_MODEL ?? "gemini-omni-1.1-flash",
          apiKey,
          // Kling 3 standardın (0.75) üstünde, Kling 3 Pro'nun (0.85) altında: denenene dek tahmin.
          qualityPrior: 0.8,
          // $17.50/1M video çıktı tokeni ≈ 720p'de $0.10/sn (belgedeki tahmin). Süre istenemediği için en az 5 sn sayılır.
          price: { unit: "per_second", usd: 0.1, minSec: 5 },
          priceSource: { url: GEMINI_PRICING, checked: "2026-10-31", note: msg("price.note.omni") },
        }),
      );
    } else {
      skipped.push(msg("gw.skip.omni"));
    }
    if (env.GEMINI_VEO_MODEL && VEO_SHUT_DOWN.has(env.GEMINI_VEO_MODEL)) {
      skipped.push(msg("gw.skip.veoShutDown", { model: env.GEMINI_VEO_MODEL }));
    } else if (env.GEMINI_VEO_MODEL) {
      providers.push(
        new VeoAdapter({
          id: "gemini:veo",
          model: env.GEMINI_VEO_MODEL,
          apiKey,
          qualityPrior: 0.92,
          // Veo 4/6/8 sn üretir.
          price: { unit: "per_second", usd: 0.4, stepSec: 2, minSec: 4 },
          priceSource: {
            url: GEMINI_PRICING,
            checked: "2026-10-18",
            note: msg("price.note.veo"),
          },
        }),
      );
    } else {
      skipped.push(msg("gw.skip.veo"));
    }
  } else {
    skipped.push(msg("gw.skip.noKey", { scope: "gemini:*", key: "GEMINI_API_KEY" }));
  }

  // --- ElevenLabs ---
  if (env.ELEVENLABS_API_KEY) {
    providers.push(
      new ElevenLabsTtsAdapter(env.ELEVENLABS_API_KEY, env.ELEVENLABS_TTS_MODEL ?? "eleven_v3"),
      new ElevenLabsSfxAdapter(env.ELEVENLABS_API_KEY),
      new ElevenLabsMusicAdapter(env.ELEVENLABS_API_KEY, env.ELEVENLABS_MUSIC_MODEL ?? "music_v1"),
    );
  } else {
    skipped.push(msg("gw.skip.noKey", { scope: "elevenlabs:*", key: "ELEVENLABS_API_KEY" }));
  }

  return { providers, skipped };
}
