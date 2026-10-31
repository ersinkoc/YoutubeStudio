import { VectorAnim } from "@ys/core";
import { describe, expect, it } from "vitest";
import { gaitOf, gestureWeight, hop, paceWalks, physicalAnims, travelled, type Body } from "../src/motion.ts";

const anims = (list: object[]) => list.map((a) => VectorAnim.parse(a));
const types = (list: VectorAnim[]) => list.map((a) => a.type);

const PERSON: Body = { kind: "character", grounded: true, held: false, sitting: false };
const DESK: Body = { kind: "prop", grounded: true, held: false, sitting: false };
const POSTER: Body = { kind: "prop", grounded: false, held: false, sitting: false };
const CUP: Body = { kind: "prop", grounded: false, held: true, sitting: false };

describe("hareket fiziği: animasyonların ayıklanması", () => {
  it("nesne karakter jesti yapamaz; yürüyebilir (sürü, at)", () => {
    const all = anims(["wave", "nod", "talk", "point", "shrug", "explain", "think", "cheer", "surprised", "sit", "walk", "pulse"].map((type) => ({ type })));
    expect(types(physicalAnims(all, DESK))).toEqual(["walk", "pulse"]);
    expect(types(physicalAnims(all, { ...PERSON, sitting: true }))).toHaveLength(all.length);
  });

  it("oturacak yeri olmayan karakter oturmaz", () => {
    expect(types(physicalAnims(anims([{ type: "sit" }, { type: "explain" }]), PERSON))).toEqual(["explain"]);
  });

  it("elde tutulan nesne kendi başına yer değiştirmez; görünme/büyüme kalır", () => {
    const list = anims(["move", "walk", "slide_in", "float", "sway", "shake", "fade_in", "pop", "pulse", "spin"].map((type) => ({ type })));
    expect(types(physicalAnims(list, CUP))).toEqual(["fade_in", "pop", "pulse", "spin"]);
  });

  it("yerdeki şey süzülmez ve dikeyde gitmez; yatay hedef korunur", () => {
    const out = physicalAnims(
      anims([
        { type: "float" },
        { type: "move", toY: 0 },
        { type: "move", toX: 500, toY: 0, start: 0.2 },
        { type: "walk", toY: 300 },
        { type: "move", toX: 700 },
      ]),
      DESK,
    );
    expect(out).toEqual([
      { type: "move", toX: 500, start: 0.2, end: 1 },
      { type: "walk", start: 0, end: 1 },
      { type: "move", toX: 700, start: 0, end: 1 },
    ]);
  });

  it("yerdeki şey yukarıdan düşmez/yerden çıkmaz: aynı pencerede belirir; yandan kayabilir", () => {
    const out = physicalAnims(anims([{ type: "slide_in", from: "top", start: 0.1, end: 0.3 }, { type: "slide_in", from: "bottom" }, { type: "slide_in", from: "left" }]), DESK);
    expect(out).toEqual([
      { type: "fade_in", start: 0.1, end: 0.3 },
      { type: "fade_in", start: 0, end: 1 },
      { type: "slide_in", from: "left", start: 0, end: 1 },
    ]);
  });

  it("havadaki nesne süzülür, dikeyde hareket eder", () => {
    const list = anims([{ type: "float" }, { type: "move", toY: 100 }, { type: "slide_in", from: "top" }]);
    expect(physicalAnims(list, POSTER)).toEqual(list);
  });
});

describe("hareket fiziği: yürüyüş", () => {
  const PX = 400; // derinlik 0'da 1 m

  it("alınan yol hedefe kadar, slide_in kenardan yerine kadar sayılır", () => {
    expect(travelled(anims([{ type: "move", toX: 1460 }]), 1, 960)).toBeCloseTo(500);
    expect(travelled(anims([{ type: "walk", toX: 460 }]), 1, 960)).toBeCloseTo(500);
    expect(travelled(anims([{ type: "slide_in" }]), 1, 960)).toBeCloseTo(960 + 400);
    expect(travelled(anims([{ type: "slide_in", from: "right" }]), 1, 960)).toBeCloseTo(1920 - 960 + 400);
    expect(travelled(anims([{ type: "slide_in", from: "top" }, { type: "move" }, { type: "pulse" }]), 1, 960)).toBe(0);
  });

  it("adım sayısı yol / adım uzunluğu; uzakta (küçük ölçek) aynı yol daha çok adımdır", () => {
    const walk = anims([{ type: "walk", toX: 960 + 280 * 5 }]);
    expect(gaitOf(walk, 1, 10, 960, PX, 10).steps).toBeCloseTo(5);
    expect(gaitOf(walk, 1, 10, 960, PX / 2, 10).steps).toBeCloseTo(10);
  });

  it("yürürken genlik tam, başta ve varınca sıfır; yön gidişe göre", () => {
    const right = anims([{ type: "walk", toX: 1600, start: 0.2, end: 0.8 }]);
    expect(gaitOf(right, 0.5, 5, 960, PX, 10)).toMatchObject({ amount: 1, dir: 1 });
    expect(gaitOf(right, 0.1, 1, 960, PX, 10)).toMatchObject({ amount: 0, dir: 0 });
    expect(gaitOf(right, 0.95, 9.5, 960, PX, 10)).toMatchObject({ amount: 0, dir: 0 });
    expect(gaitOf(anims([{ type: "walk", toX: 300 }]), 0.5, 5, 960, PX, 10).dir).toBe(-1);
    expect(gaitOf(anims([{ type: "slide_in" }]), 0.3, 3, 960, PX, 10).dir).toBe(1);
    expect(gaitOf(anims([{ type: "slide_in", from: "right" }]), 0.3, 3, 960, PX, 10).dir).toBe(-1);
  });

  it("çok yavaş kayma tam adım genliği vermez (yerinde sürünme gibi görünmesin)", () => {
    // 10 sn'de 20 px: rahat yürüme hızının çok altında.
    const g = gaitOf(anims([{ type: "move", toX: 980 }]), 0.5, 5, 960, PX, 10);
    expect(g.amount).toBeGreaterThan(0);
    expect(g.amount).toBeLessThan(0.1);
  });

  it("hedefsiz walk pencere içinde yerinde yürür, dışında durur", () => {
    const inPlace = anims([{ type: "walk", start: 0, end: 0.5 }]);
    expect(gaitOf(inPlace, 0.25, 2.5, 960, PX, 10)).toMatchObject({ amount: 1, dir: 0 });
    expect(gaitOf(inPlace, 0.25, 2.5, 960, PX, 10).steps).toBeCloseTo((2.5 * 1.3) / 0.7);
    expect(gaitOf(inPlace, 0.75, 7.5, 960, PX, 10).amount).toBe(0);
  });

  it("kısa yola verilen uzun yürüyüş penceresi doğal hıza kısalır; kısa pencere uzatılmaz", () => {
    // 200 px derinlik 0'da 0,5 m: rahat yürüyüşle ~0,58 sn; en az 0,6 sn.
    const [slow] = paceWalks(anims([{ type: "walk", toX: 1160, start: 0.1, end: 0.8 }]), 960, PX, 10, true);
    expect(slow!.end).toBeCloseTo(0.1 + 0.06);
    const [far] = paceWalks(anims([{ type: "walk", toX: 960 + 1040 }]), 960, PX, 10, true);
    expect(far!.end).toBeCloseTo(0.3);
    const fast = anims([{ type: "walk", toX: 1900, end: 0.1 }]);
    expect(paceWalks(fast, 960, PX, 10, true)).toEqual(fast);
    // Karakterin move'u yürüyüştür; nesnenin move'u (kayan pano) değildir. Hedefsiz yürüyüş ve süresiz çekim dokunulmaz.
    expect(paceWalks(anims([{ type: "move", toX: 1160 }]), 960, PX, 10, true)[0]!.end).toBeLessThan(1);
    const rest = anims([{ type: "move", toX: 1160 }, { type: "walk" }, { type: "pulse" }]);
    expect(paceWalks(rest, 960, PX, 10, false)).toEqual(rest);
    expect(paceWalks(anims([{ type: "walk", toX: 1160 }]), 960, PX, 0, true)[0]!.end).toBe(1);
  });

  it("jest saniyeyle girer: önce hafif ters (hazırlık), sonra hedefi geçip oturur; inişte taşma yok", () => {
    const [g] = anims([{ type: "explain", start: 0.2, end: 0.8 }]);
    const w = (sec: number, lag = 0) => gestureWeight(sec / 10, g!, 10, lag);
    expect(w(1.9)).toBe(0);
    const rise = Array.from({ length: 46 }, (_, i) => w(2 + i * 0.01));
    expect(Math.min(...rise)).toBeLessThan(0);
    expect(Math.max(...rise)).toBeGreaterThan(1);
    expect(w(2.45)).toBeCloseTo(1);
    expect(w(5)).toBe(1);
    const fall = Array.from({ length: 41 }, (_, i) => w(7.6 + i * 0.01));
    expect(Math.min(...fall)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...fall)).toBeLessThanOrEqual(1);
    expect(w(8)).toBe(0);
    expect(w(8.1)).toBe(0);
    // Süre saniyedir: 4 sn'lik çekimde de kalkış 0,45 sn.
    expect(gestureWeight(0.2 + 0.45 / 4, g!, 4)).toBeCloseTo(1);
  });

  it("ön kol üst kolu geriden izler: kalkışta da inişte de gecikir", () => {
    const [g] = anims([{ type: "explain", start: 0.2, end: 0.8 }]);
    expect(gestureWeight(0.2, g!, 10, 0.08)).toBe(0);
    expect(gestureWeight(0.208, g!, 10, 0.08)).toBe(0);
    // İnişte üst kol yere inmişken ön kol hâlâ kalkıktır.
    expect(gestureWeight(0.8, g!, 10)).toBe(0);
    expect(gestureWeight(0.8, g!, 10, 0.08)).toBeGreaterThan(0);
    expect(gestureWeight(0.81, g!, 10, 0.08)).toBe(0);
  });

  it("çekim boyunca süren jest kesmede zaten sürer (kalkış/iniş yok)", () => {
    const [g] = anims([{ type: "point" }]);
    expect([gestureWeight(0, g!, 5), gestureWeight(0, g!, 5, 0.08), gestureWeight(1, g!, 5)]).toEqual([1, 1, 1]);
  });

  it("sıçrayış parabolü: kalkışta ve inişte sıfır, ortada tepe", () => {
    expect([hop(-0.1), hop(0), hop(0.5), hop(1), hop(1.2)]).toEqual([0, 0, 1, 0, 0]);
    expect(hop(0.25)).toBeCloseTo(0.75);
  });
});
