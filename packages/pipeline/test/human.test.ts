import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetCheck } from "@ys/core";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { acceptAsset, newEpisodeState, rejectAsset, setRealism, type EpisodeInput, type EpisodeState } from "../src/light.ts";

const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30 };
const KEY = "library/vector/character/abc.svg";
const REJECTED = "library/vector/character/abc.rejected.svg";

function setup(check: Partial<AssetCheck> = {}) {
  const store: AssetStore = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-human-")));
  const state: EpisodeState = {
    ...newEpisodeState(input),
    cast: {
      characters: [{ id: "c1", name: "Rider", kind: "person", role: "", visualDescription: "", scenes: [] }],
      locations: [],
    },
    concept: { candidates: {}, selected: {} },
    vectorProps: { "p-horse": { description: "horse", kind: "prop" } },
    lastError: { stage: "concept", message: "Kalite kapısı: Rider kabul edilebilir çizilemedi", at: "" },
    assetChecks: {
      [KEY]: {
        kind: "character",
        name: "Rider",
        guess: "a cowboy",
        recognizable: 5,
        fidelity: 4,
        passed: false,
        defects: ["no mail bag"],
        attempts: 3,
        sources: [],
        refs: [],
        rejectedKey: REJECTED,
        ...check,
      },
    },
  };
  return { store, state };
}

describe("kalite kapısında insan kararı", () => {
  it("reddedileni kabul: en iyi deneme kütüphaneye onaylı yazılır, konsepte aday ve seçim olur, kapı hatası kalkar", async () => {
    const { store, state } = setup({ entityId: "c1" });
    await store.put(REJECTED, new TextEncoder().encode("<svg/>"), "image/svg+xml");
    await putJson(store, `${REJECTED}.json`, { realHeight: 1.7 });
    await acceptAsset(store, state, KEY);
    expect(new TextDecoder().decode((await store.get(KEY))!)).toBe("<svg/>");
    const meta = await getJson<{ realHeight: number; check: AssetCheck }>(store, `${KEY}.json`);
    expect(meta).toMatchObject({ realHeight: 1.7, check: { passed: true, override: { decision: "accepted" } } });
    expect(state.concept!.selected.c1?.key).toBe(KEY);
    expect(state.lastError).toBeUndefined();
  });

  it("kimliği olmayan eski kayıt da adından sahibine bağlanır", async () => {
    const { store, state } = setup();
    await store.put(REJECTED, new TextEncoder().encode("<svg/>"), "image/svg+xml");
    await acceptAsset(store, state, KEY);
    expect(state.concept!.selected.c1?.key).toBe(KEY);
  });

  it("geçmiş çizimi notla reddetme: kullanılmaz işaretlenir, seçimden ve onaydan çıkar, konsept yeniden açılır", async () => {
    const { store, state } = setup({ entityId: "c1", passed: true, rejectedKey: undefined, recognizable: 8 });
    state.concept = { candidates: { c1: [{ key: KEY, mimeType: "image/svg+xml" }] }, selected: { c1: { key: KEY, mimeType: "image/svg+xml" } } };
    state.done = { style: "x", story: "x", script: "x", cast: "x", concept: "x" };
    state.approvals = { script: "x", concept: "x" };
    await putJson(store, `${KEY}.json`, { realHeight: 1.7 });
    await rejectAsset(store, state, KEY, "  shirt should be faded red ");
    expect(state.assetChecks![KEY]).toMatchObject({ passed: false, override: { decision: "rejected", note: "shirt should be faded red" } });
    expect(state.concept!.selected.c1).toBeUndefined();
    expect(state.concept!.candidates.c1).toEqual([]);
    expect(state.approvals.concept).toBeUndefined();
    expect(state.done.concept).toBeUndefined();
    expect((await getJson<{ check: AssetCheck }>(store, `${KEY}.json`))!.check.override?.decision).toBe("rejected");
  });

  it("nesneyi kabul: çekimlere girer, render yeniden açılır", async () => {
    const { store, state } = setup({ entityId: "p-horse", kind: "prop", name: "p-horse" });
    await store.put(REJECTED, new TextEncoder().encode("<svg/>"), "image/svg+xml");
    state.done = { timeline: "x", render: "x" };
    await acceptAsset(store, state, KEY);
    expect(state.vectorProps!["p-horse"]!.key).toBe(KEY);
    expect(state.done.render).toBeUndefined();
  });

  it("gerçeklik denetimi bölüm bazında kapatılır", () => {
    const { state } = setup();
    setRealism(state, false);
    expect(state.input.realism).toBe(false);
  });
});
