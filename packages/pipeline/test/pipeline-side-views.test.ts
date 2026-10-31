import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptAsset, rejectAsset, type EpisodeState } from "../src/index.ts";
import { callsOf, onAgent, refs, resetFakes } from "./pipeline-fakes.ts";
import { CAST, CHARACTER_SVG, harness, makeState, ROOM_SVG, SCRIPT, STYLE, voiceOf, vshot, type Harness } from "./pipeline-harness.ts";

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

/**
 * Yan görünüş (input.sideViews): çekimlerde yer değiştiren karakterlere sağa bakan ikinci çizim. Ön çizime bakılarak
 * çizilir, kapıda ön çizimle karşılaştırılır, kütüphanede ön çizimden türeyen anahtarda durur. Ajanlar sahtedir.
 */

const SIDE_SVG = CHARACTER_SVG.replace("<svg ", '<svg data-view="side" ').replace('fill="#c33"', 'fill="#3c3"');
const FRONT = "library/vector/character/front.svg";

type SideViews = (s: EpisodeState) => Promise<void>;
const sideViews = (h: Harness, state: EpisodeState) => (h.pipeline as unknown as { vectorSideViews: SideViews }).vectorSideViews.call(h.pipeline, state);

const walking = (anim: object) =>
  vshot({ layers: [{ asset: "c1", x: 400, depth: 0.3, anims: [anim] }, { asset: "c2", x: 1400, depth: 0.3, anims: [{ type: "explain" }] }] });

function stateWith(h: Harness, input: object = { sideViews: true }, anim: object = { type: "walk", toX: 900 }, extra: Partial<EpisodeState> = {}): EpisodeState {
  h.store.putText(FRONT, CHARACTER_SVG);
  h.store.putJsonSync(`${FRONT}.json`, { realHeight: 1.8, grounded: true });
  return makeState(
    { motionMode: "vector", ...input },
    {
      style: STYLE,
      cast: {
        characters: [CAST.characters[0]!, { id: "c2", name: "Clerk", kind: "person", role: "x", visualDescription: "clerk", scenes: [] }],
        locations: [],
      } as never,
      concept: { candidates: {}, selected: { c1: { key: FRONT, mimeType: "image/svg+xml" }, c2: { key: "library/vector/character/c2.svg", mimeType: "image/svg+xml" } } },
      shots: [{ id: "s1-sh1", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 3000, description: "", imagePrompt: "", motionPrompt: "", camera: "static", vector: walking(anim) }],
      ...extra,
    },
  );
}

function agents(scores: number[] = [9]) {
  const left = [...scores];
  onAgent("vectorDesigner", () => ({ svg: SIDE_SVG, realHeight: 1.7, grounded: true }));
  onAgent("assetGuess", () => ({ guess: "a man in profile", confidence: 8 }));
  onAgent("assetGate", () => ({ recognizable: left.length > 1 ? left.shift()! : left[0]!, fidelity: 9, defects: ["nose missing"] }));
}

beforeEach(() => {
  resetFakes();
  refs.rasterize.mockResolvedValue({ data: new Uint8Array([7]), mimeType: "image/png" });
});

describe("yan görünüş", () => {
  it("yürüyen karakter için ön çizime bakılarak çizilir, kapıda ön çizimle karşılaştırılır ve kütüphaneye yazılır", async () => {
    const h = harness();
    agents();
    const state = stateWith(h);
    await sideViews(h, state);
    const key = "library/vector/character/front.side.svg";
    expect(state.sideViews).toEqual({ c1: { key, ok: true } });
    expect(h.store.text(key)).toContain("#3c3");
    // Boy ön çizimden gelir (iki görünüş aynı boyda yerleşir).
    expect(h.store.json(`${key}.json`)).toMatchObject({ realHeight: 1.8, grounded: true, check: { passed: true, entityId: "c1~side" } });
    // Yürümeyen c2 için çizim yok; tasarımcı yan kipte, ön çizimin SVG'si ve görüntüsüyle çağrılır.
    const [call] = callsOf("vectorDesigner");
    expect(callsOf("vectorDesigner")).toHaveLength(1);
    expect(call!.args[0]).toMatchObject({ kind: "character", name: "Rider", view: "side", front: CHARACTER_SVG, references: [{ mimeType: "image/png" }] });
    // Kapının referansı ön çizimin görüntüsüdür.
    expect(callsOf("assetGate")[0]!.args[0]).toMatchObject({ name: "Rider (yan görünüş)", references: [{ data: new Uint8Array([7]) }] });
    expect(h.logs.some((l) => l.startsWith("  Rider (yan görünüş): çizildi ("))).toBe(true);
    expect(state.assetChecks![key]).toMatchObject({ passed: true, fidelity: 9 });

    // Aynı ön çizimle başka bölüm: kütüphaneden, para gitmez.
    resetFakes();
    const other = stateWith(h);
    await sideViews(h, other);
    expect(other.sideViews).toEqual({ c1: { key, ok: true } });
    expect(callsOf("vectorDesigner")).toHaveLength(0);
    expect(h.logs).toContain("  Rider (yan görünüş): kütüphaneden (kapı ✓)");

    // Bu bölümde zaten çizildi: tekrar çağrıda hiçbir şey yapılmaz.
    await sideViews(h, other);
    expect(callsOf("assetGate")).toHaveLength(0);
  });

  it("move ve slide_in de yer değiştirmedir; ayar kapalıysa ya da kimse yürümüyorsa çizilmez", async () => {
    for (const anim of [{ type: "move", toX: 900 }, { type: "slide_in", from: "left" }]) {
      const h = harness();
      agents();
      const state = stateWith(h, { sideViews: true }, anim);
      await sideViews(h, state);
      expect(state.sideViews?.c1?.ok).toBe(true);
    }
    resetFakes();
    const h = harness();
    agents();
    const off = stateWith(h, {});
    await sideViews(h, off);
    expect(off.sideViews).toBeUndefined();
    const still = stateWith(h, { sideViews: true }, { type: "nod" });
    // Vektörsüz çekim (eski plan) atlanır.
    still.shots!.push({ ...still.shots![0]!, id: "s1-sh2", vector: undefined });
    await sideViews(h, still);
    expect(still.sideViews).toEqual({});
    const noShots = stateWith(h, { sideViews: true }, { type: "walk" }, { shots: undefined, concept: undefined, cast: undefined });
    await sideViews(h, noShots);
    expect(noShots.sideViews).toEqual({});
    expect(callsOf("vectorDesigner")).toHaveLength(0);
  });

  it("kapıyı geçemezse karakter önden yürür; aynı ön çizim için yeniden çizilmez, seçim değişince yeniden çizilir", async () => {
    const h = harness();
    agents([5]);
    const state = stateWith(h);
    await sideViews(h, state);
    expect(state.sideViews).toEqual({ c1: { key: "library/vector/character/front.side.svg", ok: false } });
    expect(callsOf("vectorDesigner")).toHaveLength(3);
    // Düzeltme çizimi önceki denemenin üzerinden, kapının kusurlarıyla.
    expect(callsOf("vectorDesigner")[2]!.args[0]).toMatchObject({ fix: "- nose missing", previous: expect.stringContaining("#3c3") });
    expect(h.store.text("library/vector/character/front.side.svg")).toBeUndefined();
    expect(state.assetChecks!["library/vector/character/front.side.svg"]).toMatchObject({ passed: false, attempts: 3 });
    expect(h.logs).toContain("  Rider: yan görünüş kalite kapısından geçemedi; karakter önden yürüyecek");

    resetFakes();
    agents();
    await sideViews(h, state);
    expect(callsOf("vectorDesigner")).toHaveLength(0);

    // İnsan başka bir ön çizim seçti: eski yan kayıt bayat, yenisi çizilir.
    h.store.putText("library/vector/character/front2.svg", CHARACTER_SVG);
    state.concept!.selected.c1 = { key: "library/vector/character/front2.svg", mimeType: "image/svg+xml" };
    await sideViews(h, state);
    expect(state.sideViews!.c1).toEqual({ key: "library/vector/character/front2.side.svg", ok: true });
  });

  it("insan kararı: geçemeyen yan çizimi kabul edince kullanılır, reddedince bölüm önden yürür; konsept seçimi değişmez", async () => {
    const h = harness();
    agents([5]);
    const state = stateWith(h);
    await sideViews(h, state);
    const key = "library/vector/character/front.side.svg";
    expect(state.assetChecks![key]).toMatchObject({ entityId: "c1~side", rejectedKey: "library/vector/character/front.side.rejected.svg" });
    expect(h.store.text("library/vector/character/front.side.rejected.svg")).toContain("#3c3");

    state.done.timeline = "x";
    await acceptAsset(h.store, state, key);
    expect(state.sideViews!.c1).toEqual({ key, ok: true });
    expect(state.concept!.selected.c1!.key).toBe(FRONT);
    expect(state.done.timeline).toBeUndefined();
    expect(h.store.text(key)).toContain("#3c3");

    await rejectAsset(h.store, state, key, "burun yanlış");
    expect(state.sideViews!.c1).toEqual({ key, ok: false });
    expect(state.concept!.selected.c1!.key).toBe(FRONT);
    expect(state.concept!.candidates).toEqual({});

    // Başka bölüm: insanın reddettiği paylaşılan yan çizim yerinde yeniden çizilmez.
    resetFakes();
    agents();
    const other = stateWith(h);
    await sideViews(h, other);
    expect(other.sideViews!.c1).toEqual({ key, ok: false });
    expect(callsOf("vectorDesigner")).toHaveLength(0);
    expect(other.assetChecks![key]).toMatchObject({ entityId: "c1~side", override: { decision: "rejected" } });
  });

  it("tasarımcı hatası ve geçersiz SVG birer hak yer; hiçbir deneme kalmazsa karakter önden yürür; diğer hatalar yukarı çıkar", async () => {
    const { AgentError } = await import("@ys/agents");
    const h = harness();
    agents();
    let n = 0;
    onAgent("vectorDesigner", () => {
      n++;
      if (n === 1) throw new AgentError("vector-designer:character: error_max_turns", 0.05);
      if (n === 2) return { svg: '<svg viewBox="0 0 400 800"><g id="head"/></svg>', realHeight: 1.7, grounded: true };
      return { svg: SIDE_SVG, realHeight: 1.7, grounded: true };
    });
    const state = stateWith(h);
    await sideViews(h, state);
    expect(state.sideViews!.c1!.ok).toBe(true);
    expect(h.logs).toContain("  Rider (yan görünüş): deneme 1 tasarımcı hatası (vector-designer:character: error_max_turns)");
    expect(h.logs.some((l) => l.startsWith("  Rider (yan görünüş): deneme 2 geçersiz SVG ("))).toBe(true);
    expect((callsOf("vectorDesigner")[2]!.args[0] as { fix?: string }).fix).toMatch(/^- The SVG was invalid: /);

    const h2 = harness();
    onAgent("vectorDesigner", () => {
      throw new AgentError("vector-designer:character: error_max_turns", 0.01);
    });
    const none = stateWith(h2);
    await sideViews(h2, none);
    expect(none.sideViews!.c1!.ok).toBe(false);
    expect(h2.logs).toContain("  Rider: yan görünüş kalite kapısından geçemedi; karakter önden yürüyecek");

    onAgent("vectorDesigner", () => {
      throw new Error("iptal");
    });
    const h3 = harness();
    await expect(sideViews(h3, stateWith(h3))).rejects.toThrow("iptal");
  });

  it("timeline'a yalnız güncel ve geçmiş yan görünüşler <id>~side olarak gömülür", async () => {
    const h = harness();
    h.store.putText(FRONT, CHARACTER_SVG);
    h.store.putJsonSync(`${FRONT}.json`, { realHeight: 1.7 });
    h.store.putText("library/vector/character/front.side.svg", SIDE_SVG);
    h.store.putJsonSync("library/vector/character/front.side.svg.json", { realHeight: 1.7 });
    h.store.putText("lib/l1.svg", ROOM_SVG);
    const id = await h.seed(
      makeState(
        { motionMode: "vector", sideViews: true },
        {
          style: STYLE,
          script: SCRIPT,
          voice: { s1: voiceOf("s1") },
          shots: [],
          keyframes: {},
          cast: { characters: [CAST.characters[0]!, { id: "c2", name: "Clerk", kind: "person", role: "x", visualDescription: "x", scenes: [] }], locations: [] } as never,
          concept: { candidates: {}, selected: { c1: { key: FRONT, mimeType: "image/svg+xml" } } },
          sideViews: {
            c1: { key: "library/vector/character/front.side.svg", ok: true },
            // Geçemeyen ve seçimi olmayan karakterin kaydı gömülmez.
            c2: { key: "library/vector/character/c2.side.svg", ok: true },
            c3: { key: "x.side.svg", ok: false },
          },
        },
      ),
    );
    const state = await h.pipeline.run(id, { only: "timeline" });
    const assets = state.timeline!.vectorAssets!;
    expect(Object.keys(assets).sort()).toEqual(["c1", "c1~side"]);
    expect(assets["c1~side"]).toMatchObject({ id: "c1~side", kind: "character" });
    expect(assets["c1~side"]!.svg).toContain("#3c3");

    // Seçim değişti, yan kayıt eski ön çizime ait: gömülmez.
    const stale = await h.load(id);
    stale.sideViews!.c1!.key = "library/vector/character/old.side.svg";
    await h.seed(stale);
    const again = await h.pipeline.run(id, { only: "timeline" });
    expect(Object.keys(again.timeline!.vectorAssets!)).toEqual(["c1"]);
  });
});
