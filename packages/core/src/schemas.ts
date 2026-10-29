import { z } from "zod";

// ---------- Temel sözlük ----------

export const LanguageCode = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "BCP-47 benzeri dil kodu, örn. tr, en, pt-BR");
export type LanguageCode = z.infer<typeof LanguageCode>;

export const BudgetTier = z.enum(["ultra", "economy", "standard", "premium"]);
export type BudgetTier = z.infer<typeof BudgetTier>;

export const Quality = z.enum(["draft", "standard", "hero"]);
export type Quality = z.infer<typeof Quality>;

export const Capability = z.enum([
  "t2i", // metinden görsel
  "i2i_multiref", // referanslı görsel (karakter/stil tutarlılığı)
  "t2v",
  "i2v", // keyframe'den video
  "first_last_frame",
  "ref2v", // referans setinden video (Kling Elements, Seedance)
  "extend",
  "lipsync",
  "tts",
  "tts_timestamps", // kelime zamanlamalı TTS
  "music",
  "sfx",
  "upscale_image",
  "upscale_video",
  "interpolate",
  "depth",
  "llm", // ajan çağrıları; sadece maliyet defteri için
]);
export type Capability = z.infer<typeof Capability>;

export const ShotKind = z.enum([
  "still_motion",
  "ai_clip",
  "chained_clip",
  "talking_character",
  "motion_graphic",
  "title_card",
  "transition",
]);
export type ShotKind = z.infer<typeof ShotKind>;

// ---------- Kitaplar (tutarlılık) ----------

export const StyleBible = z.object({
  id: z.string(),
  artStyle: z.string(),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  lighting: z.string(),
  lensLanguage: z.string(),
  promptPrefix: z.string(),
  negativeRules: z.array(z.string()).default([]),
  refAssetIds: z.array(z.string()).default([]),
  loraId: z.string().optional(),
});
export type StyleBible = z.infer<typeof StyleBible>;

export const Character = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  turnaroundAssetIds: z.array(z.string()).default([]),
  expressionAssetIds: z.array(z.string()).default([]),
  palette: z.array(z.string()).default([]),
  doNotChange: z.array(z.string()).default([]),
  voiceIds: z.record(z.string(), z.string()).default({}), // provider -> voiceId
  loraId: z.string().optional(),
  providerElementIds: z.record(z.string(), z.string()).default({}), // örn. { "kling": "elm_..." }
});
export type Character = z.infer<typeof Character>;

export const Channel = z.object({
  id: z.string(),
  name: z.string(),
  niche: z.string(),
  sourceLang: LanguageCode,
  targetLangs: z.array(LanguageCode).default([]),
  defaultTier: BudgetTier.default("economy"),
  styleBibleId: z.string().optional(),
  characterIds: z.array(z.string()).default([]),
  publishMode: z.enum(["multi_audio", "per_channel"]).default("multi_audio"),
});
export type Channel = z.infer<typeof Channel>;

// ---------- Ses ve zaman ----------

export const WordTiming = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type WordTiming = z.infer<typeof WordTiming>;

// ---------- Çekim ----------

export const Shot = z
  .object({
    id: z.string(),
    sceneId: z.string(),
    kind: ShotKind,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    minMs: z.number().int().positive(),
    maxMs: z.number().int().positive(),
    description: z.string(),
    camera: z.string().default(""),
    characterIds: z.array(z.string()).default([]),
    locationId: z.string().optional(),
    continuity: z.record(z.string(), z.string()).default({}),
    chainFromShotId: z.string().optional(),
    quality: Quality.default("standard"),
    keyframeAssetId: z.string().optional(),
    clipAssetId: z.string().optional(),
  })
  .refine((s) => s.endMs > s.startMs, "endMs > startMs olmalı")
  .refine((s) => s.minMs <= s.maxMs, "minMs <= maxMs olmalı");
export type Shot = z.infer<typeof Shot>;

// ---------- Timeline (= Remotion inputProps) ----------

/** Durağan karelerin üstüne Remotion'da çizilen, API maliyeti olmayan atmosfer katmanı. */
export const Ambience = z.enum(["none", "rain", "snow", "fog", "dust", "embers", "flicker", "rays"]);
export type Ambience = z.infer<typeof Ambience>;

export const TimelineVisual = z.object({
  shotId: z.string(),
  assetUrl: z.string(),
  kind: ShotKind,
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  motion: z
    .object({
      type: z.enum(["none", "ken_burns", "parallax"]),
      depthAssetUrl: z.string().optional(),
      zoomFrom: z.number().default(1),
      zoomTo: z.number().default(1.1),
      /** -1 (sola) … 1 (sağa) yatay kaydırma. */
      panX: z.number().min(-1).max(1).default(0),
    })
    .optional(),
  ambience: Ambience.default("none"),
  playbackRate: z.number().min(0.5).max(2).default(1),
});

export const TimelineAudio = z.object({
  role: z.enum(["voice", "music", "sfx"]),
  assetUrl: z.string(),
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  volume: z.number().min(0).max(2).default(1),
});

export const Timeline = z.object({
  episodeId: z.string(),
  lang: LanguageCode,
  fps: z.number().int().positive().default(30),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  durationInFrames: z.number().int().positive(),
  visuals: z.array(TimelineVisual),
  audio: z.array(TimelineAudio),
  captions: z.array(WordTiming).default([]),
});
export type Timeline = z.infer<typeof Timeline>;
