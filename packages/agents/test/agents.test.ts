import { describe, expect, it } from "vitest";
import { AssetPlan } from "@ys/core";
import {
  AgentError,
  artDirector,
  assetGate,
  assetGuess,
  assetPlanner,
  castingDirector,
  director,
  frameInspector,
  lessonCurator,
  LINE_STYLE_RULES,
  models,
  planBlock,
  propPhysics,
  sceneCritic,
  scriptDoctor,
  screenwriter,
  storyArchitect,
  stylePicker,
  vectorDesigner,
  vectorDirector,
  type AgentDeps,
  type CastOut,
  type QueryFn,
  type ScriptOut,
  type StoryOut,
  type StyleBibleOut,
} from "../src/index.ts";

interface Captured {
  prompt: string;
  system: string;
  model: string;
  options: Record<string, unknown>;
  /** Akış girdisiyle gönderilen görsel bloklarının base64 verisi. */
  images: string[];
}

/** Ajanın Claude'a ne gönderdiğini yakalar; sonuç olarak model hatası döner (para harcanmaz, ağ yok). */
async function capture(run: (deps: AgentDeps) => Promise<unknown>): Promise<Captured> {
  let params: { prompt: unknown; options: Record<string, unknown> } | undefined;
  const queryFn = ((p: typeof params) => {
    params = p;
    return (async function* () {
      yield { type: "result", subtype: "error_max_turns", duration_ms: 1, total_cost_usd: 0 };
    })();
  }) as unknown as QueryFn;
  await expect(run({ queryFn })).rejects.toThrow(AgentError);
  let prompt = params!.prompt;
  const images: string[] = [];
  if (typeof prompt !== "string") {
    for await (const m of prompt as AsyncIterable<{ message: { content: { type: string; text?: string; source?: { data: string } }[] } }>) {
      for (const c of m.message.content) if (c.type === "image") images.push(c.source!.data);
      prompt = m.message.content.at(-1)!.text;
    }
  }
  return { prompt: prompt as string, system: params!.options.systemPrompt as string, model: params!.options.model as string, options: params!.options, images };
}

const brief = { topic: "Pony Express", lang: "tr", targetSec: 120 };
const style: StyleBibleOut = {
  artStyle: "flat retro",
  promptPrefix: "flat",
  negativeRules: [],
  palette: ["#111111", "#222222", "#333333"],
  lighting: "soft",
  lensLanguage: "wide",
};
const story: StoryOut = { title: "T", logline: "L", premise: "P", hook: "H", beats: [] };
const script: ScriptOut = {
  scenes: [
    { id: "s1", beatId: "b1", narration: "Bir gün  atlı geldi", visualIntent: "rider arrives", emotion: "tense", location: "station" },
    { id: "s2", beatId: "b2", narration: "Son", visualIntent: "end", emotion: "calm", location: "desert" },
  ],
};
const cast: CastOut = {
  characters: [{ id: "c1", name: "Billy", kind: "person", role: "rider", visualDescription: "young", scenes: ["s1"] }],
  locations: [{ id: "l1", name: "Station", visualDescription: "wooden", scenes: ["s1"] }],
};
const img = (n: number) => ({ data: new Uint8Array([n]), mimeType: "image/png" });

describe("senaryo ajanları", () => {
  it("sanat yönetmeni ve stil seçici: kitle/stil ipucu yoksa varsayılan yazılır", async () => {
    const a = await capture((d) => artDirector(brief, d));
    expect(a.prompt).toBe("Topic: Pony Express\nAudience: general\nStyle hint: none — choose what fits the topic");
    const b = await capture((d) => artDirector({ ...brief, audience: "kids", styleHint: "noir" }, d));
    expect(b.prompt).toBe("Topic: Pony Express\nAudience: kids\nStyle hint: noir");

    const packs = [{ id: "noir", artStyle: "film noir", suits: "crime" }, { id: "neon", artStyle: "synthwave", suits: "1980s" }];
    const c = await capture((d) => stylePicker(brief, packs, d));
    expect(c.system).toContain("- noir: film noir. Suits: crime\n- neon: synthwave. Suits: 1980s");
    expect(c.prompt).toBe("Topic: Pony Express\nAudience: general\nStyle hint: none");
    const e = await capture((d) => stylePicker({ ...brief, audience: "adults", styleHint: "noir" }, packs, d));
    expect(e.prompt).toBe("Topic: Pony Express\nAudience: adults\nStyle hint: noir");
  });

  it("hikâye mimarı bölüm dilini ve süreyi verir", async () => {
    const a = await capture((d) => storyArchitect(brief, d));
    expect(a.system).toContain("episode language (tr)");
    expect(a.prompt).toBe("Topic: Pony Express\nEpisode language: tr\nTarget duration: 120 seconds\nAudience: general");
    expect((await capture((d) => storyArchitect({ ...brief, audience: "teens" }, d))).prompt).toContain("Audience: teens");
  });

  it("senarist ve doktor kelime bütçesini dilin konuşma hızından hesaplar, dersleri ekler", async () => {
    const a = await capture((d) => screenwriter({ ...brief, lessons: ["Kısa yaz"] }, story, d));
    expect(a.system).toContain("Total narration ≈ 230 words (115 wpm");
    expect(a.system).toContain("Lessons from previous episodes (follow them):\n- Kısa yaz");
    expect(a.prompt).toBe(`Story:\n${JSON.stringify(story, null, 2)}`);
    const b = await capture((d) => scriptDoctor({ ...brief, lang: "en", wordsPerMinute: 100 }, story, script, d));
    expect(b.system).toContain("keep total narration ≈ 200 words");
    expect(b.system).toContain("Speakability in en");
    expect(b.system).not.toContain("Lessons from previous episodes");
    expect(b.prompt).toContain(`Draft script:\n${JSON.stringify(script, null, 2)}`);
  });

  it("oyuncu seçimi kütüphane boşsa yeniden kullanım talimatı vermez", async () => {
    const a = await capture((d) => castingDirector(script, style, d));
    expect(a.system).not.toContain("Character library");
    expect(a.prompt).toBe(
      "## s1 (location: station)\nVisual intent: rider arrives\nNarration: Bir gün  atlı geldi\n\n## s2 (location: desert)\nVisual intent: end\nNarration: Son",
    );
    const b = await capture((d) => castingDirector(script, style, d, [{ id: "lib-1", name: "Host", description: "red scarf" }]));
    expect(b.system).toContain("Character library");
    expect(b.system).toContain("- lib-1: Host — red scarf");
  });
});

describe("yönetmen", () => {
  it("sahne süresini ve kelime indekslerini verir; kadro yoksa kadro bloğu yok, varsayılan hareket kipi karışık", async () => {
    const a = await capture((d) => director(script, style, { s1: 12.34 }, { aiClipRatio: 0.25 }, d));
    expect(a.prompt).toContain("## s1 (12.3 s, location: station, emotion: tense)\nVisual intent: rider arrives\nNarration: [0]Bir [1]gün [2]atlı [3]geldi");
    expect(a.prompt).toContain("## s2 (0.0 s, location: desert");
    expect(a.prompt.startsWith("## s1")).toBe(true);
    expect(a.system).toContain('About 25% of shots should be "ai_clip"');
  });

  it("kadroyu listeler ve hareket kipine göre kural yazar", async () => {
    const a = await capture((d) => director(script, style, {}, { aiClipRatio: 0, motionMode: "animated", cast }, d));
    expect(a.prompt.startsWith("Cast (reference images exist for these; use their ids):\n- c1 Billy: rider\n- l1 Station\n\n")).toBe(true);
    expect(a.system).toContain('Every shot is "ai_clip"');
    const s = await capture((d) => director(script, style, {}, { aiClipRatio: 0, motionMode: "still" }, d));
    expect(s.system).toContain("Ken Burns on a still). Shots last 3–8 seconds.");
    const v = await capture((d) => director(script, style, {}, { aiClipRatio: 0, motionMode: "vector" }, d));
    expect(v.system).toContain('Every shot is "still_motion". Shots last 4–9 seconds.');
  });
});

describe("görsel denetçiler", () => {
  it("kare denetçisi kareyi ve kadro referanslarını sırayla gönderir", async () => {
    const a = await capture((d) =>
      frameInspector({ frame: img(1), refs: [{ image: img(2), label: "Billy" }], description: "d", imagePrompt: "ip", characters: ["Billy"] }, d),
    );
    expect(a.images).toEqual(["AQ==", "Ag=="]);
    expect(a.prompt).toBe("Shot description: d\nImage prompt used: ip\nExpected characters: Billy\nImage 2: reference for Billy");
    const b = await capture((d) => frameInspector({ frame: img(1), refs: [], description: "d", imagePrompt: "ip", characters: [] }, d));
    expect(b.prompt).toContain("Expected characters: none specified");
  });

  it("sahne eleştirmeni bilinen dersleri atlatır; ders yoksa '(none yet)'", async () => {
    const shots = [{ shotId: "sh1", image: img(3), intent: "atlı" }, { shotId: "sh2", image: img(4), intent: "çöl" }];
    const a = await capture((d) => sceneCritic(shots, [], d));
    expect(a.system).toContain("- (none yet)");
    expect(a.images).toEqual(["Aw==", "BA=="]);
    expect(a.prompt).toBe("Image 1 = sh1: atlı\nImage 2 = sh2: çöl");
    const b = await capture((d) => sceneCritic(shots, ["Yazıyı üste koy"], d));
    expect(b.system).toContain("- Yazıyı üste koy");
    expect(b.system).not.toContain("(none yet)");
  });

  it("ders küratörü kuralları indeksli listeler", async () => {
    const a = await capture((d) => lessonCurator("designer", ["a", "b"], d));
    expect(a.system).toContain("rulebook of the designer agent");
    expect(a.prompt).toBe("0: a\n1: b");
  });

  it("kapı nesne türünü anlatır, referanslar çizimden önce gelir", async () => {
    const guess = { guess: "a horse", confidence: 8 };
    const a = await capture((d) => assetGate({ kind: "prop", name: "horse", description: "brown", guess, drawing: img(9), references: [img(5), img(6)] }, d));
    expect(a.system).toContain("The asset is an object, animal or vehicle");
    expect(a.system).toContain("The first 2 image(s) are real reference photos/paintings");
    expect(a.images).toEqual(["BQ==", "Bg==", "CQ=="]);
    expect(a.prompt).toContain('said: "a horse" (confidence 8/10)');
  });

  it("kör tahmin yalnız çizimi görür; kapı karakter ve arka plan için türüne göre denetler", async () => {
    const g = await capture((d) => assetGuess(img(1), d));
    expect(g.images).toEqual(["AQ=="]);
    expect(g.prompt).toBe("What does this drawing show?");
    const guess = { guess: "a man", confidence: 9 };
    const c = await capture((d) => assetGate({ kind: "character", name: "Billy", description: "rider", guess, drawing: img(2) }, d));
    expect(c.system).toContain("The asset is a person (puppet character)");
    expect(c.system).toContain("The image is the drawing.");
    expect(c.images).toEqual(["Ag=="]);
    const b = await capture((d) => assetGate({ kind: "background", name: "Station", description: "wooden", guess, drawing: img(2) }, d));
    expect(b.system).toContain("The asset is an intentionally EMPTY room shell");
  });

  it("prop fiziği ajanı adı ve tarifi gönderir", async () => {
    const a = await capture((d) => propPhysics("desk", "oak desk", d));
    expect(a.prompt).toContain("desk");
    expect(a.prompt).toContain("oak desk");
  });
});

describe("vektör ajanları", () => {
  const plan = AssetPlan.parse({
    subject: "a saddle",
    moved: [],
    pose: "side view",
    silhouette: "wide and low",
    parts: [],
    cues: ["stirrups", "horn"],
    avoid: [],
  });

  it("planlayıcı referans varsa görselleri ekler ve türün adını yazar", async () => {
    const a = await capture((d) => assetPlanner({ kind: "background", name: "Station", description: "wooden", references: [img(7)] }, style, d));
    expect(a.system).toContain("The 1 attached image(s) are real references");
    expect(a.prompt).toBe("Location: Station\nwooden");
    expect(a.images).toEqual(["Bw=="]);
    const b = await capture((d) => assetPlanner({ kind: "prop", name: "Saddle", description: "leather" }, style, d));
    expect(b.prompt).toBe("Object: Saddle\nleather");
    expect(b.system).not.toContain("attached image");
  });

  it("karakter planı ve ilk karakter çizimi: ilk çizim yaratıcı modelle", async () => {
    const a = await capture((d) => assetPlanner({ kind: "character", name: "Billy", description: "rider" }, style, d));
    expect(a.prompt).toBe("Character: Billy\nrider");
    const b = await capture((d) => vectorDesigner({ kind: "character", name: "Billy", description: "rider" }, style, d));
    expect(b.model).toBe(models().creative);
    expect(b.system).toContain('<g id="head">');
    expect(b.options.effort).toBe("medium");
  });

  it("yan görünüş: yan iskelet tuvali, ön çizimin SVG'si ve görüntüsü; gerçek özne metni yok", async () => {
    const a = await capture((d) =>
      vectorDesigner({ kind: "character", name: "Billy", description: "rider", view: "side", front: "<svg>ön</svg>", references: [img(5)] }, style, d),
    );
    expect(a.system).toContain("strict SIDE VIEW (profile) FACING RIGHT");
    expect(a.system).toContain('- <g id="head">: rotates around (205, 250)');
    expect(a.system).not.toContain("front view, feet at y≈750");
    expect(a.prompt).toContain("approved FRONT view");
    expect(a.prompt).toContain("<front_svg>\n<svg>ön</svg>\n</front_svg>");
    expect(a.prompt).not.toContain("REAL subject");
    expect(a.images).toEqual(["BQ=="]);
    expect(a.model).toBe(models().creative);
  });

  it("plan metni siluet ve ipuçlarını içerir, boş listeleri atlar", () => {
    expect(planBlock(plan)).toBe(
      "Drawing plan (prepared from the references; where it differs from the description, the plan wins):\nSubject: a saddle\nPose/view: side view\nSilhouette: wide and low\nMust be clearly visible: stirrups; horn",
    );
  });

  it("tasarımcı: nesne tuvali, seçilen çizgi stili, stil notu, plan, çeşitleme ve referans talimatı", async () => {
    const a = await capture((d) =>
      vectorDesigner(
        { kind: "prop", name: "Saddle", description: "leather", lineStyle: "ink", variation: 2, plan, references: [img(8)] },
        { ...style, designNotes: "grain texture" },
        d,
      ),
    );
    expect(a.system).toContain(LINE_STYLE_RULES.ink);
    expect(a.system).toContain("Canvas: a viewBox sized to the object");
    expect(a.system).toContain("Style rules: grain texture");
    expect(a.system).toContain("draw ONLY the subject");
    expect(a.prompt).toContain("Object: Saddle\nleather\n\nDrawing plan");
    expect(a.prompt).toContain("This is variation #2");
    expect(a.prompt).toContain("The 1 attached image(s) show the REAL subject");
    expect(a.prompt).not.toContain("quality reviewer rejected");
    expect(a.images).toEqual(["CA=="]);
    expect(a.model).toBe(models().fast);
  });

  it("tasarımcı: arka plan kabuğu ayrık değildir, varsayılan çizgi stili outline, düzeltme ayrı ajan anahtarıyla", async () => {
    const a = await capture((d) => vectorDesigner({ kind: "background", name: "Station", description: "wooden" }, style, d));
    expect(a.system).toContain(LINE_STYLE_RULES.outline);
    expect(a.system).not.toContain("Style rules:");
    expect(a.system).not.toContain("draw ONLY the subject");
    expect(a.prompt).toBe("Location: Station\nwooden");
    expect(a.images).toEqual([]);
    const fix = await capture((d) => vectorDesigner({ kind: "character", name: "Billy", description: "young", fix: "kol eksik" }, style, d));
    expect(fix.prompt).toContain("Fix these problems:\nkol eksik");
    expect(fix.model).toBe(models().fast);
  });

  it("vektör yönetmeni varlıkları türüyle listeler; dikey video ve inceleme notu isteğe bağlı", async () => {
    const input = {
      scene: script.scenes[0]!,
      durationSec: 9.87,
      cast,
      props: { "p-desk": "oak desk", "b-desert": "open desert" },
      lang: "tr",
    };
    const a = await capture((d) => vectorDirector(input, style, d));
    expect(a.prompt).toBe(
      "Assets:\n- c1 (character, rigged): Billy, rider\n- l1 (background room shell): Station\n- p-desk (prop): oak desk\n- b-desert (background room shell): open desert\n\n" +
        "## s1 (9.9 s, location: station, emotion: tense)\nVisual intent: rider arrives\nNarration: [0]Bir [1]gün [2]atlı [3]geldi",
    );
    expect(a.system).not.toContain("VERTICAL VIDEO");
    expect(a.system).not.toContain("A reviewer looked");
    expect(a.system).toContain('in language "tr"');
    const b = await capture((d) => vectorDirector({ ...input, vertical: true, feedback: "yazılar üst üste" }, style, d));
    expect(b.system).toContain("VERTICAL VIDEO (9:16)");
    expect(b.prompt).toContain("Fix these problems in your new plan:\nyazılar üst üste");
    // Sistem talimatı düzeltme notundan bağımsız (önek önbelleği).
    expect(b.system).not.toContain("yazılar üst üste");
  });
});
