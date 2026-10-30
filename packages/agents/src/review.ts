import { z } from "zod";
import { models, runStructured, type AgentDeps, type AgentImage, type AgentResult } from "./runner.ts";

/**
 * Üretim sonrası inceleme: render edilmiş çekim karelerine bakıp kusurları ve genel dersleri çıkarır.
 * Dersler kalıcı kayda yazılır ve sonraki bölümlerde ilgili ajanların talimatına eklenir; orkestratör böylece
 * her bölümden öğrenir.
 */

export const ShotIssueType = z.enum([
  "text_overlap",
  "text_on_subtitles",
  "unreadable_text",
  "cluttered",
  "empty",
  "character_cut_off",
  "character_floating",
  "wrong_scale",
  "backdrop_box",
  "repetitive",
  "off_story",
  "other",
]);

export const LessonTarget = z.enum(["director", "designer", "script"]);
export type LessonTarget = z.infer<typeof LessonTarget>;

export const SceneCriticOut = z.object({
  shots: z.array(
    z.object({
      shotId: z.string(),
      score: z.number().int().min(0).max(10).describe("How good the frame is as a video frame, 10 = great"),
      issues: z.array(z.object({ type: ShotIssueType, detail: z.string() })),
    }),
  ),
  lessons: z
    .array(z.object({ target: LessonTarget, rule: z.string().describe("One short imperative rule, in English") }))
    .describe("General rules that would have prevented the problems (not shot-specific), at most 3"),
});
export type SceneCriticOut = z.infer<typeof SceneCriticOut>;

export interface CriticShot {
  shotId: string;
  image: AgentImage;
  /** Çekimin ne göstermesi gerektiği ve o andaki anlatım. */
  intent: string;
}

/** Bir grup çekim karesini denetler (ucuz görsel model). */
export function sceneCritic(shots: CriticShot[], known: string[], deps?: AgentDeps): Promise<AgentResult<SceneCriticOut>> {
  return runStructured(
    {
      name: "scene-critic",
      model: models().cheap,
      effort: "low",
      schema: SceneCriticOut,
      images: shots.map((s) => s.image),
      system: `You review frames of an animated explainer video (flat vector style, subtitles at the bottom). Image N belongs to the N-th shot listed in the prompt.
Report only problems a viewer would notice:
- text_overlap: on-screen texts overlap each other or a face; text_on_subtitles: text sits in the bottom quarter where subtitles go; unreadable_text: low contrast or tiny.
- cluttered: too many elements or a busy background competing with the subject; empty: nothing meaningful on screen.
- character_cut_off / character_floating / wrong_scale: placement problems; backdrop_box: a character or prop shows its own rectangle/disc background.
- repetitive: looks the same as the previous frames (same colours, same layout); off_story: does not match the intent.
lessons: up to 3 general rules (not about a single shot) for the director (layout, texts, mood), the designer (drawing assets) or the script, only if a problem appears in several shots. Skip rules already known:
${known.map((k) => `- ${k}`).join("\n") || "- (none yet)"}`,
      prompt: shots.map((s, i) => `Image ${i + 1} = ${s.shotId}: ${s.intent}`).join("\n"),
    },
    deps,
  );
}

export const LessonCuratorOut = z.object({
  rules: z
    .array(
      z.object({
        rule: z.string().describe("One concise imperative rule in English"),
        sources: z.array(z.number().int().nonnegative()).describe("Indexes of the input rules merged into this one"),
      }),
    )
    .max(10),
});
export type LessonCuratorOut = z.infer<typeof LessonCuratorOut>;

/** Birbirine benzeyen dersleri en fazla 10 net kurala birleştirir (defter şişmesin, talimat kısa kalsın). */
export function lessonCurator(target: LessonTarget, rules: string[], deps?: AgentDeps): Promise<AgentResult<LessonCuratorOut>> {
  return runStructured(
    {
      name: "lesson-curator",
      model: models().cheap,
      effort: "low",
      schema: LessonCuratorOut,
      system: `You maintain the rulebook of the ${target} agent in an automated video studio. Merge rules that say the same thing, drop vague ones, and keep at most 10 short, concrete, non-overlapping imperative rules. Every input index must appear in exactly one output rule's sources unless you drop it as vague.`,
      prompt: rules.map((r, i) => `${i}: ${r}`).join("\n"),
    },
    deps,
  );
}
