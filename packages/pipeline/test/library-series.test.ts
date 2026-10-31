import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { backfillLibraryIdentities, listLibraryCharacters, noteCharacterUse } from "../src/library.ts";
import { seriesStylePack, summarizeSeries } from "../src/series.ts";
import { newEpisodeState } from "../src/actions.ts";
import type { EpisodeInput, EpisodeState } from "../src/state.ts";

const dir = "library/vector/character/";
const hash = (n: number) => String(n).padStart(32, "0");
const passed = { kind: "character", name: "x", recognizable: 8, passed: true };
const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 120, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30 };
const style = { artStyle: "noir", promptPrefix: "", negativeRules: [], palette: ["#000000", "#111111", "#222222"], lighting: "", lensLanguage: "" };
const tempStore = (): AssetStore => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-libs-")));

type Identity = { name: string; artStyle: string; lineStyle: string; episodes?: string[]; pack?: string; description: string };

describe("kütüphane: kenar durumlar", () => {
  it("bozuk meta atlanır; gerçeklik açık bölüme sadakatsiz geçmiş karakter yalnız insan kabul ettiyse önerilir", async () => {
    const store = tempStore();
    const identity = (name: string) => ({ name, description: "d", artStyle: "noir", lineStyle: "ink", episodes: [] });
    await putJson(store, `${dir}${hash(1)}.svg.json`, { check: { passed: "evet" }, identity: identity("Bozuk") });
    await putJson(store, `${dir}${hash(2)}.svg.json`, { check: { ...passed, fidelitySkipped: true }, identity: identity("Sadakatsiz") });
    await putJson(store, `${dir}${hash(3)}.svg.json`, {
      check: { ...passed, fidelitySkipped: true, override: { decision: "accepted", at: "t" } },
      identity: identity("Kabul edilmiş"),
    });
    await putJson(store, `${dir}${hash(4)}.svg.json`, { check: passed, identity: identity("Denetlenmiş") });
    const style = { artStyle: "noir", lineStyle: "ink" };
    expect((await listLibraryCharacters(store, { ...style, realism: true })).map((c) => c.name)).toEqual(["Denetlenmiş", "Kabul edilmiş"]);
    expect((await listLibraryCharacters(store, style)).map((c) => c.name)).toEqual(["Denetlenmiş", "Kabul edilmiş", "Sadakatsiz"]);
  });

  it("bölüm listesi olmayan eski kimliğe ilk bölüm eklenir; kimliksiz metaya dokunulmaz", async () => {
    const store = tempStore();
    const key = `${dir}${hash(5)}.svg`;
    await putJson(store, `${key}.json`, { identity: { name: "Eski", description: "d", artStyle: "noir", lineStyle: "ink" } });
    await noteCharacterUse(store, key, "ep1");
    expect((await getJson<{ identity: Identity }>(store, `${key}.json`))!.identity.episodes).toEqual(["ep1"]);
    const bare = `${dir}${hash(6)}.svg`;
    await putJson(store, `${bare}.json`, { check: passed });
    await noteCharacterUse(store, bare, "ep1");
    expect(await getJson(store, `${bare}.json`)).toEqual({ check: passed });
  });
});

describe("kütüphane kimliklerini geriye doldurma", () => {
  it("bölüm durumlarından kimlik yazar; eksik bilgili bölümleri ve kütüphane dışı seçimleri atlar", async () => {
    const store = tempStore();
    const character = (id: string, name: string) => ({ id, name, kind: "person" as const, role: "r", visualDescription: `${name} look`, reference: `${name} ref`, scenes: [] });
    const ep = (id: string, patch: Partial<EpisodeState>): EpisodeState => ({ ...newEpisodeState(input), id, ...patch });

    const k = (n: number) => `${dir}${hash(n)}.svg`;
    await putJson(store, `${k(1)}.json`, { check: passed });
    await putJson(store, `${k(2)}.json`, { check: passed, identity: { name: "Var", description: "d", artStyle: "noir", lineStyle: "ink", episodes: ["e0"] } });
    await putJson(store, `${k(3)}.json`, { check: passed, identity: { name: "Zaten", description: "d", artStyle: "noir", lineStyle: "ink", episodes: ["e1"] } });
    await putJson(store, `${k(5)}.json`, { check: passed, identity: { name: "Listesiz", description: "d", artStyle: "noir", lineStyle: "ink" } });

    const full = ep("e1", {
      style: { ...style, pack: "noir" },
      cast: { characters: [character("c1", "Yeni"), character("c2", "Var"), character("c3", "Zaten"), character("c4", "Metasız"), character("c5", "Listesiz"), character("c6", "Nesne"), character("c7", "Seçilmemiş")], locations: [] },
      concept: {
        candidates: {},
        selected: {
          c1: { key: k(1) } as never,
          c2: { key: k(2) } as never,
          c3: { key: k(3) } as never,
          c4: { key: k(4) } as never,
          c5: { key: k(5) } as never,
          c6: { key: "library/vector/prop/x.svg" } as never,
        },
      },
    });
    await putJson(store, "episodes/e1/state.json", full);
    await putJson(store, "episodes/e2/state.json", ep("e2", { cast: full.cast, concept: full.concept }));
    await putJson(store, "episodes/e3/state.json", ep("e3", { style, concept: full.concept }));
    await putJson(store, "episodes/e4/state.json", ep("e4", { style, cast: full.cast }));
    await putJson(store, "episodes/e1/notes.json", { x: 1 });

    expect(await backfillLibraryIdentities(store)).toBe(1);
    const identity = async (n: number) => (await getJson<{ identity: Identity }>(store, `${k(n)}.json`))!.identity;
    expect(await identity(1)).toEqual({
      name: "Yeni",
      description: "Yeni look",
      reference: "Yeni ref",
      pack: "noir",
      artStyle: "noir",
      lineStyle: "ink",
      episodes: ["e1"],
    });
    expect((await identity(2)).episodes).toEqual(["e0", "e1"]);
    expect((await identity(3)).episodes).toEqual(["e1"]);
    expect((await identity(5)).episodes).toEqual(["e1"]);
    expect(await getJson(store, `${k(4)}.json`)).toBeNull();
    // İkinci çalıştırma hiçbir şey eklemez.
    expect(await backfillLibraryIdentities(store)).toBe(0);
  });
});

describe("seriler: kenar durumlar", () => {
  let n = 0;
  const ep = (series: string, at: string, opts: { pack?: string; render?: boolean } = {}): EpisodeState => {
    const s: EpisodeState = { ...newEpisodeState({ ...input, series }), id: `s${++n}`, createdAt: at };
    if (opts.pack) s.style = { ...style, pack: opts.pack };
    if (opts.render) s.render = { path: "v.mp4", at };
    return s;
  };

  it("video sayısı render edilenlerden; varsayılanlar en yeni bölümden, eskisi araya girse de", () => {
    const newest = ep("Uzay", "2026-10-10", { pack: "space", render: true });
    const [summary] = summarizeSeries([ep("Uzay", "2026-10-01", { render: true }), newest, ep("uzay", "2026-10-05")]);
    expect(summary).toMatchObject({ name: "Uzay", episodes: 3, videos: 2, lastAt: "2026-10-10" });
    expect(summary!.defaults).toEqual({ lang: "tr", minutes: 2, tier: "economy", motionMode: undefined, stylePack: "space", lineStyle: undefined, voiceId: undefined, budgetUsd: 3 });
  });

  it("serinin en yeni paketli bölümünün paketi devralınır", () => {
    const current = ep("Uzay", "2026-10-20");
    expect(seriesStylePack([ep("Uzay", "2026-10-01", { pack: "eski" }), ep("Uzay", "2026-10-09", { pack: "yeni" }), ep("Uzay", "2026-10-05", { pack: "orta" }), current], current)).toBe("yeni");
  });
});
