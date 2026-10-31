import { beforeEach, describe, expect, it, vi } from "vitest";
import { stylePackOf } from "@ys/core";
import { AssetRejectedError, CHARACTER_BANK_ID, type EpisodeState } from "../src/index.ts";
import { callsOf, onAgent, refs, resetFakes } from "./pipeline-fakes.ts";
import { CAST, CHARACTER_SVG, harness, makeState, SCRIPT, STYLE, voiceOf, vshot, type Harness } from "./pipeline-harness.ts";

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
 * Karakter bankası pipeline'da: seçilen sunucu/karakterler ve seri maskotları kadroya yeniden çizilmeden girer, sunucu
 * yönetmene bildirilir; bankada bölümden bağımsız karakter çizilir. Ajanlar sahtedir.
 */

const DIR = "library/vector/character/";
const ID = { host: "a".repeat(32), kid: "b".repeat(32), mascot: "c".repeat(32), other: "d".repeat(32) };

function putCharacter(h: Harness, id: string, name: string, extra: object = {}) {
  h.store.putText(`${DIR}${id}.svg`, CHARACTER_SVG);
  h.store.putJsonSync(`${DIR}${id}.svg.json`, {
    realHeight: 1.7,
    check: { kind: "character", name, recognizable: 9, passed: true },
    identity: { name, description: `${name} look`, pack: "flat-explainer", artStyle: STYLE.artStyle, lineStyle: "outline", episodes: [], ...extra },
  });
}

const beforeCast = (input: object = {}, extra: Partial<EpisodeState> = {}) =>
  makeState(
    { motionMode: "vector", lineStyle: "outline", ...input },
    { style: STYLE, script: SCRIPT, done: { style: "x", story: "x", script: "x" }, approvals: { script: "x" }, ...extra },
  );

beforeEach(() => {
  resetFakes();
  refs.find.mockResolvedValue({ images: [], sources: [], keys: [] });
  refs.vectors.mockResolvedValue([]);
  refs.rasterize.mockResolvedValue({ data: new Uint8Array([1]), mimeType: "image/png" });
});

describe("karakter bankası: kadro", () => {
  it("sunucu, seçilen karakter ve seri maskotu kadroya yeniden çizilmeden girer; casting onları yeniden uydurmaz", async () => {
    const h = harness();
    putCharacter(h, ID.host, "Ada", { role: "presenter" });
    putCharacter(h, ID.kid, "Can", { role: "curious kid" });
    putCharacter(h, ID.mascot, "Pofuduk", { mascotOf: ["Bilim Kısa"] });
    putCharacter(h, ID.other, "Başka stil", { artStyle: "other", lineStyle: "ink" });
    onAgent("castingDirector", () => CAST);
    const id = await h.seed(beforeCast({ series: "bilim kısa", presenter: ID.host, bankCast: [ID.kid, ID.other, "yok"] }));
    const state = await h.pipeline.run(id, { only: "cast" });

    const fixed = callsOf("castingDirector")[0]!.args[4];
    expect(fixed).toEqual([
      { name: "Ada", role: "on-screen presenter who speaks the narration to the viewer" },
      { name: "Can", role: "curious kid" },
      { name: "Pofuduk", role: "recurring character" },
    ]);
    const added = state.cast!.characters.slice(1);
    expect(added.map((c) => [c.id, c.name, c.reuse])).toEqual([
      ["c2", "Ada", ID.host],
      ["c3", "Can", ID.kid],
      ["c4", "Pofuduk", ID.mascot],
    ]);
    expect(added[0]).toMatchObject({ kind: "person", visualDescription: "Ada look", scenes: ["s1", "s2"] });
    expect(h.logs).toContain("Karakter bankasından kadroya: Ada, Can, Pofuduk");
    expect(h.logs).toContain("  Başka stil: bu bölümün stilinde değil, kadroya eklenmedi");
    expect(h.logs).toContain("Karakter bankasında yok: yok");
  });

  it("casting aynı kişiyi zaten seçtiyse ikinci kez eklenmez; yeni kimlik kullanılan numarayı atlar", async () => {
    const h = harness();
    putCharacter(h, ID.host, "Ada");
    putCharacter(h, ID.kid, "Can");
    onAgent("castingDirector", () => ({
      characters: [{ ...CAST.characters[0]!, reuse: ID.host }, { ...CAST.characters[0]!, id: "c3", name: "Üçüncü" }],
      locations: CAST.locations,
    }));
    const id = await h.seed(beforeCast({ presenter: ID.host, bankCast: [ID.kid] }));
    const state = await h.pipeline.run(id, { only: "cast" });
    // Ada zaten c1 (casting seçti); Can için c3 dolu olduğundan c4.
    expect(state.cast!.characters.map((c) => [c.id, c.name])).toEqual([["c1", "Rider"], ["c3", "Üçüncü"], ["c4", "Can"]]);
    expect(h.logs).toContain("Karakter bankasından kadroya: Can");
  });

  it("bankasız bölüm ve vektör olmayan mod kütüphaneye bakmaz", async () => {
    const h = harness();
    onAgent("castingDirector", () => CAST);
    const id = await h.seed(beforeCast({ motionMode: "still" }));
    await h.pipeline.run(id, { only: "cast" });
    expect(callsOf("castingDirector")[0]!.args[4]).toEqual([]);
  });
});

describe("karakter bankası: sunucu yönetmende", () => {
  it("sunucunun kadro kimliği yönetmene verilir; sunucusuz bölümde verilmez", async () => {
    const h = harness();
    onAgent("vectorDirector", () => ({ shots: [{ startWord: 0, description: "d", ambience: "none", spec: vshot({ layers: [] }) }], newProps: [], newBackgrounds: [] }));
    const cast = { characters: [...CAST.characters, { ...CAST.characters[0]!, id: "c2", name: "Ada", reuse: ID.host }], locations: CAST.locations };
    const voiced = (input: object) =>
      makeState(
        { motionMode: "vector", ...input },
        { style: STYLE, script: SCRIPT, cast: cast as never, voice: { s1: voiceOf("s1"), s2: voiceOf("s2") }, done: { style: "x", story: "x", script: "x", cast: "x" } },
      );
    await h.pipeline.run(await h.seed(voiced({ presenter: ID.host })), { only: "shots" });
    expect((callsOf("vectorDirector")[0]!.args[0] as { presenter?: string }).presenter).toBe("c2");
    resetFakes();
    onAgent("vectorDirector", () => ({ shots: [{ startWord: 0, description: "d", ambience: "none", spec: vshot({ layers: [] }) }], newProps: [], newBackgrounds: [] }));
    await h.pipeline.run(await h.seed(voiced({ presenter: "kadroda-yok" })), { only: "shots" });
    expect((callsOf("vectorDirector")[0]!.args[0] as { presenter?: string }).presenter).toBeUndefined();
    resetFakes();
    onAgent("vectorDirector", () => ({ shots: [{ startWord: 0, description: "d", ambience: "none", spec: vshot({ layers: [] }) }], newProps: [], newBackgrounds: [] }));
    await h.pipeline.run(await h.seed(voiced({})), { only: "shots" });
    expect((callsOf("vectorDirector")[0]!.args[0] as { presenter?: string }).presenter).toBeUndefined();
  });

  it("bölüm açılırken bankadan seçim stile uygulanır", async () => {
    const h = harness();
    putCharacter(h, ID.host, "Ada", { lineStyle: "ink" });
    const state = await h.pipeline.create({ ...makeState({ motionMode: "vector" }).input, stylePack: "auto", presenter: ID.host });
    expect(state.input).toMatchObject({ stylePack: "flat-explainer", lineStyle: "ink", presenter: ID.host });
  });
});

describe("karakter bankası: yeni karakter", () => {
  it("bölümden bağımsız çizilir, kapıdan geçer, rol ve banka işaretiyle kütüphaneye yazılır; sanal bölüm kaydedilmez", async () => {
    const h = harness();
    onAgent("assetPlanner", () => ({ subject: "a presenter", moved: [], cues: [] }));
    onAgent("vectorDesigner", () => ({ svg: CHARACTER_SVG, realHeight: 1.75, grounded: true }));
    onAgent("assetGuess", () => ({ guess: "a woman", confidence: 8 }));
    onAgent("assetGate", () => ({ recognizable: 9, fidelity: null, defects: [] }));
    const added = await h.pipeline.createBankCharacter({ name: "Ada", description: "young host", role: " presenter ", pack: "flat-explainer" });
    expect(added).toMatchObject({ name: "Ada", role: "presenter", bank: true, pack: "flat-explainer", lineStyle: stylePackOf("flat-explainer")!.lineStyle, artStyle: STYLE.artStyle });
    expect(callsOf("vectorDesigner")[0]!.args[0]).toMatchObject({ kind: "character", name: "Ada", description: "young host" });
    expect(h.store.map.has(`episodes/${CHARACTER_BANK_ID}/state.json`)).toBe(false);
    const roleless = await h.pipeline.createBankCharacter({ name: "Bora", description: "old man", pack: "flat-explainer", lineStyle: "ink", reference: "x" });
    expect(roleless).toMatchObject({ lineStyle: "ink", bank: true });
    expect(roleless.role).toBeUndefined();
  });

  it("bilinmeyen paket ve kapıdan geçemeyen çizim hata verir", async () => {
    const h = harness();
    await expect(h.pipeline.createBankCharacter({ name: "A", description: "x", pack: "yok" })).rejects.toThrow("Bilinmeyen stil paketi: yok");
    onAgent("assetPlanner", () => ({ subject: "x", moved: [], cues: [] }));
    onAgent("vectorDesigner", () => ({ svg: CHARACTER_SVG, realHeight: 1.7, grounded: true }));
    onAgent("assetGuess", () => ({ guess: "?", confidence: 2 }));
    onAgent("assetGate", () => ({ recognizable: 3, fidelity: null, defects: ["belirsiz"] }));
    await expect(h.pipeline.createBankCharacter({ name: "A", description: "x", pack: "flat-explainer" })).rejects.toBeInstanceOf(AssetRejectedError);
  });
});
