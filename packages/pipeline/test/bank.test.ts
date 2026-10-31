import { describe, expect, it } from "vitest";
import { styleFromPack, stylePackOf, trText } from "@ys/core";
import { bankChoice, listLibraryCharacters, seriesMascots, setMascot, withBankChoice, type EpisodeInput } from "../src/light.ts";
import { MemStore } from "./pipeline-harness.ts";

/** Karakter bankası: seçim, stil uyumu, seri maskotu ve bölüm girdisine uygulanması (para harcamaz). */

const dir = "library/vector/character/";
const hash = (n: number) => String(n).padStart(32, "0");
const passed = { kind: "character", name: "x", recognizable: 8, passed: true, defects: [], attempts: 1, sources: [], refs: [] };
const ABC = "abcdef12".padEnd(32, "0");
const FLAT = styleFromPack(stylePackOf("flat-explainer")!);

function bank(): MemStore {
  const store = new MemStore();
  const add = (n: number, identity: object) => {
    store.putText(`${dir}${hash(n)}.svg`, "<svg/>");
    store.putJsonSync(`${dir}${hash(n)}.svg.json`, { check: passed, identity: { description: "look", episodes: [], ...identity } });
  };
  add(1, { name: "Ada", role: "presenter", bank: true, pack: "flat-explainer", artStyle: FLAT.artStyle, lineStyle: "outline" });
  add(2, { name: "Bora", pack: "flat-explainer", artStyle: FLAT.artStyle, lineStyle: "outline", mascotOf: ["Bilim Kısa"] });
  add(3, { name: "Cem", pack: "flat-explainer", artStyle: FLAT.artStyle, lineStyle: "ink" });
  add(4, { name: "Custom", artStyle: "free style", lineStyle: "outline" });
  add(5, { name: "Old pack", pack: "no-such-pack", artStyle: "x", lineStyle: "outline" });
  store.putText(`${dir}${ABC}.svg`, "<svg/>");
  store.putJsonSync(`${dir}${ABC}.svg.json`, { check: passed, identity: { name: "Deniz", description: "", episodes: [], pack: "flat-explainer", artStyle: FLAT.artStyle, lineStyle: "outline" } });
  return store;
}

const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30, motionMode: "vector" };
const reason = async (p: Promise<unknown>) => trText((await p.then(() => undefined, (e: { text: never }) => e.text))!);

describe("karakter bankası", () => {
  it("listede rol, banka işareti ve maskot serileri görünür", async () => {
    const [ada, bora] = (await listLibraryCharacters(bank())).sort((a, b) => a.name.localeCompare(b.name));
    expect(ada).toMatchObject({ name: "Ada", role: "presenter", bank: true, mascotOf: [] });
    expect(bora).toMatchObject({ name: "Bora", mascotOf: ["Bilim Kısa"] });
  });

  it("seçilenler aynı paket ve çizgi stilindeyse ortak stil döner; değilse, paketsizse ya da yoksa hata", async () => {
    const store = bank();
    expect(await bankChoice(store, [])).toBeUndefined();
    expect(await bankChoice(store, [hash(1), hash(2), hash(1)])).toMatchObject({ pack: "flat-explainer", lineStyle: "outline", characters: [{ name: "Ada" }, { name: "Bora" }] });
    expect(await reason(bankChoice(store, [hash(1), hash(3)]))).toContain("farklı stillerde");
    expect(await reason(bankChoice(store, [hash(4)]))).toContain("Custom bir stil paketiyle çizilmedi");
    expect(await reason(bankChoice(store, [hash(5)]))).toContain("Old pack");
    expect(await reason(bankChoice(store, ["yok"]))).toBe("Karakter bankasında yok: yok");
  });

  it("bölüm girdisine uygulanır: stil paketi ve çizgi stili karakterlerinkine geçer, kısa kimlik çözülür", async () => {
    const store = bank();
    expect(await withBankChoice(store, input)).toBe(input);
    // Kısa kimlik (en az 6 hane, tek eşleşme) çözülür; sunucu kadro listesinden çıkar.
    const out = await withBankChoice(store, { ...input, stylePack: "auto", presenter: "abcdef", bankCast: [hash(1), ABC] });
    expect(out).toMatchObject({ presenter: ABC, bankCast: [hash(1)], stylePack: "flat-explainer", lineStyle: "outline" });
    // Belirsiz ya da çok kısa kimlik çözülmez: "bankada yok".
    expect(await reason(withBankChoice(store, { ...input, bankCast: ["000000"] }))).toContain("Karakter bankasında yok");
    expect(await reason(withBankChoice(store, { ...input, bankCast: ["abc"] }))).toContain("Karakter bankasında yok");
    expect(await withBankChoice(store, { ...input, bankCast: [hash(2)] })).toMatchObject({ bankCast: [hash(2)], presenter: undefined });
    expect(await withBankChoice(store, { ...input, presenter: hash(2), bankCast: [hash(2)] })).toMatchObject({ presenter: hash(2), bankCast: undefined });
    expect(await reason(withBankChoice(store, { ...input, motionMode: "still", presenter: hash(1) }))).toContain("yalnız vektör");
  });

  it("seri maskotu eklenir ve çıkarılır (seri adı büyük/küçük harf duyarsız); seri karakterleri bulunur", async () => {
    const store = bank();
    expect(await seriesMascots(store, undefined)).toEqual([]);
    expect((await seriesMascots(store, "bilim  kısa")).map((c) => c.name)).toEqual(["Bora"]);
    await setMascot(store, hash(1), "  Bilim Kısa ", true);
    expect((await seriesMascots(store, "Bilim Kısa")).map((c) => c.name).sort()).toEqual(["Ada", "Bora"]);
    await setMascot(store, hash(2), "BİLİM KISA", false);
    expect((await seriesMascots(store, "Bilim Kısa")).map((c) => c.name)).toEqual(["Ada"]);
    await expect(setMascot(store, "yok", "Seri", true)).rejects.toThrow("Karakter bankasında yok");
    await expect(setMascot(store, hash(1), "  ", true)).rejects.toThrow("Karakter bankasında yok");
  });
});
