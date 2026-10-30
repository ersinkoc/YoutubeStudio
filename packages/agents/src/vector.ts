import { FlagSpec, MapSpec, RIG, VectorShot, type AssetPlan, type LineStyle } from "@ys/core";
import { z } from "zod";
import { indexWords } from "./agents.ts";
import { lessonsBlock, models, runStructured, type AgentDeps, type AgentImage, type AgentResult } from "./runner.ts";
import { REFERENCE_QUERY_HINT, type CastOut, type ScriptOut, type StyleBibleOut } from "./schemas.ts";

/**
 * Vektör modu ajanları. Claude yalnız yaratıcı işi yapar: varlık tasarımı (bir kez, kütüphanede saklanır)
 * ve çekim başına kısa sahne JSON'u. Yerleşim fiziği, hareket, iskelet ve yazı efektleri koddadır.
 */

export const VectorAssetOut = z.object({
  svg: z.string().describe("A single complete <svg> element"),
  realHeight: z.number().positive().describe("Real-world height in metres of the artwork as drawn, i.e. what the viewBox height spans (person ~1.7, desk ~0.75, chair ~0.9, an upright book ~0.25, a book lying flat but drawn from the front ~0.05)"),
  grounded: z.boolean().describe("true if it stands on the floor (people, furniture); false for wall or hand-held things"),
  surface: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("For furniture you can put things on or sit on: height of that top surface as a fraction of the drawing height (desk ~0.95, chair seat ~0.5)"),
  floorY: z
    .number()
    .optional()
    .describe("Backgrounds only: y (px) where the back wall meets the floor"),
});
export type VectorAssetOut = z.infer<typeof VectorAssetOut>;

const pivots = Object.entries(RIG.pivots)
  .map(([id, [x, y]]) => `- <g id="${id}">: rotates around (${x}, ${y})`)
  .join("\n");

const SVG_RULES = `SVG rules:
- Output exactly one <svg xmlns="http://www.w3.org/2000/svg" viewBox="..."> element. No width/height attributes.
- Flat vector illustration: paths, rects, circles, ellipses, polygons, linear/radial gradients. Keep it under ~8 KB.
- Forbidden: <script>, <image>, <foreignObject>, <text>, external links, event attributes, CSS @import.
- Colour every shape with presentation attributes (fill="…", stroke="…"). No <style> element and no class attributes: they are stripped, and class-styled shapes turn black.
- Use the given palette; keep shapes bold and readable at small sizes.`;

/** Çizgi stilinin tasarımcıya tarifi; render'da da konturlar bu stile göre eşitlenir. */
export const LINE_STYLE_RULES: Record<LineStyle, string> = {
  outline:
    "Line style: clean cartoon outline — every shape group has a uniform 4 px dark outline (stroke-linejoin round); interior details 2 px.",
  flat: "Line style: no outlines at all — shapes are separated only by colour and value; use a darker shape for shadows and a lighter one for highlights.",
  sketch:
    "Line style: hand-drawn — slightly irregular 3 px dark outlines, a few lines overshooting corners, loose hatching for shadows instead of gradients.",
  ink: "Line style: bold ink illustration — thick black outlines (5–6 px) with varied weight, limited flat fills, strong black shadow shapes.",
};

export interface VectorAssetBrief {
  kind: "character" | "background" | "prop";
  name: string;
  description: string;
  lineStyle?: LineStyle;
  /** Aynı varlığın yeni bir çeşitlemesi istendiğinde 1, 2… */
  variation?: number;
  /** Önceki incelemelerden çıkan çizim kuralları. */
  lessons?: string[];
  /** Gerçek öznenin referans görselleri (internetten bulunan fotoğraf/tablo); varsa ona bakarak çizilir. */
  references?: AgentImage[];
  /** Önceki çizimin referansla karşılaştırılmasından çıkan düzeltmeler. */
  fix?: string;
  /** Çizimden önce hazırlanan plan (assetPlanner); tarifle çeliştiği yerde plan geçerlidir. */
  plan?: AssetPlan;
}

/** Varlık türünün kısıtı: plan bunun dışına çıkan her şeyi "moved" listesine ayırır. */
const KIND_LIMITS: Record<VectorAssetBrief["kind"], string> = {
  character:
    "a single HUMAN puppet standing alone, front view, rest pose (arms hanging, legs straight); code animates walking and gestures. It cannot sit, ride, lie, kneel or hold anything bigger than a hand, and it contains no animals, vehicles, furniture or other people: those become separate props or are left out. Identity comes from build, face, hair, clothing, headgear and small worn items (bag strap, badge, belt tools).",
  background:
    "an EMPTY place seen straight on: sky/landscape or back wall and the ground/floor plane. No people, animals, vehicles or furniture standing on the ground (separate props). Keep the middle band plain; identity comes from architecture, landform, vegetation, windows, distant landmarks and colour of light.",
  prop: "ONE object, animal or vehicle alone on a transparent background, no people. Animals and vehicles in side view standing on all their legs/wheels; objects front or three-quarter view at a readable angle.",
};

export const AssetPlanOut = z.object({
  subject: z.string().describe("One sentence: exactly what this single asset shows, rewritten to fit the asset kind's limits"),
  moved: z
    .array(z.string())
    .max(4)
    .describe("Things from the description that cannot be part of THIS asset (other people, animals, vehicles, an impossible pose) — empty if all fits"),
  pose: z.string().describe("View and pose in a few words (e.g. 'side view, standing on four legs, head slightly lowered')"),
  silhouette: z.string().describe("Overall outline and proportions, e.g. 'horizontal body ~2.2:1, long neck at 45°, legs 45% of total height'"),
  parts: z
    .array(
      z.object({
        name: z.string(),
        count: z.number().int().nullable().describe("How many (4 legs, 2 windows); null when not countable"),
        shape: z.string().describe("Simple geometric description"),
        colour: z.string().describe("Hex colour taken from the references when they show it, otherwise from the palette"),
        where: z.string().describe("Position relative to the whole"),
      }),
    )
    .max(12)
    .describe("The main parts, biggest first"),
  cues: z.array(z.string()).min(2).max(4).describe("The 2–4 features that MUST be visible for a viewer to recognise the subject at a glance"),
  avoid: z.array(z.string()).max(4).describe("Typical mistakes when drawing this subject simply (e.g. 'horse upright on two legs', 'telegraph pole without crossarm and insulators')"),
});
export type AssetPlanOut = z.infer<typeof AssetPlanOut>;

/**
 * Çizim planı: tasarımcıdan önce, referans görsellere bakarak tarifi varlık türüne uydurur ve parçaları, sayıları,
 * renkleri, tanınma ipuçlarını çıkarır. Böylece tasarımcı ne çizeceğini düşünmekle değil çizmekle uğraşır; kapı da
 * aynı ipuçlarına bakar. Yeniden çizimler aynı planı kullanır.
 */
export function assetPlanner(
  brief: Pick<VectorAssetBrief, "kind" | "name" | "description" | "references">,
  style: StyleBibleOut,
  deps?: AgentDeps,
): Promise<AgentResult<AssetPlanOut>> {
  const refs = brief.references ?? [];
  return runStructured(
    {
      name: `asset-planner:${brief.kind}`,
      model: models().fast,
      effort: "low",
      schema: AssetPlanOut,
      system: `You prepare a drawing plan for a vector illustrator of an animated explainer channel. The illustrator draws simple flat shapes; your plan decides WHAT to draw so the result is instantly recognisable and true to reality.
Art style: ${style.artStyle}. Palette: ${style.palette.join(", ")}.
This asset is ${KIND_LIMITS[brief.kind]}
Anything in the description that does not fit these limits goes to "moved", and the subject is rewritten without it (e.g. "rider galloping on a horse" as a character → subject "a young 1860s rider standing, mail pouch strap across the chest", moved ["the horse: separate prop"]).
Be concrete and countable: real proportions, number of legs/wheels/windows, which colours where. Prefer the few big features a viewer recognises over small detail.${refs.length ? `
The ${refs.length} attached image(s) are real references found online; take shapes, proportions and colours from those that show the subject and ignore any that do not.` : ""}`,
      prompt: `${brief.kind === "character" ? "Character" : brief.kind === "background" ? "Location" : "Object"}: ${brief.name}
${brief.description}`,
      images: refs.length ? refs : undefined,
    },
    deps,
  );
}

/** Planın tasarımcıya giden metni. */
export function planBlock(plan: AssetPlan): string {
  const lines = [
    `Drawing plan (prepared from the references; where it differs from the description, the plan wins):`,
    `Subject: ${plan.subject}`,
    plan.pose && `Pose/view: ${plan.pose}`,
    plan.silhouette && `Silhouette: ${plan.silhouette}`,
    plan.parts.length &&
      `Parts:\n${plan.parts.map((p) => `- ${p.name}${p.count !== null ? ` ×${p.count}` : ""}: ${p.shape}, ${p.colour}, ${p.where}`).join("\n")}`,
    plan.cues.length && `Must be clearly visible: ${plan.cues.join("; ")}`,
    plan.avoid.length && `Avoid: ${plan.avoid.join("; ")}`,
    plan.moved.length && `NOT part of this asset (do not draw): ${plan.moved.join("; ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Kapının denetlediği tarif: plan varsa uydurulmuş özne ve tanınma ipuçları (çizilemeyecek şeyler aranmaz). */
export function gateDescription(description: string, plan?: AssetPlan): string {
  if (!plan) return description;
  return [
    plan.subject,
    plan.cues.length && `Must show: ${plan.cues.join("; ")}`,
    plan.moved.length && `Deliberately NOT in this asset (do not penalise their absence): ${plan.moved.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tek bir SVG varlığı tasarlar: iskeletli karakter, oda kabuğu (arka plan) ya da nesne. */
export function vectorDesigner(
  brief: VectorAssetBrief,
  style: StyleBibleOut,
  deps?: AgentDeps,
): Promise<AgentResult<VectorAssetOut>> {
  const canvas =
    brief.kind === "character"
      ? `Canvas: viewBox="0 0 ${RIG.width} ${RIG.height}", character standing, front view, feet at y≈750, centered on x=200. Head about 1/6 of the height (adult proportions, slightly stylised).
The character is a puppet that code animates. Use EXACTLY these group ids; each part rotates around the given point, so draw it in rest pose (arms hanging straight down, legs straight):
${pivots}
Nesting (required): <g id="leg-l"> contains <g id="shin-l"> (lower leg + shoe); same for leg-r/shin-r. <g id="arm-l"> contains the upper arm and <g id="forearm-l"> (forearm + hand); same for arm-r/forearm-r. <g id="head"> contains neck, face, hair, ears, <g id="brows">, <g id="eyes"> and <g id="mouth">.
Draw order: leg-l, leg-r, body, arm-l, arm-r, head. Every part must overlap its neighbour by ~15 px at the joint (round caps at shoulders, elbows, hips and knees) so rotation never opens a gap.
Anatomy: shoulders at y≈300, hips y≈520, knees y≈630, ankles y≈735; arms reach mid-thigh; neck visible; feet point slightly outward.
Quality: a distinctive silhouette and outfit that tells who they are; 2–3 tone shading (a darker shape on the shadow side of face, clothes and limbs); expressive face with brows, eyes with highlights, nose and mouth; simple mitten hands. realHeight is the person's height (adults 1.6–1.9).`
      : brief.kind === "background"
        ? `Canvas: viewBox="0 0 1920 1080". The EMPTY SHELL of the place, seen straight on: back wall (or sky/landscape outdoors), windows, doors, things hanging on the wall, and the floor plane. NO furniture, people, desks, tables, chairs or machines standing on the floor — those are separate props placed by code, otherwise characters end up standing on them.
The wall meets the floor along a horizontal line at floorY (between 620 and 760, return it). Below floorY there is only plain floor (2 tones at most).
Keep it MINIMAL and calm: 6–12 large flat shapes, 2–3 value steps, muted low-saturation colours, low contrast, no small clutter, patterns, stripes or textures. No lettering.
Leave the stage band plain: between x 420–1500 and y 180–floorY the wall is an empty surface (people's heads, gestures and titles go there). Windows, shelves, boards and wall objects go to the left and right thirds or high above y 180. Shelves with many small items (jars, books, bottles) are clutter: use at most one simple shelf with 2–3 large shapes, at the side.`
        : `Canvas: a viewBox sized to the object (e.g. "0 0 400 400"), object centered horizontally, transparent background, its base resting exactly on the bottom edge (y = viewBox height) so code can put it on the floor or on a surface. Objects front or three-quarter view at a readable angle; animals and vehicles in side view on all their legs/wheels. Return realHeight in metres (the real size the viewBox height represents), grounded, and surface for furniture. Small story objects (notes, books, chips, tools) should be drawn filling the canvas at a readable angle, e.g. an open book tilted toward the viewer, not edge-on; code enlarges them to a readable size on screen.`;
  const isolated =
    brief.kind === "background"
      ? ""
      : "\nThe asset is placed over other backgrounds: draw ONLY the subject. No background, panel, frame, badge, circle, glow disc or vignette behind it; everything outside the subject stays transparent. A thin ground-shadow ellipse under the feet/base is fine.";

  return runStructured(
    {
      // Düzeltme çizimi ayrı anahtar: Modeller sayfasında ilk çizimden bağımsız seçilebilir.
      name: brief.fix ? "vector-designer:redraw" : `vector-designer:${brief.kind}`,
      // İlk karakter çizimi Opus (her sahnede kullanılır, kalite en çok burada fark ettirir); kalite kapısının kusur
      // listesiyle yapılan düzeltmeler Sonnet: 30 Eki denemesinde Opus yeniden çizimleri çizim başı $0.10–0.21 tuttu.
      model: brief.kind === "character" && !brief.fix ? models().creative : models().fast,
      effort: "medium",
      schema: VectorAssetOut,
      system: `You are a vector illustrator for an animated explainer channel. You draw clean, consistent SVG assets that will be reused across many scenes and must look like they come from the same hand.
Art style: ${style.artStyle}. Palette: ${style.palette.join(", ")}. Lighting: ${style.lighting}.
${LINE_STYLE_RULES[brief.lineStyle ?? "outline"]}${
        style.designNotes
          ? `\nStyle rules: ${style.designNotes}\nThe canvas, rig and stage rules below always win over the style rules (proportions are fixed by the rig; backgrounds stay calm, any style texture is subtle and kept out of the plain centre band).`
          : ""
      }
${canvas}${isolated}
${SVG_RULES}${lessonsBlock(brief.lessons)}`,
      prompt: `${brief.kind === "character" ? "Character" : brief.kind === "background" ? "Location" : "Object"}: ${brief.name}
${brief.description}${brief.plan ? `\n\n${planBlock(brief.plan)}` : ""}${brief.variation ? `\nThis is variation #${brief.variation}: make a clearly different design while keeping the same identity.` : ""}${
        brief.references?.length
          ? `\n\nThe ${brief.references.length} attached image(s) show the REAL subject. Realism is mandatory: match its silhouette, proportions, colours, materials and the number and arrangement of its distinctive parts (pins, windows, arches, domes, buttons, stripes, headgear, beard, glasses). Simplify textures into flat vector shapes in the art style; do not copy readable text, logos or watermarks. If a reference shows extra things around the subject, draw only the subject.`
          : ""
      }${brief.fix ? `\n\nA quality reviewer rejected your previous drawing. Fix these problems:\n${brief.fix}` : ""}`,
      images: brief.references,
    },
    deps,
  );
}

const VectorPlannedShot = z.object({
  startWord: z.number().int().nonnegative().describe("Index of the narration word where this shot starts"),
  description: z.string().describe("One short English sentence: what the viewer sees"),
  ambience: z.enum(["none", "rain", "snow", "fog", "dust", "embers", "flicker", "rays"]),
  spec: VectorShot,
});

export const VectorSceneOut = z.object({
  shots: z.array(VectorPlannedShot).min(1),
  newProps: z
    .array(
      z.object({
        id: z.string().describe('Short id starting with "p-", e.g. "p-desk"'),
        description: z.string(),
        reference: z.string().optional().describe(REFERENCE_QUERY_HINT),
        flag: FlagSpec.optional().describe("Set for a real national/historical flag: generated exactly from real data instead of drawn"),
      }),
    )
    .max(6)
    .describe("Props used in this scene that are not in the asset list yet (max 6); they will be drawn once and reused"),
  newBackgrounds: z
    .array(
      z.object({
        id: z.string().describe('Short id starting with "b-"'),
        description: z.string(),
        reference: z.string().optional().describe(REFERENCE_QUERY_HINT),
        map: MapSpec.optional().describe("Set for a geographic map or globe: generated from real borders instead of drawn"),
      }),
    )
    .max(2)
    .describe("Extra backgrounds (empty room shells / places) this scene needs that are not in the list, max 2"),
});
export type VectorSceneOut = z.infer<typeof VectorSceneOut>;

export interface VectorSceneInput {
  scene: ScriptOut["scenes"][number];
  durationSec: number;
  cast: CastOut;
  /** Var olan nesne varlıkları (kimlik → tarif). */
  props: Record<string, string>;
  lang: string;
  /** Önceki incelemelerden çıkan yönetmenlik kuralları. */
  lessons?: string[];
  /** Taslak karelerin incelemesinden gelen, bu sahneye özel düzeltme istekleri. */
  feedback?: string;
}

export const STAGING_RULES = `Staging (code does the physics — do not give pixel y or height for things on the floor):
- Real things (a named machine, building, landmark, artwork, uniform, vehicle) get "reference" so they are drawn from a real photo; generic things (a desk, a cup) do not need it.
- Real-world facts are never drawn from memory. A map, globe, country outline, border, front line or route is a background with "map" (ISO alpha-3 country codes, cities as markers with lon/lat, journeys as routes; "globe" for planet scale); people can stand in front of it. A national flag is a prop with "flag" (ISO alpha-2 code, or "ottoman"); pole=true for a standing flag, false to hold it or hang it. Historical borders are not in the data: show a historical realm by highlighting the modern countries that roughly cover its core with a label like "≈ Osmanlı toprakları (1683)", plus its cities as markers.
- Backgrounds are empty room shells. Furniture (desk, table, chair, machine, shelf) is a prop you place on the floor.
- Floor placement: give x (0–1920, bottom-centre) and depth (0 = right at the camera, 0.3 = front of the room, 0.6 = middle, 1 = against the back wall). Code computes where the feet/base touch the floor, the perspective scale and the real size; things with larger depth are drawn behind.
- Behind furniture: a person behind a desk gets a larger depth than the desk (desk 0.25, person 0.4); the desk then hides their legs. In front: smaller depth.
- Sitting: put the person "on" the chair's layer index (chair at depth d, the person is seated on it; legs fold automatically). For a desk worker: chair behind desk, person on chair.
- Objects on furniture: "on": index of the desk/table layer and an x within its width (paper, chip, calculator, lamp on a desk).
- Holding: "heldBy": index of the character layer; the object follows the right hand (use explain/point/think gestures to show it).
- Wall items (clock, poster, board on the wall, window props): give y (their bottom edge) and height in px, no depth.
- Size truth: a chip or a coin is tiny next to a person; to show a small object, hold it, put it on a desk and use a close-up (camera zoom 1.6–2.2 with focusX/focusY on it).
- Group people at different x (at least ~250 px apart at the same depth) or different depths; never stack them.`;

/** Bir sahnenin tüm çekimlerini kısa vektör tarifleri olarak planlar. */
export function vectorDirector(
  input: VectorSceneInput,
  style: StyleBibleOut,
  deps?: AgentDeps,
): Promise<AgentResult<VectorSceneOut>> {
  const { annotated } = indexWords(input.scene.narration);
  const assets = [
    ...input.cast.characters.map((c) => `- ${c.id} (character, rigged): ${c.name}, ${c.role}`),
    ...input.cast.locations.map((l) => `- ${l.id} (background room shell): ${l.name}`),
    ...Object.entries(input.props).map(([id, d]) => `- ${id} (${id.startsWith("b-") ? "background room shell" : "prop"}): ${d}`),
  ].join("\n");

  return runStructured(
    {
      name: "vector-director",
      model: models().fast,
      effort: "medium",
      schema: VectorSceneOut,
      system: `You direct an animated explainer video drawn entirely from reusable vector assets on a 1920×1080 canvas. Code animates and stages everything you specify; be concrete.
Rules:
- Split the narration into shots by the word index where each shot starts (first shot 0, strictly increasing). Shots last 4–9 seconds; cut on meaning.
- Each shot: background (a room-shell id), layers, texts, camera, mood, ambience. Layer indexes ("on", "heldBy") refer to positions in the same shot's layers array.
${STAGING_RULES}
- Animations (start/end are fractions 0–1 of the shot): fade_in, fade_out, slide_in (from), pop, float, sway, pulse, spin, shake, move (toX/toY); characters also walk (toX), wave, point, explain, think, cheer, surprised, shrug, nod, talk; texts also typewriter, count_up.
- Faces: set "expression" on every character layer to the emotion of the narration at that moment (happy, sad, angry, worried, surprised, thinking; neutral only when flat). Disappointment or failure is sad/worried, never a smile.
- Characters must act: give every visible character at least one gesture that fits the narration (explain while a fact is told, think on a question, surprised on a twist, cheer on success, point at a prop or text, walk to enter). Idle breathing, blinking and small hand moves are added automatically.
- Use "talk" only when that character speaks; the narrator is off-screen.
- On-screen texts: at most 2 per shot, ≤ 5 words each, in language "${input.lang}". Only dates, numbers, names or one key term; never repeat the narration sentence (subtitles already show it). Place them in the top half (y 100–500), not over faces. style: title | subtitle | label | number | quote. Many shots need no text at all.
- Show what the narration says: every concrete object, document, device or action named in a shot must be visible in that shot. Reuse listed assets; if one is missing, use a new id starting with "p-" and describe it in newProps (front view, no text on it). Up to 6 new props per scene.
- Avoid repetition: consecutive shots must differ in background, framing or layout. Mix wide shots (whole room), medium shots (zoom ~1.3 on people) and close-ups (zoom 1.6–2.2 with focusX/focusY on a face or object). New places: id "b-…" in newBackgrounds (up to 2 per scene).
- mood sets the colour grade: day, warm (nostalgia, success), cool (tension, technology), night, dramatic (twist, crisis), neutral. Follow the emotional arc.
- ambience must fit the place: rain/snow outdoors, dust in old rooms, flicker for lamp light, rays for sunlight, fog for night or mystery, else none.
Visual style: ${style.artStyle}.${lessonsBlock(input.lessons)}${input.feedback ? `\n\nA reviewer looked at the rendered draft of this scene. Fix these problems in your new plan:\n${input.feedback}` : ""}`,
      prompt: `Assets:
${assets}

## ${input.scene.id} (${input.durationSec.toFixed(1)} s, location: ${input.scene.location}, emotion: ${input.scene.emotion})
Visual intent: ${input.scene.visualIntent}
Narration: ${annotated}`,
    },
    deps,
  );
}

export const PropPhysicsOut = z.object({
  realHeight: z.number().positive().describe("Real height of the object in metres (a desk ~0.75, a horse ~1.6, a letter ~0.28)"),
  grounded: z.boolean().describe("true if it stands on the floor/ground (furniture, animals, vehicles); false if it is held or hangs"),
  surface: z.number().min(0).max(1).nullable().describe("For furniture with a top that things stand on: that surface height as a fraction of the object height; else null"),
});
export type PropPhysicsOut = z.infer<typeof PropPhysicsOut>;

/**
 * Hazır (Commons) SVG'nin fiziksel bilgisi: tasarımcı çizmediği için boy ve zemin bilgisini ucuz bir ajan verir;
 * yerleşim çözücüsü bunlarla ölçekler.
 */
export function propPhysics(name: string, description: string, deps?: AgentDeps): Promise<AgentResult<PropPhysicsOut>> {
  return runStructured(
    {
      name: "prop-physics",
      model: models().cheap,
      effort: "low",
      schema: PropPhysicsOut,
      system: "You give the real-world physical size of an object for placing it correctly in an animated scene. Use typical real dimensions.",
      prompt: `Object: ${name}\n${description}`,
    },
    deps,
  );
}
