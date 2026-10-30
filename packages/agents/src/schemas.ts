import { Ambience } from "@ys/core";
import { z } from "zod";

export const StyleBibleOut = z.object({
  artStyle: z.string().describe("One-line name of the visual style"),
  promptPrefix: z
    .string()
    .describe("English prompt fragment prepended to every image prompt; locks medium, rendering, palette, lighting"),
  negativeRules: z.array(z.string()).describe("Things that must never appear"),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(3).max(8),
  lighting: z.string(),
  lensLanguage: z.string(),
});
export type StyleBibleOut = z.infer<typeof StyleBibleOut>;

export const Beat = z.object({
  id: z.string().describe("b1, b2, ..."),
  purpose: z.string().describe("hook | setup | rising | twist | climax | resolution | cta ..."),
  summary: z.string(),
  retentionHook: z.string().describe("Open loop or curiosity gap that keeps viewers watching past this beat"),
  approxSec: z.number().int().positive(),
});

export const StoryOut = z.object({
  title: z.string(),
  logline: z.string(),
  premise: z.string(),
  hook: z.string().describe("What happens in the first 15 seconds"),
  beats: z.array(Beat).min(3),
});
export type StoryOut = z.infer<typeof StoryOut>;

export const Scene = z.object({
  id: z.string().describe("s1, s2, ..."),
  beatId: z.string(),
  narration: z.string().describe("Exact voice-over text in the episode language. No stage directions."),
  visualIntent: z.string().describe("English: what the viewer should see during this scene"),
  emotion: z.string(),
  location: z.string().describe("English short location name; reuse the same name for the same place"),
});

export const ScriptOut = z.object({
  scenes: z.array(Scene).min(1),
});
export type ScriptOut = z.infer<typeof ScriptOut>;

/** Gerçek bir şeyin referans görseli için arama sorgusu (Wikipedia/Commons); tasarımcı görseli görerek çizer. */
export const REFERENCE_QUERY_HINT = "For a REAL person, place, building, object, uniform, vehicle or artwork: a short English search query that finds a photo or painting of it on Wikipedia/Wikimedia (e.g. \"Intel C4004\", \"Hagia Sophia exterior\", \"Mehmed II Bellini portrait\", \"Janissary uniform 17th century\"). Omit for invented or generic things.";

export const CastCharacter = z.object({
  id: z.string().describe("c1, c2, ..."),
  name: z.string(),
  role: z.string(),
  visualDescription: z
    .string()
    .describe("English. Fixed look for the whole episode: age, build, face, hair/beard, clothing, colors, distinctive marks"),
  reference: z.string().optional().describe("For a REAL person, place, building, object, uniform, vehicle or artwork: a short English search query that finds a photo or painting of it on Wikipedia/Wikimedia (e.g. \"Intel C4004\", \"Hagia Sophia exterior\", \"Mehmed II Bellini portrait\", \"Janissary uniform 17th century\"). Omit for invented or generic things."),
  scenes: z.array(z.string()),
});

export const CastLocation = z.object({
  id: z.string().describe("l1, l2, ..."),
  name: z.string(),
  visualDescription: z.string().describe("English. Architecture, materials, props, light, time of day"),
  reference: z.string().optional().describe("For a REAL person, place, building, object, uniform, vehicle or artwork: a short English search query that finds a photo or painting of it on Wikipedia/Wikimedia (e.g. \"Intel C4004\", \"Hagia Sophia exterior\", \"Mehmed II Bellini portrait\", \"Janissary uniform 17th century\"). Omit for invented or generic things."),
  scenes: z.array(z.string()),
});

export const CastOut = z.object({
  characters: z.array(CastCharacter).max(6),
  locations: z.array(CastLocation).max(8),
});
export type CastOut = z.infer<typeof CastOut>;

export const PlannedShot = z.object({
  startWord: z.number().int().nonnegative().describe("Index of the narration word where this shot starts"),
  characterIds: z.array(z.string()).describe("Cast character ids visible in this shot (max 3)"),
  locationId: z.string().describe("Cast location id of this shot, or empty string"),
  kind: z.enum(["still_motion", "ai_clip"]),
  description: z.string(),
  imagePrompt: z
    .string()
    .describe("English image prompt for the keyframe, WITHOUT the style prefix; no text or letters in the image"),
  motionPrompt: z.string().describe("English camera/subject motion for animation"),
  camera: z.enum(["push_in", "pull_out", "pan_left", "pan_right", "static"]),
  ambience: Ambience.describe("Procedural atmosphere overlay drawn on still_motion shots"),
});

export const SceneShots = z.object({
  sceneId: z.string(),
  shots: z.array(PlannedShot).min(1),
});

export const ShotPlanOut = z.object({
  scenes: z.array(SceneShots),
});
export type ShotPlanOut = z.infer<typeof ShotPlanOut>;

export const FrameIssue = z.object({
  type: z.enum([
    "text",
    "panels",
    "duplicate_character",
    "wrong_character",
    "anatomy",
    "missing_subject",
    "off_style",
    "other",
  ]),
  detail: z.string().describe("Short English description of the problem"),
});

export const FrameReviewOut = z.object({
  score: z.number().int().min(0).max(10).describe("Overall usability of the frame for the shot, 10 = perfect"),
  issues: z.array(FrameIssue),
  fix: z.string().describe("English instruction to add to the image prompt to fix the issues, or empty string"),
});
export type FrameReviewOut = z.infer<typeof FrameReviewOut>;

export const ScriptDoctorOut = z.object({
  notes: z.array(z.string()).describe("Most important problems fixed, one line each"),
  script: ScriptOut,
});
export type ScriptDoctorOut = z.infer<typeof ScriptDoctorOut>;
