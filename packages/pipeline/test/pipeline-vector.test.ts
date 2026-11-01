import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetRejectedError, type EpisodeState, type PlannedShotState } from "../src/index.ts";
import { callsOf, geo, onAgent, refs, render, resetFakes } from "./pipeline-fakes.ts";
import { CAST, CHARACTER_SVG, harness, makeState, PROP_SVG, ROOM_SVG, SCRIPT, STYLE, voiceOf, vshot, type Harness } from "./pipeline-harness.ts";

vi.mock("@ys/agents", async (orig) => (await import("./pipeline-fakes.ts")).mockAgents(await orig()));
vi.mock("@ys/video/render", async () => {
  const f = await import("./pipeline-fakes.ts");
  return { renderEpisode: (o: any) => f.render.episode(o), renderStills: (o: any) => f.render.stills(o) };
});
vi.mock("../src/reference.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return {
    ...(await orig<object>()),
    findReferences: (...a: any[]) => f.refs.find(...a),
    findVectorSources: (...a: any[]) => f.refs.vectors(...a),
    rasterizeSvg: (...a: any[]) => f.refs.rasterize(...a),
  };
});
vi.mock("../src/geo.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return { ...(await orig<object>()), generateMap: (...a: any[]) => f.geo.map(...a), generateFlag: (...a: any[]) => f.geo.flag(...a) };
});

/**
 * Vektör modunun aşamaları: konsept (kütüphaneden tekrar kullanım, devam, yeni tur, ret), çekim planı (bilinmeyen
 * katmanların atılması, indeks yeniden eşleme), nesne çizimi (harita/bayrak gerçek veriden), taslak denetimi ve yeniden
 * planlama, önizleme kareleri ve timeline varlıkları. Ajanlar, Remotion ve coğrafya üreticisi sahtedir.
 */

const MAP = { projection: "flat" as const, focus: ["USA"], highlight: [], markers: [], routes: [] };

function agents(o: { score?: (name: string) => number } = {}) {
  onAgent("assetPlanner", (b: { name: string }) => ({ subject: b.name, moved: [], cues: [] }));
  onAgent("vectorDesigner", (b: { kind: string }) =>
    b.kind === "character"
      ? { svg: CHARACTER_SVG, realHeight: 1.7, grounded: true }
      : b.kind === "background"
        ? { svg: ROOM_SVG, realHeight: 3, grounded: true, floorY: 700 }
        : { svg: PROP_SVG, realHeight: 0.4, grounded: true },
  );
  onAgent("assetGuess", () => ({ guess: "something", confidence: 7 }));
  onAgent("assetGate", (g: { name: string }) => ({ recognizable: o.score?.(g.name) ?? 9, fidelity: null, defects: [] }));
}

const LIB_A = `library/vector/character/${"a".repeat(32)}.svg`;
const LIB_B = `library/vector/character/${"b".repeat(32)}.svg`;
function putLibraryCharacter(h: Harness, key: string, name: string, episodes: string[] = []) {
  h.store.putText(key, CHARACTER_SVG);
  h.store.putJsonSync(`${key}.json`, {
    realHeight: 1.7,
    check: { kind: "character", name, recognizable: 9, passed: true },
    identity: { name, description: `${name} desc`, artStyle: STYLE.artStyle, lineStyle: "outline", episodes },
  });
}

const CAST2 = {
  characters: [
    { id: "c1", name: "Host", kind: "person", role: "host", visualDescription: "channel host", scenes: ["s1"], reuse: "a".repeat(32) },
    { id: "c2", name: "Rider", kind: "person", role: "rider", visualDescription: "young rider", scenes: ["s1"] },
  ],
  locations: [{ id: "l1", name: "Station", visualDescription: "relay station", scenes: ["s1"] }],
} as EpisodeState["cast"];

const afterCast = (input: object = {}, extra: Partial<EpisodeState> = {}) =>
  makeState(
    { motionMode: "vector", lineStyle: "outline", ...input },
    { style: STYLE, script: SCRIPT, cast: CAST2, done: { style: "x", story: "x", script: "x", cast: "x" }, approvals: { script: "x" }, ...extra },
  );

beforeEach(() => {
  resetFakes();
  refs.find.mockResolvedValue({ images: [], sources: [], keys: [] });
  refs.vectors.mockResolvedValue([]);
  refs.rasterize.mockResolvedValue({ data: new Uint8Array([1]), mimeType: "image/png" });
  geo.map.mockResolvedValue({ svg: '<svg viewBox="0 0 1920 1080"><rect width="10" height="10"/></svg>', width: 1920, height: 1080, meta: { exact: true } });
  geo.flag.mockResolvedValue({ svg: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#e30a17"/></svg>', width: 30, height: 20, meta: { exact: true } });
});

describe("vektör konsept", () => {
  it("kütüphane karakteri çizilmeden seçilir, diğerleri çizilir; seçilen karakter bölümle anılır", async () => {
    const h = harness();
    agents();
    putLibraryCharacter(h, LIB_A, "Host");
    const id = await h.seed(afterCast());
    const state = await h.pipeline.run(id, { until: "concept" });
    expect(state.concept!.round).toBe(0);
    expect(state.concept!.selected.c1).toEqual({ key: LIB_A, mimeType: "image/svg+xml" });
    expect(state.concept!.selected.c2!.key).toMatch(/^library\/vector\/character\//);
    expect(state.concept!.selected.l1!.key).toMatch(/^library\/vector\/background\//);
    expect(state.assetChecks![LIB_A]).toMatchObject({ passed: true, entityId: "c1" });
    expect(h.logs).toContain("  ♻ Host: kütüphaneden (0 bölümde kullanıldı), çizilmedi");
    expect(h.store.json(`${LIB_A}.json`).identity.episodes).toEqual([id]);
    expect(h.store.json(`${state.concept!.selected.c2!.key}.json`).identity.episodes).toEqual([id]);
    // Tasarımcıya yalnız c2 ve l1 gitti; ilk turda çeşitleme yok.
    expect(callsOf("vectorDesigner").map((c) => (c.args[0] as { name: string; variation?: number }).name).sort()).toEqual(["Rider", "Station"]);
    expect(callsOf("vectorDesigner").every((c) => (c.args[0] as { variation?: number }).variation === undefined)).toBe(true);
  });

  it("devam: yalnız seçimi olmayan varlıklar çizilir, önceki seçimler korunur", async () => {
    const h = harness({ concurrency: 1 });
    agents();
    putLibraryCharacter(h, LIB_A, "Host");
    const station = { key: "library/vector/background/old.svg", mimeType: "image/svg+xml" };
    const id = await h.seed(
      afterCast({}, { concept: { candidates: { c1: [{ key: LIB_A, mimeType: "image/svg+xml" }], l1: [station] }, selected: { c1: { key: LIB_A, mimeType: "image/svg+xml" }, l1: station } } }),
    );
    const state = await h.pipeline.run(id, { until: "concept" });
    expect(h.logs).toContain("  devam: 1 eksik varlık çizilecek, 2 hazır");
    expect(state.concept!.candidates.c1).toHaveLength(1);
    expect(state.concept!.selected.l1).toEqual(station);
    expect(callsOf("vectorDesigner")).toHaveLength(1);
  });

  it("devam: kütüphaneden gelen çizim adaylarda zaten varsa ikinci kez eklenmez", async () => {
    const h = harness();
    agents();
    const first = await h.pipeline.run(await h.seed(afterCast({}, { cast: { characters: [CAST2!.characters[1]!], locations: [] } })), { until: "concept" });
    const rider = first.concept!.selected.c2!;
    // İnsan seçimi kaldırdı (aday duruyor): devam aynı çizimi kütüphaneden bulur.
    const id = await h.seed(afterCast({}, { cast: { characters: [CAST2!.characters[1]!], locations: [] }, concept: { candidates: { c2: [rider] }, selected: {} } }));
    const state = await h.pipeline.run(id, { until: "concept" });
    expect(state.concept!.candidates.c2).toEqual([rider]);
    expect(state.concept!.selected.c2).toEqual(rider);
    expect(callsOf("vectorDesigner")).toHaveLength(1);
  });

  it("yeni adaylar: yeni çeşitleme çizilir (kütüphane karakteri dahil), mevcut seçim değişmez", async () => {
    const h = harness();
    agents();
    putLibraryCharacter(h, LIB_A, "Host");
    const old = { key: "library/vector/character/old.svg", mimeType: "image/svg+xml" };
    const id = await h.seed(afterCast({}, { concept: { candidates: { c2: [old] }, selected: { c2: old } } }));
    const state = await h.pipeline.run(id, { only: "concept" });
    expect(state.concept!.round).toBe(1);
    expect(callsOf("vectorDesigner")).toHaveLength(3);
    expect(callsOf("vectorDesigner").every((c) => (c.args[0] as { variation?: number }).variation === 1)).toBe(true);
    expect(state.concept!.candidates.c2).toHaveLength(2);
    expect(state.concept!.selected.c2).toEqual(old);
    // Kütüphane karakteri de yeni aday aldı; önceki turda seçimi olmadığı için en yeni çeşitleme seçilir.
    expect(state.concept!.candidates.c1!.map((r) => r.key)[0]).toBe(LIB_A);
    expect(state.concept!.candidates.c1).toHaveLength(2);
    expect(state.concept!.selected.c1).toEqual(state.concept!.candidates.c1![1]);
  });

  it("reddedilen varlık: Stüdyo bölümü bekler, otomatik onaylı bölüm durur", async () => {
    const h = harness();
    agents({ score: (name) => (name === "Rider" ? 2 : 9) });
    const id = await h.seed(afterCast());
    const state = await h.pipeline.run(id, { until: "concept" });
    expect(state.concept!.selected.c2).toBeUndefined();
    expect(state.done.concept).toBeDefined();
    expect(h.logs).toContain("  ⏸ kalite kapısı: Rider reddedildi; Stüdyo'da kabul et ya da notla yeniden çizdir");

    const auto = await h.seed(afterCast({ autoApprove: true }));
    await expect(h.pipeline.run(auto, { until: "concept" })).rejects.toThrow(AssetRejectedError);
    expect((await h.load(auto)).lastError!.message).toMatch(/^Kalite kapısı: Rider kabul edilebilir çizilemedi/);
  });

  it("ret dışı hata konsepti durdurur (devam edince yeniden denensin)", async () => {
    const h = harness();
    agents();
    onAgent("assetGuess", () => {
      throw new Error("ajan çöktü");
    });
    const id = await h.seed(afterCast());
    await expect(h.pipeline.run(id, { until: "concept" })).rejects.toThrow("ajan çöktü");
  });

  it("stilsiz ve boş kadroda kütüphaneye bakılmaz", async () => {
    const h = harness();
    const id = await h.seed(makeState({ motionMode: "vector" }, { cast: { characters: [], locations: [] } }));
    const state = await h.pipeline.run(id, { only: "concept" });
    expect(state.concept).toMatchObject({ candidates: {}, selected: {}, round: 0 });
  });

  it("kadro: aynı serinin kütüphane karakterleri önce önerilir", async () => {
    const h = harness();
    const sibling = makeState({ series: "Posta" });
    await h.seed(sibling);
    // B daha çok bölümde kullanılmış (normalde önce), A ise serinin bölümünde.
    putLibraryCharacter(h, LIB_A, "Host", [sibling.id]);
    putLibraryCharacter(h, LIB_B, "Guest", ["x", "y"]);
    let seen: string[] = [];
    onAgent("castingDirector", (_s: unknown, _st: unknown, _d: unknown, library: { id: string }[]) => {
      seen = library.map((l) => l.id);
      return CAST;
    });
    const id = await h.seed(afterCast({ series: "posta" }, { cast: undefined }));
    await h.pipeline.run(id, { only: "cast" });
    expect(seen).toEqual(["a".repeat(32), "b".repeat(32)]);
  });
});

describe("vektör çekim planı", () => {
  const voiced = (input: object = {}, extra: Partial<EpisodeState> = {}) =>
    afterCast(input, { cast: CAST, voice: { s1: voiceOf("s1"), s2: voiceOf("s2") }, ...extra });

  it("kadro yoksa hata", async () => {
    const h = harness();
    const id = await h.seed(voiced({}, { cast: undefined }));
    await expect(h.pipeline.run(id, { only: "shots" })).rejects.toThrow("script/style/cast/voice yok");
  });

  it("bir sahne düşerse planlanmış sahneler kaydedilir; devamda girdisi değişmeyen sahne yeniden planlanmaz", async () => {
    const h = harness({ concurrency: 1 });
    let failS2 = true;
    onAgent("vectorDirector", (input: { scene: { id: string } }) => {
      if (input.scene.id === "s2" && failS2) throw new Error("yönetmen düştü");
      return { shots: [{ startWord: 0, description: input.scene.id, ambience: "none", spec: vshot({ layers: [{ asset: "c1", x: 500, depth: 0.5 }] }) }], newProps: [], newBackgrounds: [] };
    });
    const id = await h.seed(voiced());
    await expect(h.pipeline.run(id, { only: "shots" })).rejects.toThrow("yönetmen düştü");
    expect(Object.keys((await h.load(id)).shotPlanDraft!)).toEqual(["s1"]);

    failS2 = false;
    const state = await h.pipeline.run(id, { only: "shots" });
    expect(callsOf("vectorDirector").map((c) => (c.args[0] as { scene: { id: string } }).scene.id)).toEqual(["s1", "s2", "s2"]);
    expect(h.logs).toContain("  s1: önceki çalıştırmanın planı kullanıldı");
    expect(state.shotPlan!.scenes.map((s) => s.shots[0]!.description)).toEqual(["s1", "s2"]);
    expect(state.shotPlanDraft).toBeUndefined();
  });

  it("sahnesiz senaryoda plan boş kalır", async () => {
    const h = harness();
    const id = await h.seed(voiced({}, { script: { scenes: [] } as never }));
    const state = await h.pipeline.run(id, { only: "shots" });
    expect(state.shots).toEqual([]);
    expect(h.logs).toContain("  0 vektör çekim, 0 nesne/mekân");
  });

  it("bilinmeyen katmanlar atılır, indeksler yeniden eşlenir, yeni nesne ve mekânlar kaydedilir", async () => {
    const h = harness({ concurrency: 1 });
    h.store.putJsonSync("library/lessons.json", { lessons: [{ target: "director", rule: "Keep it simple", count: 1, firstSeen: "x", lastSeen: "x", episodes: [] }] });
    onAgent("vectorDirector", (input: { scene: { id: string }; vertical: boolean; props: Record<string, string>; lessons: string[]; feedback?: string }) => {
      expect(input.vertical).toBe(true);
      expect(input.lessons).toEqual(["Keep it simple"]);
      expect(input.feedback).toBeUndefined();
      if (input.scene.id === "s1") {
        expect(input.props).toEqual({ "p-old": "old chest" });
        return {
          shots: [
            {
              startWord: 0,
              description: "rider with bag",
              ambience: "dust",
              spec: vshot({
                background: "b-map",
                layers: [
                  { asset: "c1", x: 500, depth: 0.5 },
                  { asset: "zzz", x: 1 },
                  { asset: "p-bag", x: 600, on: 0, heldBy: 1 },
                  { asset: "l1", x: 3 },
                ],
              }),
            },
            { startWord: 2, description: "old chest", ambience: "none", spec: vshot({ background: "l1", layers: [{ asset: "p-old", x: 5, depth: 0.3 }] }) },
          ],
          newProps: [
            { id: "p-bag", description: "mail bag", reference: "Pony Express mochila" },
            { id: "p-old", description: "should not overwrite" },
          ],
          newBackgrounds: [{ id: "b-map", description: "route map", map: MAP }],
        };
      }
      return {
        shots: [
          { startWord: 0, description: "bag on its own", ambience: "none", spec: vshot({ background: "p-bag", layers: [] }) },
          {
            startWord: 1,
            description: "crowd of clones",
            ambience: "none",
            spec: vshot({
              layers: [
                { asset: "c1", x: 300, anims: [{ type: "point", start: 0, end: 1, target: 2 }] },
                { asset: "c1", x: 900 },
                { asset: "p-bag", x: 1200 },
              ],
            }),
          },
        ],
        newProps: [],
        newBackgrounds: [],
      };
    });
    const id = await h.seed(voiced({ width: 1080, height: 1920 }, { vectorProps: { "p-old": { description: "old chest" } } }));
    const state = await h.pipeline.run(id, { only: "shots" });

    const [a, b, c, d] = state.shots as PlannedShotState[];
    expect(a!.vector!.layers.map((l) => [l.asset, l.on, l.heldBy])).toEqual([
      ["c1", undefined, undefined],
      ["p-bag", 0, undefined],
    ]);
    expect(a!.characterIds).toEqual(["c1"]);
    expect(a!.vector!.background).toBe("b-map");
    expect(a!.locationId).toBe("b-map");
    expect(b!).toMatchObject({ locationId: "l1", kind: "still_motion", camera: "static" });
    expect(c!.vector!.background).toBeUndefined();
    expect(c!.locationId).toBeUndefined();
    expect(d!.vector!.background).toBeUndefined();
    // Aynı karakterin kopyası atılır, point hedefi kalan katmana yeniden eşlenir.
    expect(d!.vector!.layers.map((l) => [l.asset, l.anims[0]?.target])).toEqual([
      ["c1", 1],
      ["p-bag", undefined],
    ]);
    expect(d!.characterIds).toEqual(["c1"]);
    expect(state.vectorProps!["p-old"]).toEqual({ description: "old chest" });
    expect(state.vectorProps!["p-bag"]).toMatchObject({ kind: "prop", reference: "Pony Express mochila" });
    expect(state.vectorProps!["b-map"]).toMatchObject({ kind: "background", map: MAP });
    expect(state.keyframes).toEqual({});
    expect(h.logs).toContain("  s1: 2 çekim, 2 yeni nesne, 1 yeni mekân, 2 bilinmeyen katman atıldı");
    expect(h.logs).toContain("  s2: 2 çekim, 0 yeni nesne, 0 yeni mekân, 1 kopya karakter atıldı");
    expect(h.logs).toContain("  4 vektör çekim, 3 nesne/mekân");
  });
});

/** Vektör çekimi olan, kare aşamasına hazır bölüm. */
function keyframeReady(h: Harness, input: object, extra: Partial<EpisodeState> = {}) {
  h.store.putText("lib/c1.svg", CHARACTER_SVG);
  h.store.putText("lib/l1.svg", ROOM_SVG);
  h.store.putJsonSync("lib/l1.svg.json", { floorY: 700 });
  h.store.putText("lib/done.svg", PROP_SVG);
  h.store.putText(voiceOf("s1").key, "mp3");
  h.store.putText(voiceOf("s2").key, "mp3");
  const shot = (id: string, sceneId: string, startMs: number, vector?: unknown): PlannedShotState => ({
    id,
    sceneId,
    kind: "still_motion",
    startMs,
    endMs: startMs + 1000,
    description: `desc ${id}`,
    imagePrompt: "",
    motionPrompt: "",
    camera: "static",
    ...(vector ? { vector: vshot(vector) } : {}),
  });
  return h.seed(
    afterCast(input, {
      cast: CAST,
      voice: { s1: voiceOf("s1"), s2: voiceOf("s2") },
      concept: { candidates: {}, selected: { c1: { key: "lib/c1.svg", mimeType: "image/svg+xml" }, l1: { key: "lib/l1.svg", mimeType: "image/svg+xml" } } },
      shots: [
        shot("s1-sh1", "s1", 0, { background: "b-map", layers: [{ asset: "p-flag", x: 300, depth: 0.4 }, { asset: "p-cup", x: 600, depth: 0.4 }, { asset: "p-done", x: 900, depth: 0.4 }] }),
        shot("s1-sh2", "s1", 1000, { background: "b-room", layers: [{ asset: "c1", x: 900, depth: 0.5 }] }),
        shot("s2-sh1", "s2", 2400),
      ],
      vectorProps: {
        "p-flag": { description: "Turkish flag", flag: { code: "tr", pole: true } },
        "b-map": { description: "route", kind: "background", map: MAP },
        "p-cup": { description: "a tea cup" },
        "b-room": { description: "empty office", kind: "background" },
        "p-unused": { description: "never used" },
        "p-done": { description: "done", key: "lib/done.svg" },
      },
      ...extra,
    }),
  );
}

describe("vektör nesneleri ve önizleme (kare denetimi kapalı)", () => {
  it("harita ve bayrak gerçek veriden, diğerleri tasarımcıdan; kullanılmayan çizilmez; önizleme kareleri saklanır", async () => {
    const h = harness();
    agents();
    const id = await keyframeReady(h, { qa: false });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    const props = state.vectorProps!;
    expect(props["p-flag"]!.key).toMatch(/^library\/vector\/geo\/[0-9a-f]{32}\.svg$/);
    expect(props["b-map"]!.key).toMatch(/^library\/vector\/geo\//);
    expect(props["p-cup"]!.key).toMatch(/^library\/vector\/prop\//);
    expect(props["b-room"]!.key).toMatch(/^library\/vector\/background\//);
    expect(props["p-unused"]!.key).toBeUndefined();
    expect(geo.map).toHaveBeenCalledWith(MAP, "tr", STYLE.palette);
    expect(geo.flag).toHaveBeenCalledWith({ code: "tr", pole: true });
    expect(h.store.json(`${props["b-map"]!.key}.json`)).toEqual({ exact: true });
    expect(h.logs.some((l) => /^  b-map: harita gerçek veriden üretildi \(\d+ KB\)$/.test(l))).toBe(true);
    expect(h.logs.some((l) => l.startsWith("  p-flag: bayrak gerçek veriden üretildi"))).toBe(true);
    // Vektör çekimlerin önizleme kareleri (görsel modelsiz çekimin karesi yok).
    expect(Object.keys(state.stills!).sort()).toEqual(["s1-sh1", "s1-sh2"]);
    expect(h.logs).toContain("  önizleme: 3 çekim karesi");
    expect(state.keyframes).toEqual({});

    // Aynı harita başka bölümde yeniden üretilmez.
    const again = await keyframeReady(h, { qa: false });
    geo.map.mockClear();
    await h.pipeline.run(again, { only: "keyframes" });
    expect(geo.map).not.toHaveBeenCalled();
    expect(h.logs).toContain("  b-map: kütüphaneden (gerçek veri)");
  });

  it("kesin sonuçlu hatalar nesneyi düşürür, diğer hatalar aşamayı durdurur", async () => {
    const h = harness();
    agents({ score: (name) => (name === "p-cup" ? 2 : 9) });
    geo.map.mockRejectedValue(new Error("ülke verisi yok"));
    geo.flag.mockRejectedValue("bilinmeyen bayrak");
    const id = await keyframeReady(h, { qa: false });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(state.vectorProps!["p-cup"]!.key).toBeUndefined();
    const line = h.logs.find((l) => l.includes("nesne çizilemedi"))!;
    expect(line).toMatch(/^  3 nesne çizilemedi, sahnelerden çıkarılacak:/);
    expect(line).toContain("b-map: ülke verisi yok");
    expect(line).toContain("p-flag: bilinmeyen bayrak");
    expect(line).toContain("p-cup: p-cup: kalite kapısı geçilemedi");

    onAgent("assetGuess", () => {
      throw new Error("ağ hatası");
    });
    const failing = await keyframeReady(h, { qa: false }, { vectorProps: { "p-cup": { description: "another cup" } } });
    await expect(h.pipeline.run(failing, { only: "keyframes" })).rejects.toThrow("ağ hatası");
  });

  it("çizim sürerken varlıkları hazır olan çekimin karesi hemen çıkarılır; ilk hatadan sonra denenmez", async () => {
    const h = harness({ concurrency: 1 });
    agents();
    const id = await keyframeReady(h, { qa: false });
    render.stills.mockClear();
    await h.pipeline.run(id, { only: "keyframes" });
    // Sıra: p-flag, b-map, p-cup (s1-sh1 hazır), b-room (s1-sh2 hazır), sonra hepsinin önizlemesi.
    expect(render.stills.mock.calls.map((c) => Object.keys(c[0].frames).sort())).toEqual([["s1-sh1"], ["s1-sh2"], ["s1-sh1", "s1-sh2"]]);

    const again = await keyframeReady(h, { qa: false }, { vectorProps: { "p-cup": { description: "a tea cup" }, "b-room": { description: "empty office", kind: "background" } } });
    render.stills.mockClear();
    render.stills.mockRejectedValueOnce(new Error("chrome yok"));
    const state = await h.pipeline.run(again, { only: "keyframes" });
    expect(render.stills).toHaveBeenCalledTimes(2);
    expect(h.logs).toContain("  önizleme kareleri çıkarılamadı (chrome yok)");
    expect(Object.keys(state.stills!).sort()).toEqual(["s1-sh1", "s1-sh2"]);
  });

  it("önizleme çıkarılamazsa üretim sürer (Error, düz değer, ses yok)", async () => {
    const h = harness();
    agents();
    render.stills.mockRejectedValueOnce(new Error("chrome yok"));
    const id = await keyframeReady(h, { qa: false }, { vectorProps: {} });
    await h.pipeline.run(id, { only: "keyframes" });
    expect(h.logs).toContain("  önizleme kareleri çıkarılamadı (chrome yok)");

    render.stills.mockRejectedValueOnce("düz");
    await h.pipeline.run(id, { only: "keyframes" });
    expect(h.logs).toContain("  önizleme kareleri çıkarılamadı (düz)");

    const mute = await keyframeReady(h, { qa: false }, { vectorProps: {}, voice: undefined });
    await h.pipeline.run(mute, { only: "keyframes" });
    expect(h.logs.at(-1)).toMatch(/^  önizleme kareleri çıkarılamadı \(Timeline için/);
  });
});

describe("vektör taslak denetimi (kare denetimi açık)", () => {
  it("ses yoksa taslak denetimi yapılmaz", async () => {
    const h = harness();
    agents();
    const id = await keyframeReady(h, {}, { voice: undefined, vectorProps: undefined });
    await h.pipeline.run(id, { only: "keyframes" });
    expect(render.stills).not.toHaveBeenCalled();
  });

  it("taslak kareler çıkarılamazsa denetim atlanır (Error ilk satırı, düz değer)", async () => {
    const h = harness();
    agents();
    render.stills.mockRejectedValueOnce(new Error("tarayıcı açılamadı\nayrıntı"));
    const id = await keyframeReady(h, {}, { vectorProps: {} });
    await h.pipeline.run(id, { only: "keyframes" });
    expect(h.logs).toContain("  ⚠ taslak kareler çıkarılamadı, taslak denetimi atlandı: tarayıcı açılamadı");
    render.stills.mockRejectedValueOnce("düz");
    await h.pipeline.run(id, { only: "keyframes" });
    expect(h.logs).toContain("  ⚠ taslak kareler çıkarılamadı, taslak denetimi atlandı: düz");
  });

  it("iyi taslakta yeniden planlama yok; kareler Çekimler sekmesine yazılır", async () => {
    const h = harness();
    agents();
    h.store.putJsonSync("library/lessons.json", { lessons: [{ target: "designer", rule: "Thick outlines", count: 1, firstSeen: "x", lastSeen: "x", episodes: [] }] });
    onAgent("sceneCritic", (items: { shotId: string }[], known: string[]) => {
      expect(known).toEqual(["Thick outlines"]);
      return { shots: items.map((i) => ({ shotId: i.shotId, score: 8, issues: [] })), lessons: [] };
    });
    const id = await keyframeReady(h, {}, { vectorProps: {} });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(state.draftReview).toMatchObject({ avg: 8, revisedScenes: [] });
    expect(Object.keys(state.stills!).sort()).toEqual(["s1-sh1", "s1-sh2"]);
    expect(h.logs).toContain("  taslak: 2 kare, ortalama 8.0/10; yeniden planlanacak sahne: 0");
    expect(callsOf("vectorDirector")).toHaveLength(0);
    // Tasarımcı dersleri de verildi (kütüphane defterinden).
  });

  it("sorunlu sahne eleştiri ve kod düzeltmeleriyle yeniden planlanır; yeni nesneler çizilir, eski kareler silinir", async () => {
    const h = harness({ concurrency: 2 });
    agents();
    onAgent("sceneCritic", (items: { shotId: string }[]) => ({
      shots: items
        .filter((i) => i.shotId !== "s1-sh2")
        .map((i) => (i.shotId === "s1-sh1" ? { shotId: i.shotId, score: 4, issues: [{ type: "character_floating", detail: "floats" }] } : { shotId: i.shotId, score: 9, issues: i.shotId.startsWith("s2") ? [{ type: "repetitive", detail: "same pose" }] : [] })),
      lessons: [],
    }));
    onAgent("vectorDirector", () => ({
      shots: [{ startWord: 0, description: "fixed", ambience: "none", spec: vshot({ background: "l1", layers: [{ asset: "p-lamp", x: 500, depth: 0.4 }] }) }],
      newProps: [{ id: "p-lamp", description: "an oil lamp" }],
      newBackgrounds: [],
    }));
    const id = await keyframeReady(
      h,
      {},
      {
        vectorProps: {},
        shotPlan: {
          scenes: [
            { sceneId: "s1", shots: [] },
            { sceneId: "s2", shots: [{ startWord: 0, characterIds: [], locationId: "", kind: "still_motion", description: "d", imagePrompt: "", motionPrompt: "", camera: "static", ambience: "none", vector: vshot({ layers: [] }) }] },
          ],
        } as never,
        shots: [
          // Derinliksiz katman: kod piksel konumunu derinliğe çevirir (yönetmene "code had to fix" olarak döner).
          { id: "s1-sh1", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 700, description: "a", imagePrompt: "", motionPrompt: "", camera: "static", vector: vshot({ background: "l1", layers: [{ asset: "c1", x: 500 }] }) },
          { id: "s1-sh2", sceneId: "s1", kind: "still_motion", startMs: 700, endMs: 1400, description: "b", imagePrompt: "", motionPrompt: "", camera: "static", vector: vshot({ layers: [{ asset: "c1", x: 900 }] }) },
          { id: "s1-sh3", sceneId: "s1", kind: "still_motion", startMs: 1400, endMs: 2000, description: "c", imagePrompt: "", motionPrompt: "", camera: "static", vector: vshot({ layers: [{ asset: "c1", x: 900, depth: 0.5 }] }) },
          { id: "s2-sh1", sceneId: "s2", kind: "still_motion", startMs: 2400, endMs: 3000, description: "d", imagePrompt: "", motionPrompt: "", camera: "static", vector: vshot({ layers: [] }) },
          { id: "s2-x", sceneId: "s2", kind: "still_motion", startMs: 3000, endMs: 3400, description: "e", imagePrompt: "", motionPrompt: "", camera: "static" },
        ],
        // Görsel modelden kalma klip: timeline'da vektörsüz görsel (yerleşim düzeltmesi yok).
        clips: { "s2-x": { key: "lib/clip.mp4", mimeType: "video/mp4", durationSec: 5 } },
      },
    );
    const state = await h.pipeline.run(id, { only: "keyframes" });

    const feedback = (callsOf("vectorDirector")[0]!.args[0] as { feedback: string }).feedback;
    expect(feedback.split("\n")).toEqual([
      "- shot 1 (score 4): character_floating: floats; code had to fix: layer 0: piksel konumu derinliğe çevrildi",
      "- shot 2 (score ?): code had to fix: layer 0: piksel konumu derinliğe çevrildi",
    ]);
    expect(state.draftReview).toMatchObject({ revisedScenes: ["s1"] });
    expect(state.draftReview!.avg).toBeCloseTo(7.75, 2);
    expect(h.logs).toContain("  s1 (düzeltme): 1 çekim, 1 yeni nesne, 0 yeni mekân");
    // Yeni plan: s1 tek çekim; s2 planı olduğu gibi (klip çekimi planda yok, düşer).
    expect(state.shots!.map((s) => s.id)).toEqual(["s1-sh1", "s2-sh1"]);
    expect(state.shotPlan!.scenes[0]!.shots).toHaveLength(1);
    expect(state.vectorProps!["p-lamp"]!.key).toMatch(/^library\/vector\/prop\//);
    // Yeniden planlanan çekimin karesi yeniden çıkarıldı, ölü çekimlerin kareleri silindi, değişmeyen sahne korundu.
    expect(Object.keys(state.stills!).sort()).toEqual(["s1-sh1", "s2-sh1"]);
    expect(render.stills.mock.calls.at(-1)![0].frames).toEqual({ "s1-sh1": expect.any(Number) });
    expect(h.logs).toContain("  önizleme: 1 çekim karesi");
  });

  it("yalnız en kötü sahneler yeniden planlanır: en kötüden başlanır, sahnelerin en çok çeyreği", async () => {
    const h = harness();
    agents();
    onAgent("sceneCritic", (items: { shotId: string }[]) => ({
      // s1-sh2 için kare dönmez: puanı bilinmeyen kare sıralamada en iyi sayılır.
      shots: items.filter((i) => i.shotId !== "s1-sh2").map((i) => ({ shotId: i.shotId, score: i.shotId.startsWith("s1") ? 4 : 2, issues: [] })),
      lessons: [],
    }));
    onAgent("vectorDirector", () => ({ shots: [{ startWord: 0, description: "x", ambience: "none", spec: vshot({ layers: [] }) }], newProps: [], newBackgrounds: [] }));
    const shot = (id: string, sceneId: string, startMs: number) => ({ id, sceneId, kind: "still_motion", startMs, endMs: startMs + 500, description: "a", imagePrompt: "", motionPrompt: "", camera: "static", vector: vshot({ layers: [] }) });
    const id = await keyframeReady(h, {}, {
      vectorProps: {},
      shotPlan: { scenes: [{ sceneId: "s1", shots: [] }, { sceneId: "s2", shots: [] }] } as never,
      shots: [shot("s1-sh1", "s1", 0), shot("s1-sh2", "s1", 700), shot("s2-sh1", "s2", 2400)] as never,
    });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    // İki sahne de kötü ama 2 sahnenin çeyreği 1: yalnız en kötüsü (s2) yeniden planlanır.
    expect(state.draftReview!.revisedScenes).toEqual(["s2"]);
    expect(callsOf("vectorDirector")).toHaveLength(1);
  });

  it("planda sahnesi olmayan yeniden plan yok sayılır", async () => {
    const h = harness();
    agents();
    onAgent("sceneCritic", (items: { shotId: string }[]) => ({ shots: items.map((i) => ({ shotId: i.shotId, score: 2, issues: [] })), lessons: [] }));
    onAgent("vectorDirector", () => ({ shots: [{ startWord: 0, description: "x", ambience: "none", spec: vshot({ layers: [] }) }], newProps: [], newBackgrounds: [] }));
    const id = await keyframeReady(h, {}, { vectorProps: {}, shotPlan: { scenes: [] }, voice: { s1: voiceOf("s1") } });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(callsOf("vectorDirector")).toHaveLength(1);
    expect(state.shotPlan).toEqual({ scenes: [] });
    expect(state.shots).toEqual([]);
  });

  it("eleştirmen kare döndürmezse ortalama 0", async () => {
    const h = harness();
    agents();
    onAgent("sceneCritic", () => ({ shots: [], lessons: [] }));
    const id = await keyframeReady(h, {}, { vectorProps: {} });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(state.draftReview).toMatchObject({ avg: 0, revisedScenes: [] });
  });
});

describe("vektör timeline", () => {
  it("seçili karakter/mekân ve çizilmiş nesneler gömülür; gerçek veri ve arka plan zemini korunur", async () => {
    const h = harness();
    const backdropChar = CHARACTER_SVG.replace(">", '><rect x="0" y="0" width="400" height="800" fill="#fff"/>');
    h.store.putText("lib/c1.svg", backdropChar);
    h.store.putJsonSync("lib/c1.svg.json", { realHeight: 1.7 });
    h.store.putText("lib/l1.svg", ROOM_SVG);
    h.store.putText("lib/map.svg", '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#00f"/></svg>');
    h.store.putJsonSync("lib/map.svg.json", { exact: true });
    h.store.putText("lib/cup.svg", PROP_SVG);
    h.store.putText("lib/bg.svg", ROOM_SVG);
    const id = await h.seed(
      makeState(
        { motionMode: "vector" },
        {
          style: STYLE,
          script: SCRIPT,
          voice: { s1: voiceOf("s1") },
          shots: [],
          keyframes: {},
          cast: {
            characters: [CAST.characters[0]!, { id: "c2", name: "Nobody", kind: "person", role: "x", visualDescription: "x", scenes: [] }],
            locations: [CAST.locations[0]!, { id: "l2", name: "Nowhere", visualDescription: "x", scenes: [] }],
          } as never,
          concept: { candidates: {}, selected: { c1: { key: "lib/c1.svg", mimeType: "image/svg+xml" }, l1: { key: "lib/l1.svg", mimeType: "image/svg+xml" } } },
          vectorProps: {
            "b-map": { description: "map", kind: "background", key: "lib/map.svg" },
            "p-map": { description: "inset map", key: "lib/map.svg" },
            "p-cup": { description: "cup", key: "lib/cup.svg" },
            "b-bg": { description: "bg", kind: "background", key: "lib/bg.svg" },
            "p-none": { description: "not drawn" },
          },
        },
      ),
    );
    const state = await h.pipeline.run(id, { only: "timeline" });
    const assets = state.timeline!.vectorAssets!;
    expect(Object.keys(assets).sort()).toEqual(["b-bg", "b-map", "c1", "l1", "p-cup", "p-map"]);
    expect(assets.c1!.svg).not.toContain('fill="#fff"');
    expect(assets.c1!.meta.realHeight).toBe(1.7);
    expect(assets["p-map"]).toMatchObject({ kind: "prop", width: 100, height: 100 });
    expect(assets["p-map"]!.svg).toContain('fill="#00f"');
    expect(assets["p-cup"]!.svg).not.toContain('fill="#fff"');
    expect(assets.l1!.svg).toContain('height="380"');
    expect(assets["b-bg"]!.kind).toBe("background");
  });

  it("varlığı olmayan vektör bölümünde timeline boş varlıkla kurulur", async () => {
    const h = harness();
    const id = await h.seed(makeState({ motionMode: "vector" }, { script: SCRIPT, voice: {}, shots: [], keyframes: {} }));
    const state = await h.pipeline.run(id, { only: "timeline" });
    expect(state.timeline!.vectorAssets).toEqual({});
  });
});
