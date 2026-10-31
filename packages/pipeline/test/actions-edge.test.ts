import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetCheck } from "@ys/core";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import {
  acceptAsset,
  approve,
  editNarration,
  EpisodeRepo,
  missingSelections,
  newEpisodeState,
  rejectAsset,
  reuseCharacter,
  revokeApproval,
  setMotion,
  stateKey,
} from "../src/actions.ts";
import type { EpisodeInput, EpisodeState } from "../src/state.ts";

const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30 };
const tempStore = (): AssetStore => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-act-")));
const check = (patch: Partial<AssetCheck> = {}): AssetCheck => ({
  kind: "character",
  name: "Rider",
  guess: "",
  recognizable: 8,
  passed: true,
  defects: [],
  attempts: 1,
  sources: [],
  refs: [],
  ...patch,
});
const rider = { id: "c1", name: "Rider", kind: "person" as const, role: "", visualDescription: "", scenes: [] };
const KEY = "library/vector/character/0123456789abcdef0123456789abcdef.svg";

describe("bölüm deposu ve kimlik", () => {
  it("harf içermeyen konu için kimlik 'bolum' olur; Türkçe harfler sadeleşir", () => {
    expect(newEpisodeState({ ...input, topic: "!!!" }).id).toMatch(/^\d{4}-\d{2}-\d{2}-bolum-[0-9a-f]+$/);
    expect(newEpisodeState({ ...input, topic: "Bekçi Işığı" }).id).toMatch(/-bekci-isigi-/);
  });

  it("olmayan bölüm hata verir; bozuk durum dosyası listeyi düşürmez", async () => {
    const store = tempStore();
    const repo = new EpisodeRepo(store);
    await expect(repo.load("yok")).rejects.toThrow("Bölüm bulunamadı: yok");
    await repo.save({ ...newEpisodeState(input), id: "iyi" });
    await store.put(stateKey("bozuk"), new TextEncoder().encode("{"), "application/json");
    expect((await repo.list()).map((s) => s.id)).toEqual(["iyi"]);
  });
});

describe("onay ve düzenleme: kenar durumlar", () => {
  it("senaryosuz senaryo onayı reddedilir; onaysız bölümde onay geri alma yalnız aşamaları açar", () => {
    const s = newEpisodeState(input);
    expect(() => approve(s, "script")).toThrow("Önce senaryo üretilmeli");
    s.done = { style: "x", story: "x", script: "x", cast: "x" };
    revokeApproval(s, "script");
    expect(s.done).toEqual({ style: "x", story: "x", script: "x" });
    expect(missingSelections(s)).toEqual([]);
  });

  it("olmayan sahne düzenlenemez", () => {
    const s = { ...newEpisodeState(input), script: { scenes: [] } };
    expect(() => editNarration(s, "s9", "x")).toThrow("Sahne yok: s9");
    expect(() => editNarration(newEpisodeState(input), "s1", "x")).toThrow("Sahne yok: s1");
  });
});

describe("hareket modu", () => {
  it("konsept onaylıysa değiştirilemez", () => {
    const s = { ...newEpisodeState(input), approvals: { concept: "t" } };
    expect(() => setMotion(s, "vector")).toThrow("hareket modu değiştirilemez");
  });

  it("görsel ↔ vektör geçişi konsepti siler; aynı aile içinde konsept kalır", () => {
    const s: EpisodeState = { ...newEpisodeState(input), concept: { candidates: {}, selected: {} }, done: { cast: "x", concept: "x", voice: "x" } };
    setMotion(s, "mixed", 0.4);
    expect(s.concept).toBeDefined();
    expect(s.input).toMatchObject({ motionMode: "mixed", aiClipRatio: 0.4 });
    setMotion(s, "vector");
    expect(s.concept).toBeUndefined();
    expect(s.done).toEqual({ cast: "x" });
    expect(s.input).toMatchObject({ motionMode: "vector", aiClipRatio: 0.4 });
    // Konsept yoksa geçişte silinecek bir şey yok.
    setMotion(s, "still");
    expect(s.input.motionMode).toBe("still");
  });
});

describe("insan kararı: kenar durumlar", () => {
  it("kapı kaydı yoksa kabul ve ret hata verir; reddedilen çizim depoda yoksa kabul edilemez", async () => {
    const store = tempStore();
    const s = newEpisodeState(input);
    await expect(acceptAsset(store, s, KEY)).rejects.toThrow(`Kapı kaydı yok: ${KEY}`);
    await expect(rejectAsset(store, s, KEY)).rejects.toThrow(`Kapı kaydı yok: ${KEY}`);
    s.assetChecks = { [KEY]: check({ rejectedKey: `${KEY}.rejected.svg` }) };
    await expect(acceptAsset(store, s, KEY)).rejects.toThrow("Reddedilen çizim depoda yok");
  });

  it("reddedilmiş deneme yoksa kabul yalnız kaydı onaylar; sahibi bulunamayan varlık bağlanmaz", async () => {
    const store = tempStore();
    const s: EpisodeState = { ...newEpisodeState(input), assetChecks: { [KEY]: check({ name: "Kimsesiz", passed: false }) } };
    s.lastError = { stage: "concept", message: "başka hata", at: "" };
    await acceptAsset(store, s, KEY);
    expect(await getJson(store, `${KEY}.json`)).toMatchObject({ check: { passed: true, override: { decision: "accepted" } } });
    expect(s.lastError).toBeDefined();

    await putJson(store, `${KEY}.json`, { realHeight: 1.6 });
    await acceptAsset(store, s, KEY);
    expect(await getJson(store, `${KEY}.json`)).toMatchObject({ realHeight: 1.6, check: { passed: true } });
  });

  it("adıyla eşleşen nesne sahibi bulunur; kurgu bitmediyse yeniden açılacak aşama yok", async () => {
    const store = tempStore();
    const s: EpisodeState = {
      ...newEpisodeState(input),
      vectorProps: { "p-desk": { description: "desk", kind: "prop" } },
      done: { keyframes: "x" },
      assetChecks: { [KEY]: check({ kind: "prop", name: "p-desk" }) },
    };
    await acceptAsset(store, s, KEY);
    expect(s.vectorProps!["p-desk"]!.key).toBe(KEY);
    expect(s.done).toEqual({ keyframes: "x" });
  });

  it("aynı aday ikinci kez eklenmez", async () => {
    const store = tempStore();
    const s: EpisodeState = {
      ...newEpisodeState(input),
      cast: { characters: [rider], locations: [] },
      concept: { candidates: { c1: [{ key: KEY, mimeType: "image/svg+xml" }] }, selected: {} },
      assetChecks: { [KEY]: check({ entityId: "c1" }) },
    };
    await acceptAsset(store, s, KEY);
    expect(s.concept!.candidates.c1).toHaveLength(1);
    expect(s.concept!.selected.c1?.key).toBe(KEY);
  });

  it("boş not kaydedilmez; metası olmayan varlığın kaydı yazılmaz; sahipsiz ret yalnız kaydı günceller", async () => {
    const store = tempStore();
    const s: EpisodeState = { ...newEpisodeState(input), assetChecks: { [KEY]: check({ name: "Kimsesiz" }) } };
    await rejectAsset(store, s, KEY, "   ");
    expect(s.assetChecks![KEY]!.override).toMatchObject({ decision: "rejected", note: undefined });
    expect(await getJson(store, `${KEY}.json`)).toBeNull();
  });

  it("kadro varlığını ret: seçili olmayan anahtar seçimi bozmaz, konsept bitmediyse aşamalar değişmez", async () => {
    const store = tempStore();
    const other = { key: "library/vector/character/diger.svg", mimeType: "image/svg+xml" };
    const s: EpisodeState = {
      ...newEpisodeState(input),
      cast: { characters: [rider], locations: [] },
      concept: { candidates: {}, selected: { c1: other } },
      done: { cast: "x" },
      assetChecks: { [KEY]: check({ entityId: "c1" }) },
    };
    await rejectAsset(store, s, KEY);
    expect(s.concept!.candidates.c1).toEqual([]);
    expect(s.concept!.selected.c1).toEqual(other);
    expect(s.done).toEqual({ cast: "x" });
  });

  it("nesneyi ret: bağlı çizimse kopar ve kareler yeniden açılır; başka çizime bağlıysa dokunulmaz", async () => {
    const store = tempStore();
    const s: EpisodeState = {
      ...newEpisodeState(input),
      cast: { characters: [rider], locations: [] },
      vectorProps: { "p-desk": { description: "desk", kind: "prop", key: KEY }, "p-cup": { description: "cup", kind: "prop", key: "baska.svg" } },
      done: { shots: "x", keyframes: "x", timeline: "x" },
      assetChecks: { [KEY]: check({ kind: "prop", entityId: "p-desk" }), "x.svg": check({ kind: "prop", entityId: "p-cup" }) },
    };
    await rejectAsset(store, s, KEY);
    expect(s.vectorProps!["p-desk"]!.key).toBeUndefined();
    expect(s.done).toEqual({ shots: "x" });
    await rejectAsset(store, s, "x.svg");
    expect(s.vectorProps!["p-cup"]!.key).toBe("baska.svg");
    // Kareler zaten açıksa yeniden açılacak bir şey yok.
    s.vectorProps!["p-desk"]!.key = KEY;
    await rejectAsset(store, s, KEY);
    expect(s.vectorProps!["p-desk"]!.key).toBeUndefined();
  });

  it("kadrosuz bölümde kimlikli nesne reddi yalnız kaydı günceller", async () => {
    const store = tempStore();
    const s: EpisodeState = { ...newEpisodeState(input), assetChecks: { [KEY]: check({ kind: "prop", entityId: "p-yok" }) } };
    await rejectAsset(store, s, KEY);
    expect(s.assetChecks![KEY]).toMatchObject({ passed: false, override: { decision: "rejected" } });
  });

  it("konseptsiz bölümde kadro kimliğiyle ret nesne yoluna düşer ve hiçbir şeyi bozmaz", async () => {
    const store = tempStore();
    const s: EpisodeState = { ...newEpisodeState(input), cast: { characters: [rider], locations: [] }, assetChecks: { [KEY]: check({ entityId: "c1" }) } };
    await rejectAsset(store, s, KEY);
    expect(s.assetChecks![KEY]!.passed).toBe(false);
    expect(s.concept).toBeUndefined();
  });

  it("kütüphaneden tekrar kullanılan karakteri ret yalnız bu bölümden ayırır, paylaşılan kayda dokunmaz", async () => {
    const store = tempStore();
    const shared = { check: check(), identity: { name: "Rider", description: "d", artStyle: "a", lineStyle: "ink", episodes: ["e0"] } };
    await putJson(store, `${KEY}.json`, shared);
    const s: EpisodeState = {
      ...newEpisodeState(input),
      cast: { characters: [{ ...rider, reuse: "0123456789abcdef0123456789abcdef" }], locations: [] },
      concept: { candidates: { c1: [{ key: KEY, mimeType: "image/svg+xml" }] }, selected: { c1: { key: KEY, mimeType: "image/svg+xml" } } },
      assetChecks: { [KEY]: check({ entityId: "c1" }) },
    };
    await rejectAsset(store, s, KEY, "bu o değil");
    expect(s.cast!.characters[0]!.reuse).toBeUndefined();
    expect(s.concept!.selected.c1).toBeUndefined();
    expect(s.assetChecks![KEY]!.override?.note).toBe("bu o değil");
    expect(await getJson(store, `${KEY}.json`)).toEqual(shared);
  });
});

describe("kütüphaneden karakter kullanma: kenar durumlar", () => {
  const state = (realism?: boolean): EpisodeState => ({
    ...newEpisodeState({ ...input, realism }),
    cast: { characters: [rider], locations: [] },
    concept: { candidates: {}, selected: {} },
  });
  const identity = { name: "Rider", description: "d", artStyle: "a", lineStyle: "ink", episodes: [] };

  it("kadroda olmayan ya da konsepti olmayan bölümde, metası olmayan anahtarla reddedilir", async () => {
    const store = tempStore();
    await expect(reuseCharacter(store, state(), "c9", KEY)).rejects.toThrow("Kadroda yok: c9");
    await expect(reuseCharacter(store, { ...state(), concept: undefined }, "c1", KEY)).rejects.toThrow("Kadroda yok: c1");
    await expect(reuseCharacter(store, state(), "c1", KEY)).rejects.toThrow("Kütüphanede onaylı karakter değil");
  });

  it("gerçeklik kapalıyken geçen karakter gerçeklik açık bölümde yalnız insan kabul ettiyse kullanılır", async () => {
    const store = tempStore();
    await putJson(store, `${KEY}.json`, { check: check({ fidelitySkipped: true }), identity });
    await expect(reuseCharacter(store, state(), "c1", KEY)).rejects.toThrow("gerçeklik denetimi kapalıyken geçti");
    const off = state(false);
    await reuseCharacter(store, off, "c1", KEY);
    expect(off.concept!.selected.c1?.key).toBe(KEY);

    await putJson(store, `${KEY}.json`, { check: check({ fidelitySkipped: true, override: { decision: "accepted", at: "t" } }), identity });
    const on = state();
    on.concept!.candidates.c1 = [{ key: KEY, mimeType: "image/svg+xml" }];
    await reuseCharacter(store, on, "c1", KEY);
    expect(on.concept!.candidates.c1).toHaveLength(1);
    expect(on.cast!.characters[0]!.reuse).toBe("0123456789abcdef0123456789abcdef");
    expect((await getJson<{ identity: { episodes: string[] } }>(store, `${KEY}.json`))!.identity.episodes).toEqual([on.id]);
  });
});
