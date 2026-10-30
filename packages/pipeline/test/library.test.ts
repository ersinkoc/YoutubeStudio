import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { listLibraryCharacters, newEpisodeState, noteCharacterUse, reuseCharacter, type EpisodeInput, type EpisodeState } from "../src/light.ts";

const dir = "library/vector/character/";
const hash = (n: number) => String(n).padStart(32, "0");
const passed = { kind: "character", name: "x", recognizable: 8, passed: true, defects: [], attempts: 1, sources: [], refs: [] };
const identity = (name: string, artStyle = "noir", lineStyle = "ink") => ({ name, description: `${name} look`, artStyle, lineStyle, episodes: [] });

async function library(): Promise<AssetStore> {
  const store: AssetStore = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-lib-")));
  const add = async (n: number, meta: object) => {
    await store.put(`${dir}${hash(n)}.svg`, new TextEncoder().encode("<svg/>"), "image/svg+xml");
    await putJson(store, `${dir}${hash(n)}.svg.json`, meta);
  };
  await add(1, { check: passed, identity: identity("Mehmed II") });
  await add(2, { check: { ...passed, passed: false }, identity: identity("Failed") });
  await add(3, { check: { ...passed, override: { decision: "rejected", at: "" } }, identity: identity("Human rejected") });
  await add(4, { check: passed, identity: identity("Other style", "flat", "flat") });
  await add(5, { check: passed });
  await putJson(store, `${dir}${hash(6)}.rejected.svg.json`, { check: passed, identity: identity("Rejected copy") });
  return store;
}

describe("karakter kütüphanesi", () => {
  it("yalnız onaylı, kimliği bilinen ve aynı stildeki karakterler listelenir", async () => {
    const store = await library();
    expect((await listLibraryCharacters(store, { artStyle: "noir", lineStyle: "ink" })).map((c) => c.name)).toEqual(["Mehmed II"]);
    expect((await listLibraryCharacters(store)).map((c) => c.name).sort()).toEqual(["Mehmed II", "Other style"]);
    expect((await listLibraryCharacters(store))[0]!.id).toMatch(/^0+[14]$/);
  });

  it("kullanıldığı bölüm bir kez yazılır", async () => {
    const store = await library();
    await noteCharacterUse(store, `${dir}${hash(1)}.svg`, "ep1");
    await noteCharacterUse(store, `${dir}${hash(1)}.svg`, "ep1");
    expect((await getJson<{ identity: { episodes: string[] } }>(store, `${dir}${hash(1)}.svg.json`))!.identity.episodes).toEqual(["ep1"]);
  });

  it("Stüdyo'dan kütüphaneden seçme: aday olur, seçilir, kapı kaydı ve tekrar kullanım işareti düşer", async () => {
    const store = await library();
    const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30 };
    const state: EpisodeState = {
      ...newEpisodeState(input),
      cast: { characters: [{ id: "c1", name: "Fatih", kind: "person", role: "", visualDescription: "", scenes: [] }], locations: [] },
      concept: { candidates: {}, selected: {} },
    };
    const key = `${dir}${hash(1)}.svg`;
    await reuseCharacter(store, state, "c1", key);
    expect(state.concept!.selected.c1?.key).toBe(key);
    expect(state.assetChecks![key]).toMatchObject({ passed: true, entityId: "c1" });
    expect(state.cast!.characters[0]!.reuse).toBe(hash(1));
    await expect(reuseCharacter(store, state, "c1", `${dir}${hash(2)}.svg`)).rejects.toThrow("onaylı");
  });
});
