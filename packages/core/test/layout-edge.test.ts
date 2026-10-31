import { describe, expect, it } from "vitest";
import { floorYOf, resolveLayout, STAGE, VectorShot, type VectorAsset } from "../src/index.ts";

const asset = (id: string, kind: VectorAsset["kind"], meta: VectorAsset["meta"] = {}, w = 400, h = 400): VectorAsset => ({
  id,
  kind,
  svg: "<svg/>",
  width: w,
  height: h,
  meta,
});

const shot = (layers: unknown[], background?: string) => VectorShot.parse({ background, layers });

describe("sahne fiziği: kenar durumlar", () => {
  it("arka plan yoksa ya da zemin çizgisi bildirmiyorsa varsayılan zemin kullanılır", () => {
    expect(floorYOf(shot([]), {})).toBe(STAGE.defaultFloorY);
    expect(floorYOf(shot([], "room"), { room: asset("room", "background") })).toBe(STAGE.defaultFloorY);
    // Kayıtlı olmayan arka plan da varsayılana düşer; aşırı değer sınıra çekilir.
    expect(floorYOf(shot([], "yok"), {})).toBe(STAGE.defaultFloorY);
    expect(floorYOf(shot([], "room"), { room: asset("room", "background", { floorY: 2000 }) })).toBe(900);
  });

  it("gerçek boy verilmemişse türün varsayılan boyu kullanılır (elde tutulan için 0,3 m)", () => {
    const assets = { ali: asset("ali", "character", {}, 400, 800), cup: asset("cup", "prop", {}, 100, 400) };
    const placed = resolveLayout(shot([{ asset: "ali", x: 900, depth: 0 }, { asset: "cup", x: 0, heldBy: 0 }]), assets);
    const ali = placed.find((p) => p.index === 0)!;
    const cup = placed.find((p) => p.index === 1)!;
    expect(ali.height).toBeCloseTo(1.7 * STAGE.pxPerMeter);
    expect(cup.height).toBeCloseTo(0.3 * STAGE.pxPerMeter);
  });

  it("grounded bildirilmemiş nesne derinlik ya da zemin altındaki y ile yere basar; zeminin üstündeki y duvardadır", () => {
    const assets = { box: asset("box", "prop", { realHeight: 1 }) };
    const placed = resolveLayout(
      shot([
        { asset: "box", x: 400, depth: 0.5 },
        { asset: "box", x: 800, y: 1000 },
        { asset: "box", x: 1200, y: 300 },
        { asset: "box", x: 1600 },
      ]),
      assets,
    );
    const by = (i: number) => placed.find((p) => p.index === i)!;
    expect(by(0).z).toBeCloseTo(50);
    expect(by(1).fixes).toContain("piksel konumu derinliğe çevrildi");
    // Duvardaki öğe yerdekilerin arkasında, verilen y'de.
    expect(by(2).z).toBeLessThan(0);
    expect(by(2).y).toBe(300);
    // y de derinlik de yoksa: duvarda, zemin çizgisinin biraz üstünde ve gerçek boyun %80'i.
    expect(by(3).y).toBe(STAGE.defaultFloorY - 60);
    expect(by(3).height).toBeCloseTo(STAGE.pxPerMeter * 0.8);
  });

  it("grounded=true nesnenin derinliği yoksa 0,3 varsayılır", () => {
    const placed = resolveLayout(shot([{ asset: "desk", x: 900 }]), { desk: asset("desk", "prop", { realHeight: 1, grounded: true }) });
    expect(placed[0]!.z).toBeCloseTo(70);
    expect(placed[0]!.fixes).toContain("piksel konumu derinliğe çevrildi");
  });

  it("elle verilen z çizim sırasını belirler", () => {
    const assets = { ali: asset("ali", "character", { realHeight: 1.7 }, 400, 800), lamp: asset("lamp", "prop", { grounded: true, realHeight: 1 }) };
    const placed = resolveLayout(shot([{ asset: "ali", x: 600, depth: 0.1, z: -50 }, { asset: "lamp", x: 1400, depth: 0.9 }]), assets);
    expect(placed.map((p) => p.index)).toEqual([0, 1]);
    expect(placed[0]!.z).toBe(-50);
  });

  it("karakter olmayan tutucu yok sayılır; karakterin üstündeki nesne omuz hizasına konur", () => {
    const assets = {
      ali: asset("ali", "character", { realHeight: 1.7 }, 400, 800),
      table: asset("table", "prop", { realHeight: 0.8, grounded: true }, 400, 400),
      bird: asset("bird", "prop", { realHeight: 0.4 }, 400, 400),
    };
    const placed = resolveLayout(
      shot([
        { asset: "table", x: 500, depth: 0.2 },
        { asset: "bird", x: 900, depth: 0.4, heldBy: 0 },
        { asset: "ali", x: 1300, depth: 0.2 },
        { asset: "bird", x: 1300, on: 2 },
      ]),
      assets,
    );
    const by = (i: number) => placed.find((p) => p.index === i)!;
    expect(by(1).heldBy).toBeUndefined();
    expect(by(1).z).toBeCloseTo(60);
    expect(by(3).y).toBeCloseTo(by(2).y - by(2).height * 0.5);
  });

  it("varlığı olmayan katman yerleştirilmez", () => {
    expect(resolveLayout(shot([{ asset: "yok", x: 1 }]), {})).toEqual([]);
  });

  it("sahneye yürüyerek/kayarak/hareketle giren karakter kadraj dışında bırakılır, durağan olan içeri alınır", () => {
    const assets = { ali: asset("ali", "character", { realHeight: 1.7 }, 400, 800) };
    const placed = resolveLayout(
      shot([
        { asset: "ali", x: -300, depth: 0.1, anims: [{ type: "walk", toX: 600 }] },
        { asset: "ali", x: 2300, depth: 0.5, anims: [{ type: "slide_in", from: "right" }] },
        { asset: "ali", x: -500, depth: 0.9, anims: [{ type: "move", toX: 900 }] },
        { asset: "ali", x: 2400, depth: 0.7, anims: [{ type: "wave" }] },
      ]),
      assets,
    );
    const by = (i: number) => placed.find((p) => p.index === i)!;
    expect(by(0).x).toBe(-300);
    expect(by(1).x).toBe(2300);
    expect(by(2).x).toBe(-500);
    expect(by(3).x + by(3).width / 2).toBeLessThanOrEqual(STAGE.width);
    expect(by(3).fixes).toContain("kadraj dışına taşıyordu");
  });
});

describe("sahne fiziği: olmayan katmana başvuru", () => {
  it("var olmayan katmanın üstüne konan nesne kendi başına yerleşir", () => {
    const placed = resolveLayout(shot([{ asset: "box", x: 500, depth: 0.5, on: 7 }]), { box: asset("box", "prop", { realHeight: 1 }) });
    expect(placed).toHaveLength(1);
    expect(placed[0]!.z).toBeCloseTo(50);
  });
});
