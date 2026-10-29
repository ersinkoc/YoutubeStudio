import { models, runStructured, type AgentDeps, type AgentImage, type AgentResult } from "./runner.ts";
import { CastOut, FrameReviewOut, ScriptOut, ShotPlanOut, StoryOut, StyleBibleOut } from "./schemas.ts";

/*
 * Model'e giden talimatlar İngilizce (görsel modeller de İngilizce prompt bekliyor);
 * izleyicinin duyacağı anlatım ise bölümün dilinde yazdırılır.
 */

export interface EpisodeBrief {
  topic: string;
  lang: string;
  targetSec: number;
  styleHint?: string;
  audience?: string;
  /** Kanalın ses kimliği için ölçülmüş konuşma hızı; yoksa dil varsayılanı. */
  wordsPerMinute?: number;
}

/**
 * Anlatım hızı (kelime/dk). Eklemeli dillerde kelimeler uzun olduğu için dakikadaki kelime az.
 * tr: 29 Eki ölçümü, ElevenLabs v3 "George": 455 kelime → 239 sn ≈ 114 kelime/dk
 * (150 varsayımıyla bölüm %33 uzun çıktı).
 */
const WPM_BY_LANG: Record<string, number> = {
  tr: 115,
  fi: 110,
  hu: 115,
  de: 125,
  ar: 120,
  en: 150,
  es: 155,
  pt: 150,
  fr: 150,
  id: 135,
  hi: 140,
};

export function wordsPerMinute(brief: Pick<EpisodeBrief, "lang" | "wordsPerMinute">): number {
  return brief.wordsPerMinute || WPM_BY_LANG[brief.lang.split("-")[0]!] || 140;
}

export function artDirector(brief: EpisodeBrief, deps?: AgentDeps): Promise<AgentResult<StyleBibleOut>> {
  return runStructured(
    {
      name: "art-director",
      model: models().fast,
      effort: "medium",
      schema: StyleBibleOut,
      system: `You are the art director of an animated YouTube channel. Define a visual style that an image model can reproduce consistently across 100+ frames.
Rules:
- Favor stylized illustration over photorealism (cheaper, more consistent, no synthetic-media disclosure).
- Every frame is a full-bleed video frame. The style must NOT include borders, frames, ornamental margins, panels, page/paper edges or book layouts — even for historical art styles, describe only rendering technique, palette and texture.
- Never include text, letters, logos or watermarks.`,
      prompt: `Topic: ${brief.topic}\nAudience: ${brief.audience ?? "general"}\nStyle hint: ${brief.styleHint ?? "none — choose what fits the topic"}`,
    },
    deps,
  );
}

export function storyArchitect(brief: EpisodeBrief, deps?: AgentDeps): Promise<AgentResult<StoryOut>> {
  return runStructured(
    {
      name: "story-architect",
      model: models().creative,
      effort: "high",
      schema: StoryOut,
      system: `You design long-form YouTube stories built for retention.
Rules:
- Hook in the first 15 seconds; re-hook every 60–90 seconds with an open loop.
- Beat durations must sum to the target duration (±10%).
- Original angle; no generic listicle structure; no real-person impersonation.
- Write title, logline, premise, hook and beat summaries in the episode language (${brief.lang}).`,
      prompt: `Topic: ${brief.topic}\nEpisode language: ${brief.lang}\nTarget duration: ${brief.targetSec} seconds\nAudience: ${brief.audience ?? "general"}`,
    },
    deps,
  );
}

export function screenwriter(brief: EpisodeBrief, story: StoryOut, deps?: AgentDeps): Promise<AgentResult<ScriptOut>> {
  const wpm = wordsPerMinute(brief);
  const targetWords = Math.round((brief.targetSec / 60) * wpm);
  return runStructured(
    {
      name: "screenwriter",
      model: models().creative,
      effort: "high",
      schema: ScriptOut,
      system: `You write voice-over narration for animated YouTube videos.
Rules:
- Narration language: ${brief.lang}. Natural spoken rhythm, short sentences, vivid concrete images.
- Total narration ≈ ${targetWords} words (${wpm} wpm for this voice/language). This is a hard length budget: stay within ±10%. Scenes 20–60 seconds each.
- Narration must be speakable: no brackets, emojis, stage directions or URLs. Spell out numbers.
- visualIntent and location are in English for the image pipeline. Reuse location names exactly.`,
      prompt: `Story:\n${JSON.stringify(story, null, 2)}`,
    },
    deps,
  );
}

/** Anlatımı kelime indeksleriyle gösterir; Director çekim başlangıçlarını bu indekslerle verir. */
export function indexWords(narration: string): { words: string[]; annotated: string } {
  const words = narration.split(/\s+/).filter(Boolean);
  return { words, annotated: words.map((w, i) => `[${i}]${w}`).join(" ") };
}

/** Senaryodaki tekrar eden karakter ve mekânları çıkarır; tutarlılığın temeli (plan §6). */
export function castingDirector(script: ScriptOut, style: StyleBibleOut, deps?: AgentDeps): Promise<AgentResult<CastOut>> {
  return runStructured(
    {
      name: "casting-director",
      model: models().fast,
      effort: "medium",
      schema: CastOut,
      system: `You are the casting and production designer of an animated video.
From the script, list the recurring on-screen characters and locations that must look identical every time they appear.
Rules:
- Only include characters/locations shown in 2+ shots or central to the story. Crowds and one-off extras are NOT characters.
- visualDescription is a fixed, specific design an illustrator can redraw identically (no "maybe", no alternatives).
- Each location is ONE physical place seen in one view. Never merge places ("lamp room and keeper's room" must be two locations) — merged places get drawn as split-screen images.
- A character that changes over the story (e.g. chick → adult) is described in the look it has in most shots.
- Never put readable text in a description (signs, notes, book pages): image models render it as letters. Say "a paper notice" instead of quoting it.
- Historical/real figures: depict respectfully in the given art style; never depict prophets or religious figures.
Art style: ${style.artStyle}.`,
      prompt: script.scenes
        .map((s) => `## ${s.id} (location: ${s.location})\nVisual intent: ${s.visualIntent}\nNarration: ${s.narration}`)
        .join("\n\n"),
    },
    deps,
  );
}

export type MotionMode = "animated" | "mixed" | "still";

const MOTION_RULES: Record<MotionMode, (ratio: number) => string> = {
  animated: () =>
    `- Every shot is "ai_clip" (the whole video is animated). Shots last 3–5 seconds: clips are billed in 5-second blocks, so a 6-second shot costs as much as a 10-second one. Each motionPrompt describes one clear, simple motion that fits the shot.`,
  mixed: (ratio) =>
    `- About ${Math.round(ratio * 100)}% of shots should be "ai_clip" (real motion needed: action, transformation). All others "still_motion" (parallax/Ken Burns on a still). Shots last 3–8 seconds.`,
  still: () => `- Every shot is "still_motion" (parallax/Ken Burns on a still). Shots last 3–8 seconds.`,
};

export function director(
  script: ScriptOut,
  style: StyleBibleOut,
  sceneDurationsSec: Record<string, number>,
  opts: { aiClipRatio: number; motionMode?: MotionMode; cast?: CastOut },
  deps?: AgentDeps,
): Promise<AgentResult<ShotPlanOut>> {
  const scenes = script.scenes
    .map((s) => {
      const { annotated } = indexWords(s.narration);
      return `## ${s.id} (${(sceneDurationsSec[s.id] ?? 0).toFixed(1)} s, location: ${s.location}, emotion: ${s.emotion})\nVisual intent: ${s.visualIntent}\nNarration: ${annotated}`;
    })
    .join("\n\n");
  const cast = opts.cast
    ? `Cast (reference images exist for these; use their ids):\n${opts.cast.characters.map((c) => `- ${c.id} ${c.name}: ${c.role}`).join("\n")}\n${opts.cast.locations.map((l) => `- ${l.id} ${l.name}`).join("\n")}\n\n`
    : "";

  return runStructured(
    {
      name: "director",
      model: models().fast,
      effort: "medium",
      schema: ShotPlanOut,
      system: `You are a film director planning shots for an animated narrated video.
Rules:
- For every scene, split the narration into shots by giving the word index where each shot starts. The first shot of a scene starts at 0; indices strictly increase.
- Estimate shot length from scene duration / word count. Cut on meaning, not mid-phrase.
${MOTION_RULES[opts.motionMode ?? "mixed"](opts.aiClipRatio)}
- imagePrompt: one concrete frame, describe action, composition, framing. The style prefix and the cast/location reference images are added automatically — refer to cast members by name, do not redescribe their looks. Never ask for text in the image.
- characterIds/locationId: tag every shot with the cast ids that appear in it, so reference images can be attached.
- ambience: a subtle animated overlay that makes still_motion shots feel alive. It must match what is in the frame: "rain"/"snow" only outdoors in that weather, "fog" for night, mist or mystery, "dust" for old rooms, workshops, attics, "embers" near fire or forges, "flicker" for candle/lamp/screen light, "rays" for sunlight through windows or trees. Use "none" when nothing fits; keep the same ambience across shots of one location and moment.
Visual style for reference: ${style.artStyle}.`,
      prompt: cast + scenes,
    },
    deps,
  );
}

export interface FrameReviewInput {
  frame: AgentImage;
  /** Kadro referansları; kimlik karşılaştırması için. */
  refs: { image: AgentImage; label: string }[];
  description: string;
  imagePrompt: string;
  /** Karede görünmesi beklenen karakter adları. */
  characters: string[];
}

/** Üretilen kareyi ucuz bir görsel modelle denetler; yazı, kolaj, çift karakter gibi hataları yakalar. */
export function frameInspector(input: FrameReviewInput, deps?: AgentDeps): Promise<AgentResult<FrameReviewOut>> {
  const refList = input.refs.map((r, i) => `Image ${i + 2}: reference for ${r.label}`).join("\n");
  return runStructured(
    {
      name: "frame-inspector",
      model: models().cheap,
      effort: "low",
      schema: FrameReviewOut,
      images: [input.frame, ...input.refs.map((r) => r.image)],
      system: `You are a strict quality inspector for keyframes of an animated narrated video. Image 1 is the generated frame; any further images are cast reference sheets.
Report only real, visible problems:
- text: any readable letters, words, numbers, signs, captions or watermarks in image 1.
- panels: image 1 is a collage, comic panels, split screen, book page or has borders/frames.
- duplicate_character: the same character appears more than once.
- wrong_character: an expected character does not match its reference (face, hair, outfit), or an unexpected main character appears.
- anatomy: extra or missing limbs/fingers, melted faces, broken objects that a viewer would notice.
- missing_subject: the frame does not show what the shot description asks for.
- off_style: the art style clearly differs from the references.
Small stylistic imperfections are not issues. Score 8–10 for usable frames, 5–7 for noticeable but tolerable flaws, 0–4 for frames that must be redrawn.
fix: one short instruction that would prevent the problems when redrawing (e.g. "show Hasan only once, no signs or lettering"), or empty.`,
      prompt: `Shot description: ${input.description}
Image prompt used: ${input.imagePrompt}
Expected characters: ${input.characters.length ? input.characters.join(", ") : "none specified"}
${refList}`,
    },
    deps,
  );
}
