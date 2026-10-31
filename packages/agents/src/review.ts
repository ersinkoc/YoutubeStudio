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

/**
 * Bir grup çekim karesini denetler (ucuz görsel model). `subtitles` false ise videoda gömülü altyazı yoktur:
 * alt çeyrek resme aittir, orada duran şey kusur sayılmaz.
 */
export function sceneCritic(shots: CriticShot[], known: string[], deps?: AgentDeps, subtitles = true): Promise<AgentResult<SceneCriticOut>> {
  return runStructured(
    {
      name: "scene-critic",
      model: models().cheap,
      effort: "low",
      schema: SceneCriticOut,
      images: shots.map((s) => s.image),
      system: `You review frames of an animated explainer video (flat vector style, ${subtitles ? "subtitles at the bottom" : "no burned-in subtitles: the bottom of the frame belongs to the picture"}). Image N belongs to the N-th shot listed in the prompt.
Report only problems a viewer would notice:
- text_overlap: on-screen texts overlap each other or a face; ${subtitles ? "text_on_subtitles: text sits in the bottom quarter where subtitles go; " : ""}unreadable_text: low contrast or tiny.
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

// ---------------- kalite kapısı ----------------

export const AssetGuessOut = z.object({
  guess: z.string().describe("What this drawing shows, in a few plain English words (e.g. 'a brown dog standing', 'a desk with drawers', 'unclear blob')"),
  confidence: z.number().int().min(0).max(10).describe("How sure you are, 10 = obvious at a glance"),
});
export type AssetGuessOut = z.infer<typeof AssetGuessOut>;

/**
 * Kör tanıma: denetçi çizimin ne olduğunu, amaçlanan adı bilmeden söyler. "At" diye çizilen şey "köpek" diye
 * tanınıyorsa kapı geçilmez (adı bilen denetçi iyimser davranır).
 */
export function assetGuess(drawing: AgentImage, deps?: AgentDeps): Promise<AgentResult<AssetGuessOut>> {
  return runStructured(
    {
      name: "asset-guess",
      model: models().cheap,
      effort: "low",
      schema: AssetGuessOut,
      system:
        "You see one flat vector illustration (an asset for an animated video) on a white background. Say plainly what it depicts. If it is an indistinct shape, a scribble or you cannot tell, say so and give low confidence. Do not be generous.",
      prompt: "What does this drawing show?",
      images: [drawing],
    },
    deps,
  );
}

export const AssetGateOut = z.object({
  recognizable: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe("Would a viewer recognise the intended subject in one second without a caption? 10 = unmistakable, ≤4 = blob, scribble, wrong thing or broken"),
  fidelity: z
    .number()
    .int()
    .min(0)
    .max(10)
    .nullable()
    .describe("Faithfulness to ONE specific real subject (a named person, building, model, artifact) in the references that actually show it: shape, proportions, colours, distinctive parts. null without references, when no reference shows the subject, or when the subject is a generic kind (a desert, a horse, a desk) for which references are only inspiration"),
  defects: z
    .array(z.string())
    .max(6)
    .describe("Concrete, fixable defects, most important first (e.g. 'horse has 3 legs', 'head merges into the body', 'chip has 5 pins, real one has 8 per side')"),
});
export type AssetGateOut = z.infer<typeof AssetGateOut>;

/**
 * Kalite kapısı: çizim amaçlanan özne olarak tanınıyor mu, anatomisi/yapısı sağlam mı, referans varsa gerçeğe sadık
 * mı. Karar kodda (QUALITY_GATE); bu ajan yalnız puanlar ve kusurları listeler.
 */
export function assetGate(
  input: {
    kind: "character" | "prop" | "background";
    name: string;
    description: string;
    guess: AssetGuessOut;
    drawing: AgentImage;
    references?: AgentImage[];
    /** Kanalın sanat stili ve paleti: paletin dayattığı renk ve stilin basamaklı/eskiz çizgisi kusur sayılmasın. */
    style?: { artStyle: string; palette: string[] };
  },
  deps?: AgentDeps,
): Promise<AgentResult<AssetGateOut>> {
  const refs = input.references ?? [];
  const what =
    input.kind === "character"
      ? "a person (puppet character); check a believable human figure: one head, two arms, two legs, hands at the ends of arms, face features in place, nothing floating or detached"
      : input.kind === "background"
        ? "an intentionally EMPTY room shell or place backdrop (furniture is added separately, so emptiness is fine); check that the space reads as the intended kind of place, shapes are coherent and nothing is broken or garbled"
        : "an object, animal or vehicle; check it has the correct parts in the correct number and arrangement (legs, wheels, handles…) and a silhouette that reads at a glance";
  return runStructured(
    {
      name: "asset-gate",
      model: models().cheap,
      effort: "low",
      schema: AssetGateOut,
      system: `You are a strict quality gate for vector assets of an animated explainer channel. Flat, simplified cartoon style is expected and is not a defect. Wrong subject, broken anatomy, missing or extra parts, disconnected pieces and unreadable shapes are defects.
Anatomy and posture must be right for what the subject IS: an animal stands in its natural posture on its real number of legs (a horse on four legs, never upright like a person), a vehicle has its wheels on the ground, a person has human proportions. A subject drawn in an impossible pose or body plan scores recognizable ≤4 even if you can tell what it is meant to be.
Judge recognisability at the level a general viewer can: a niche identity (a specific job, person, model or era) only has to read as its general category WITH the described distinguishing features (a Pony Express rider reads as a young 1860s western rider with a mail bag; the guess "cowboy" is fine if those features are there).
References come from a web search and can be wrong: ignore any reference that does not show the subject (a book page, an unrelated scene). If none of them shows the subject, or the subject is a generic kind rather than one specific real thing, fidelity is null.
The asset is ${what}.${refs.length ? ` The first ${refs.length} image(s) are real reference photos/paintings of the subject; the LAST image is the drawing.` : " The image is the drawing."}`,
      prompt: `Intended subject: ${input.name}
Description: ${input.description}
A viewer who was NOT told the name looked at the drawing and said: "${input.guess.guess}" (confidence ${input.guess.confidence}/10). If that does not match the intended subject, recognizable must be low.${
        input.style
          ? `\nChannel art style: ${input.style.artStyle}. Palette: ${input.style.palette.join(", ")}. Colours forced by this palette (e.g. an all-blue blueprint look) and the style's own rendering (pixel stepping, sketchy or ink lines, flat fills) are NOT defects; when the palette cannot show the real colours, judge fidelity on shape, parts and proportions instead.`
          : ""
      }`,
      images: [...refs, input.drawing],
    },
    deps,
  );
}
