import { describe, expect, it, vi } from "vitest";
import type { LibraryCharacter } from "@ys/pipeline";
import { bankCommand } from "../src/bank.ts";

/** CLI karakter bankası komutu: listeleme, çizim isteği ve seri maskotu (kütüphane bellekte, çizim sahte). */

const DIR = "library/vector/character/";
const ID = "abcdef12".padEnd(32, "0");

function memStore() {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    put: async (k: string, b: Uint8Array) => (map.set(k, b), `mem://${k}`),
    get: async (k: string) => map.get(k) ?? null,
    list: async (p: string) => [...map.keys()].filter((k) => k.startsWith(p)),
  };
}

function setup() {
  const store = memStore();
  const json = (k: string, v: unknown) => store.map.set(k, new TextEncoder().encode(JSON.stringify(v)));
  const check = { kind: "character", name: "x", recognizable: 9, passed: true, defects: [], attempts: 1, sources: [], refs: [] };
  json(`${DIR}${ID}.svg.json`, { check, identity: { name: "Ada", description: "", role: "sunucu", bank: true, pack: "flat-explainer", artStyle: "a", lineStyle: "outline", episodes: ["e1"], mascotOf: ["Seri"] } });
  json(`${DIR}${"1".repeat(32)}.svg.json`, { check, identity: { name: "Eski", description: "", artStyle: "a", lineStyle: "ink", episodes: [] } });
  const lines: string[] = [];
  const created: object[] = [];
  const pipeline = {
    createBankCharacter: vi.fn(async (o: { name: string }) => {
      created.push(o);
      return { id: ID, name: o.name } as LibraryCharacter;
    }),
  };
  return { deps: { pipeline, store, print: (l: string) => lines.push(l) }, lines, created, store };
}

describe("bank komutu", () => {
  it("listeler: kısa kimlik, rol, paket, bölüm sayısı, banka ve maskot işaretleri", async () => {
    const { deps, lines } = setup();
    await bankCommand(deps, undefined, undefined, {});
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.includes("Ada"))).toMatch(/^abcdef12 {2}Ada .*sunucu .*flat-explainer .*outline .*1 bölüm {2}banka · maskot: Seri$/);
    expect(lines.find((l) => l.includes("Eski"))).toMatch(/özel .*ink .*0 bölüm$/);
  });

  it("add: zorunlu alanlar; çizgi stili doğrulanır, boş referans gönderilmez", async () => {
    const { deps, lines, created } = setup();
    await expect(bankCommand(deps, "add", undefined, { name: "Ada" })).rejects.toThrow("Kullanım: bank add");
    await bankCommand(deps, "add", undefined, { name: " Ada ", desc: " young host ", pack: "flat-explainer", line: "ink", role: "sunucu", reference: " " });
    expect(created[0]).toEqual({ name: "Ada", description: "young host", role: "sunucu", pack: "flat-explainer", lineStyle: "ink", reference: undefined });
    expect(lines).toEqual(["abcdef12  Ada bankaya eklendi"]);
    await bankCommand(deps, "add", undefined, { name: "B", desc: "d", pack: "flat-explainer", reference: "Atatürk" });
    expect(created[1]).toMatchObject({ lineStyle: undefined, reference: "Atatürk" });
    await expect(bankCommand(deps, "add", undefined, { name: "B", desc: "d", pack: "p", line: "kalın" })).rejects.toThrow();
  });

  it("mascot: kısa kimlikle eklenir ve çıkarılır; eksik bilgi ve bilinmeyen alt komut hata", async () => {
    const { deps, lines, store } = setup();
    await bankCommand(deps, "mascot", "abcdef", { series: "Yeni Seri" });
    const meta = () => JSON.parse(new TextDecoder().decode(store.map.get(`${DIR}${ID}.svg.json`)!)).identity.mascotOf;
    expect(meta()).toEqual(["Seri", "Yeni Seri"]);
    await bankCommand(deps, "mascot", ID, { series: "seri", remove: true });
    expect(meta()).toEqual(["Yeni Seri"]);
    expect(lines).toEqual(["seri maskotu yapıldı", "maskotluktan çıkarıldı"]);
    await expect(bankCommand(deps, "mascot", ID, {})).rejects.toThrow("Kullanım: bank mascot");
    await expect(bankCommand(deps, "mascot", "zzzzzzzz", { series: "S" })).rejects.toThrow("Karakter bankasında yok");
    await expect(bankCommand(deps, "sil", undefined, {})).rejects.toThrow("Bilinmeyen bank komutu: sil");
  });
});
