import { describe, expect, it } from "vitest";
import { applyLineStyle, depthToFloor, resolveLayout, STAGE, VectorShot, type VectorAsset } from "@ys/core";

const asset = (id: string, kind: VectorAsset["kind"], meta: VectorAsset["meta"] = {}, w = 400, h = 400): VectorAsset => ({
  id,
  kind,
  svg: "<svg/>",
  width: w,
  height: h,
  meta,
});

const assets: Record<string, VectorAsset> = {
  room: asset("room", "background", { floorY: 700 }, 1920, 1080),
  ali: asset("ali", "character", { realHeight: 1.7 }, 400, 800),
  ayse: asset("ayse", "character", { realHeight: 1.6 }, 400, 800),
  desk: asset("desk", "prop", { realHeight: 0.75, grounded: true, surface: 0.95 }, 600, 300),
  chair: asset("chair", "prop", { realHeight: 0.9, grounded: true, surface: 0.5 }, 300, 400),
  chip: asset("chip", "prop", { realHeight: 0.05, grounded: false }, 200, 200),
  clock: asset("clock", "prop", { realHeight: 0.4, grounded: false }, 200, 200),
};

const shot = (layers: unknown[]) => VectorShot.parse({ background: "room", layers });

describe("sahne fiziği", () => {
  it("derinlik ayağın bastığı yeri, ölçeği ve gerçek boyu belirler; arkadaki önce çizilir", () => {
    const placed = resolveLayout(shot([{ asset: "ali", x: 600, depth: 0.6 }, { asset: "desk", x: 600, depth: 0.2 }]), assets);
    expect(placed.map((p) => p.index)).toEqual([0, 1]); // karakter masanın arkasında: önce çizilir
    const [ali, desk] = placed;
    expect(ali!.y).toBeLessThan(desk!.y); // daha uzakta: ayak çizgisi daha yukarıda
    expect(ali!.height).toBeCloseTo(1.7 * STAGE.pxPerMeter * depthToFloor(0.6, 700).scale);
    // Gerçek oran: aynı derinlikte masa, insanın ~%44'ü.
    expect(desk!.height / desk!.scale / (ali!.height / ali!.scale)).toBeCloseTo(0.75 / 1.7, 2);
  });

  it("pikselle verilmiş yerdeki karakteri fiziğe çevirir, boyunu gerçek ölçüye getirir", () => {
    const [ali] = resolveLayout(shot([{ asset: "ali", x: 900, y: 940, height: 300 }]), assets);
    expect(ali!.fixes).toContain("piksel konumu derinliğe çevrildi");
    expect(ali!.fixes).toContain("boy gerçek ölçüye göre düzeltildi");
    expect(ali!.height).toBeGreaterThan(500);
  });

  it("nesne masanın yüzeyine oturur ve masadan taşmaz; karakter sandalyede oturur", () => {
    const placed = resolveLayout(
      shot([
        { asset: "desk", x: 960, depth: 0.3 },
        { asset: "chip", x: 2000, on: 0 },
        { asset: "chair", x: 500, depth: 0.4 },
        { asset: "ali", x: 0, on: 2 },
      ]),
      assets,
    );
    const by = (i: number) => placed.find((p) => p.index === i)!;
    const desk = by(0);
    const chip = by(1);
    expect(chip.y).toBeCloseTo(desk.y - desk.height * 0.95);
    expect(chip.x).toBeLessThanOrEqual(desk.x + desk.width / 2);
    expect(chip.fixes).toContain("yüzeyin dışına taşıyordu, içeri alındı");
    expect(chip.z).toBeGreaterThan(desk.z);
    const ali = by(3);
    expect(ali.sitting).toBe(true);
    expect(ali.x).toBe(by(2).x);
    expect(ali.z).toBeGreaterThan(by(2).z);
  });

  it("duvardaki öğe yerdekilerin arkasında kalır; elde tutulan nesne tutanın önünde", () => {
    const placed = resolveLayout(
      shot([
        { asset: "clock", x: 300, y: 300, height: 120 },
        { asset: "ali", x: 900, depth: 0.5 },
        { asset: "chip", x: 0, heldBy: 1 },
      ]),
      assets,
    );
    expect(placed.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(placed[2]!.heldBy).toBe(1);
  });

  it("karakter elde tutulmaz: tutma yok sayılır, kendi yerinde durur", () => {
    const placed = resolveLayout(shot([{ asset: "ali", x: 600, depth: 0.5 }, { asset: "ayse", x: 1200, depth: 0.5, heldBy: 0 }]), assets);
    const ayse = placed.find((p) => p.index === 1)!;
    expect(ayse.heldBy).toBeUndefined();
    expect(ayse.grounded).toBe(true);
    expect(ayse.x).toBe(1200);
  });

  it("karakter başka karakterin üstüne oturmaz; nesne karakterin üstünde durabilir", () => {
    const placed = resolveLayout(
      shot([
        { asset: "ali", x: 600, depth: 0.5 },
        { asset: "ayse", x: 1200, depth: 0.5, on: 0 },
        { asset: "chip", x: 600, on: 0 },
      ]),
      assets,
    );
    const by = (i: number) => placed.find((p) => p.index === i)!;
    expect(by(1)).toMatchObject({ sitting: false, grounded: true, x: 1200 });
    expect(by(1).y).toBe(by(0).y);
    expect(by(2).y).toBeLessThan(by(0).y);
  });

  it("aynı derinlikte üst üste binen karakterleri ayırır, kadraj dışına taşanı içeri alır", () => {
    const placed = resolveLayout(shot([{ asset: "ali", x: 900, depth: 0.3 }, { asset: "ayse", x: 920, depth: 0.32 }, { asset: "ali", x: 1910, depth: 0 }]), assets);
    const [a, b] = [placed.find((p) => p.index === 0)!, placed.find((p) => p.index === 1)!];
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual((a.width + b.width) * 0.32 - 1);
    const edge = placed.find((p) => p.index === 2)!;
    expect(edge.x + edge.width / 2).toBeLessThanOrEqual(1920);
  });

  it("fiziksel olarak çok küçük hikâye nesnesi okunabilir boya büyütülür (elde ve masada)", () => {
    const tiny = { ...assets, book: asset("book", "prop", { realHeight: 0.04, grounded: false }, 400, 260) };
    const placed = resolveLayout(
      shot([
        { asset: "ali", x: 600, depth: 0.2 },
        { asset: "book", x: 0, heldBy: 0 },
        { asset: "desk", x: 1300, depth: 0.3 },
        { asset: "book", x: 1300, on: 2 },
      ]),
      tiny,
    );
    const by = (i: number) => placed.find((p) => p.index === i)!;
    // En uzun kenar: elde ≥ 0,28 m, masada ≥ 0,18 m (derinlik ölçeğiyle).
    expect(by(1).width).toBeCloseTo(0.28 * STAGE.pxPerMeter * by(0).scale);
    expect(by(3).width).toBeCloseTo(0.18 * STAGE.pxPerMeter * by(2).scale);
    expect(by(1).fixes).toContain("okunamayacak kadar küçüktü, büyütüldü");
    // Zaten okunur olan nesneye dokunulmaz.
    expect(resolveLayout(shot([{ asset: "desk", x: 900, depth: 0.3 }]), assets)[0]!.fixes).toEqual([]);
  });

  it("kendine ya da döngüye işaret eden ilişki çökmez", () => {
    expect(() => resolveLayout(shot([{ asset: "chip", x: 1, on: 0 }, { asset: "chip", x: 1, on: 2 }, { asset: "chip", x: 1, on: 1 }]), assets)).not.toThrow();
  });
});

describe("çizgi stili", () => {
  const svg = '<svg><path d="M0" fill="#f00" stroke="#222" stroke-width="4"/><path d="M1" fill="none" stroke="#333" stroke-width="2"/><rect fill="#fff" stroke="#ffcc00"/></svg>';
  it("flat: dolgulu şekillerin koyu konturunu atar, çizgi detaylarını ve açık renkli konturu korur", () => {
    expect(applyLineStyle(svg, "flat")).toBe('<svg><path d="M0" fill="#f00"/><path d="M1" fill="none" stroke="#333" stroke-width="2"/><rect fill="#fff" stroke="#ffcc00"/></svg>');
  });
  it("ink: koyu konturlar siyah ve 1,5 kat kalın", () => {
    expect(applyLineStyle(svg, "ink")).toContain('stroke="#111014" stroke-width="6.0" stroke-linecap="round" stroke-linejoin="round"');
  });
  it("outline: koyu konturlar tek renge eşitlenir", () => {
    expect(applyLineStyle(svg, "outline").match(/stroke="#1d1a24"/g)).toHaveLength(2);
  });
});
