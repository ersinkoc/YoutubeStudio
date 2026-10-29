import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ComfyUiAdapter, type ComfyWorkflowSpec } from "./providers/comfyui.ts";
import { ElevenLabsMusicAdapter, ElevenLabsSfxAdapter, ElevenLabsTtsAdapter } from "./providers/elevenlabs.ts";
import { FalAdapter } from "./providers/fal.ts";
import { FAL_MODELS } from "./providers/fal-models.ts";
import { GeminiImageAdapter, GeminiTtsAdapter, VeoAdapter } from "./providers/gemini.ts";
import type { ProviderAdapter } from "./types.ts";

const GEMINI_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";

export const DEFAULT_COMFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../comfy-workflows");

export interface RegistryReport {
  providers: ProviderAdapter[];
  skipped: string[];
}

/** Anahtarı tanımlı olan sağlayıcıları kurar; eksik olanları nedeniyle birlikte raporlar. */
export function createProvidersFromEnv(env: NodeJS.ProcessEnv, comfyDir = DEFAULT_COMFY_DIR): RegistryReport {
  const providers: ProviderAdapter[] = [];
  const skipped: string[] = [];

  // --- Yerel GPU (ComfyUI) ---
  const manifestPath = join(comfyDir, "manifest.json");
  if (env.COMFYUI_URL && existsSync(manifestPath)) {
    const specs = JSON.parse(readFileSync(manifestPath, "utf8")) as ComfyWorkflowSpec[];
    for (const spec of specs) {
      const file = join(comfyDir, spec.file);
      if (!existsSync(file)) {
        skipped.push(`comfy:${spec.id} (workflow dosyası yok: ${spec.file})`);
        continue;
      }
      providers.push(new ComfyUiAdapter(spec, JSON.parse(readFileSync(file, "utf8")), env.COMFYUI_URL));
    }
  } else {
    skipped.push("comfy:* (COMFYUI_URL veya manifest.json yok)");
  }

  // --- fal ---
  if (env.FAL_KEY) {
    const allowUnverified = env.FAL_ENABLE_UNVERIFIED === "1";
    for (const spec of FAL_MODELS) {
      if (spec.verified || allowUnverified) providers.push(new FalAdapter(spec, env.FAL_KEY));
      else skipped.push(`${spec.id} (doğrulanmadı; FAL_ENABLE_UNVERIFIED=1 ile aç)`);
    }
  } else {
    skipped.push("fal:* (FAL_KEY yok)");
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
          note: "1K; $30/1M görsel token. Batch API'de $0.0168",
        },
      }),
      new GeminiImageAdapter({
        id: "gemini:nano-banana-2",
        model: env.GEMINI_IMAGE_FAST_MODEL ?? "gemini-3.1-flash-image",
        apiKey,
        qualityPrior: 0.8,
        price: { unit: "per_output", usd: 0.067 },
        priceSource: { url: GEMINI_PRICING, checked: "2026-10-18", note: "Google'ın listesinde 'legacy'; 2.1'in iki katı" },
      }),
      new GeminiTtsAdapter({
        id: "gemini:tts",
        model: env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-tts",
        apiKey,
        qualityPrior: 0.75,
        price: { unit: "per_1k_chars", usd: 0.03 },
        priceSource: { url: GEMINI_PRICING, checked: "2026-10-29", note: "Token bazlı; 1000 karakter ≈ 1 dk ses ≈ $0.01–0.03" },
      }),
      new VeoAdapter({
        id: "gemini:veo",
        model: env.GEMINI_VEO_MODEL ?? "veo-3.1-generate-preview",
        apiKey,
        qualityPrior: 0.92,
        // Veo 4/6/8 sn üretir.
        price: { unit: "per_second", usd: 0.4, stepSec: 2, minSec: 4 },
        priceSource: { url: GEMINI_PRICING, checked: "2026-10-18", note: "Bu anahtarda Veo modeli listelenmiyor (ücretli katman gerekli)" },
      }),
    );
  } else {
    skipped.push("gemini:* (GEMINI_API_KEY yok)");
  }

  // --- ElevenLabs ---
  if (env.ELEVENLABS_API_KEY) {
    providers.push(
      new ElevenLabsTtsAdapter(env.ELEVENLABS_API_KEY, env.ELEVENLABS_TTS_MODEL ?? "eleven_v3"),
      new ElevenLabsSfxAdapter(env.ELEVENLABS_API_KEY),
      new ElevenLabsMusicAdapter(env.ELEVENLABS_API_KEY),
    );
  } else {
    skipped.push("elevenlabs:* (ELEVENLABS_API_KEY yok)");
  }

  return { providers, skipped };
}
