// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { RIG, RIG_SIDE, TimelineVisual, VectorAsset, VectorShot, type LineStyle } from "@ys/core";
import { random } from "remotion";
import { afterEach, describe, expect, it, vi } from "vitest";

// Remotion bağlamı yerine kare ve video ayarı testten verilir; geri kalan (Easing, interpolate, random) gerçek.
const clock = vi.hoisted(() => ({ frame: 0, fps: 30, width: 1920, height: 1080 }));
vi.mock("remotion", async (orig) => ({
  ...(await orig<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: clock.fps, width: clock.width, height: clock.height, durationInFrames: 300 }),
}));

const { VectorScene, layoutTexts, closeUpCamera, cameraTransform } = await import("../src/Vector.tsx");
/** Yerleşmiş katman örneği (kamera testleri). */
const PL = { index: 0, x: 0, y: 0, height: 0, width: 0, scale: 1, z: 0, sitting: false, grounded: true, fixes: [] as string[] };

afterEach(() => {
  cleanup();
  Object.assign(clock, { frame: 0, fps: 30, width: 1920, height: 1080 });
});

const DURATION = 300; // 10 sn @ 30 fps: p = kare / 300, t = kare / 30

const PARTS = Object.keys(RIG.pivots);
const asset = (id: string, kind: "character" | "prop" | "background", svg: string, width: number, height: number, meta: object = {}) =>
  VectorAsset.parse({ id, kind, svg, width, height, meta });

const ASSETS = {
  box: asset("box", "prop", '<svg viewBox="0 0 100 100"><rect id="box" width="100" height="100" fill="#ff0000"/></svg>', 100, 100),
  cup: asset("cup", "prop", '<svg viewBox="0 0 100 100"><rect id="cup" width="100" height="100" fill="#00ff00"/></svg>', 100, 100, { realHeight: 0.3 }),
  chair: asset("chair", "prop", '<svg viewBox="0 0 100 100"><rect id="chair" width="100" height="100" fill="#0000ff"/></svg>', 100, 100, { realHeight: 0.9, surface: 0.5, grounded: true }),
  hero: asset(
    "hero",
    "character",
    `<svg viewBox="0 0 400 800">${PARTS.map((p) => `<g id="${p}"><rect width="10" height="10" fill="#123456"/></g>`).join("")}</svg>`,
    400,
    800,
  ),
  room: asset("room", "background", '<svg viewBox="0 0 1920 1080"><rect id="wall" width="1920" height="1080" fill="#aaaaaa"/></svg>', 1920, 1080),
  map: asset("map", "background", '<svg viewBox="0 0 1920 1080"><path id="route-0" d="M0 0L10 10" stroke="#f00"/><path id="route-1" d="M0 0L9 9"/></svg>', 1920, 1080, {
    exact: true,
    routes: 2,
    labels: [
      { x: 300, y: 200, text: "Türkiye", kind: "country" },
      { x: 500, y: 400, text: "İstanbul", kind: "city", order: 3 },
      { x: 700, y: 500, text: "Sefer", kind: "route", order: 1 },
    ],
  }),
  flag: asset("flag", "background", '<svg viewBox="0 0 1920 1080"><rect id="red" width="1920" height="1080" fill="#e30a17"/></svg>', 1920, 1080, { exact: true }),
  broken: asset("broken", "prop", "bu bir svg değil", 100, 100),
  // Aynı karakterin ön (kırmızı) ve yan (mavi) çizimi.
  walker: asset("walker", "character", `<svg viewBox="0 0 400 800">${PARTS.map((p) => `<g id="${p}"><rect width="10" height="10" fill="#aa0000"/></g>`).join("")}</svg>`, 400, 800),
  "walker~side": asset("walker~side", "character", `<svg viewBox="0 0 400 800">${PARTS.map((p) => `<g id="${p}"><rect width="10" height="10" fill="#0000aa"/></g>`).join("")}</svg>`, 400, 800),
};

interface Opts {
  frame?: number;
  palette?: string[];
  lineStyle?: LineStyle;
  width?: number;
  height?: number;
  shotId?: string;
}

function scene(shot: object, o: Opts = {}) {
  Object.assign(clock, { frame: o.frame ?? 0, width: o.width ?? 1920, height: o.height ?? 1080 });
  const visual = TimelineVisual.parse({
    shotId: o.shotId ?? "s1",
    assetUrl: "",
    kind: "motion_graphic",
    fromFrame: 0,
    durationInFrames: DURATION,
    vector: VectorShot.parse(shot),
  });
  const props = { visual, assets: ASSETS, palette: o.palette ?? [] };
  return render(o.lineStyle ? <VectorScene {...props} lineStyle={o.lineStyle} /> : <VectorScene {...props} />).container;
}

/** Bir varlığın çizildiği katman kutusu (svg → iç div → katman div). */
function layerBox(c: HTMLElement, id: string, shotId = "s1"): HTMLElement {
  const el = c.querySelector(`[id$="-${id}"]`);
  if (!el || !el.id.startsWith(shotId)) throw new Error(`katman yok: ${id}`);
  return el.closest("svg")!.parentElement!.parentElement as HTMLElement;
}

/** translate(x, y) rotate(r) scale(sx, sy) */
function transformOf(el: HTMLElement) {
  const n = [...el.style.transform.matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((m) => Number(m[0]));
  return { x: n[0]!, y: n[1]!, rotate: n[2]!, sx: n[3]!, sy: n[4]! };
}

/** İskelet CSS'inden parça pozu. */
function pose(c: HTMLElement | string, part: string, prefix = "s1-0-") {
  const css = typeof c === "string" ? c : (c.querySelector("style")?.textContent ?? "");
  const m = new RegExp(`#${prefix}${part}\\{transform:translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\) rotate\\((-?[\\d.]+)deg\\) scale\\((-?[\\d.]+), (-?[\\d.]+)\\)`).exec(css);
  if (!m) throw new Error(`parça yok: ${part}`);
  const [, tx, ty, rotate, sx, sy] = m.map(Number);
  return { tx: tx!, ty: ty!, rotate: rotate!, sx: sx!, sy: sy! };
}

/** Havadaki tek kutu: yerleşim x=960, alt y=500, 200×200 px. */
const boxShot = (anims: object[], extra: object = {}) => ({ layers: [{ asset: "box", x: 960, y: 500, height: 200, anims, ...extra }] });
const boxAt = (anims: object[], frame: number, extra: object = {}) => {
  const c = scene(boxShot(anims, extra), { frame });
  const el = layerBox(c, "box");
  cleanup();
  return { el, tr: transformOf(el), opacity: Number(el.style.opacity) };
};

describe("vektör sahne: katman animasyonları", () => {
  it("kutuyu yerleşimdeki yerine ve boyuna çizer", () => {
    const { el, tr, opacity } = boxAt([], 0);
    expect([el.style.left, el.style.top, el.style.width, el.style.height]).toEqual(["860px", "300px", "200px", "200px"]);
    expect(tr).toEqual({ x: 0, y: 0, rotate: 0, sx: 1, sy: 1 });
    expect(opacity).toBe(1);
    expect(el.style.filter).toBe("");
  });

  it("fade_in pencereden önce görünmez, ortasında yarı, sonra tam görünür", () => {
    const a = [{ type: "fade_in", start: 0.2, end: 0.4 }];
    expect(boxAt(a, 30).opacity).toBe(0);
    expect(boxAt(a, 90).opacity).toBeCloseTo(0.5);
    expect(boxAt(a, 150).opacity).toBe(1);
  });

  it("fade_out pencereden sonra kaybolur", () => {
    const a = [{ type: "fade_out", start: 0.6, end: 0.8 }];
    expect(boxAt(a, 150).opacity).toBe(1);
    expect(boxAt(a, 210).opacity).toBeCloseTo(0.5);
    expect(boxAt(a, 270).opacity).toBe(0);
  });

  it("katman opaklığı animasyonla çarpılır", () => {
    expect(boxAt([{ type: "fade_in", start: 0.2, end: 0.4 }], 90, { opacity: 0.5 }).opacity).toBeCloseTo(0.25);
  });

  it("slide_in dört yönden kadraj dışından gelir, sonunda yerindedir", () => {
    const at0 = (from?: string) => boxAt([{ type: "slide_in", start: 0, end: 0.5, ...(from ? { from } : {}) }], 0).tr;
    expect(at0().x).toBe(-(960 + 400)); // varsayılan: soldan
    expect(at0("left").x).toBe(-(960 + 400));
    expect(at0("right").x).toBe(1920 - 960 + 400);
    expect(at0("top").y).toBe(-(500 + 400));
    expect(at0("bottom").y).toBe(1080 - 500 + 600);
    expect(boxAt([{ type: "slide_in", start: 0, end: 0.5, from: "top" }], 200).tr).toMatchObject({ x: 0, y: 0 });
  });

  it("pop pencereden önce sıfır boyda, sonunda tam boydadır", () => {
    const a = [{ type: "pop", start: 0.2, end: 0.4 }];
    expect(boxAt(a, 30).tr.sx).toBe(0);
    expect(boxAt(a, 150).tr).toMatchObject({ sx: 1, sy: 1 });
  });

  it("float, sway, pulse ve shake yalnız pencere içinde oynatır", () => {
    const seed = random("s1-0-");
    const t = 60 / 30;
    const win = { start: 0, end: 0.5 };
    expect(boxAt([{ type: "float", ...win }], 60).tr.y).toBeCloseTo(Math.sin(t * 1.6 + seed * 6) * 12);
    expect(boxAt([{ type: "sway", ...win }], 60).tr.rotate).toBeCloseTo(Math.sin(t * 1.3 + seed * 6) * 3);
    expect(boxAt([{ type: "pulse", ...win }], 60).tr.sx).toBeCloseTo(1 + Math.sin(t * 4) * 0.04);
    const shake = boxAt([{ type: "shake", ...win }], 60).tr;
    expect(shake.x).toBeCloseTo(Math.sin(t * 47) * 8);
    expect(shake.rotate).toBeCloseTo(Math.sin(t * 31) * 1.5);
    for (const type of ["float", "sway", "pulse", "shake"]) {
      expect(boxAt([{ type, ...win }], 240).tr).toEqual({ x: 0, y: 0, rotate: 0, sx: 1, sy: 1 });
    }
  });

  it("spin pencere boyunca tam tur döner", () => {
    expect(boxAt([{ type: "spin" }], 150).tr.rotate).toBeCloseTo(180);
    expect(boxAt([{ type: "spin" }], 300).tr.rotate).toBeCloseTo(360);
  });

  it("karakter jestleri (cheer, surprised) nesneyi zıplatmaz", () => {
    expect(boxAt([{ type: "cheer" }], 150).tr).toEqual({ x: 0, y: 0, rotate: 0, sx: 1, sy: 1 });
    expect(boxAt([{ type: "surprised" }], 10).tr).toEqual({ x: 0, y: 0, rotate: 0, sx: 1, sy: 1 });
  });

  it("move hedefe gider; verilmeyen eksen yerinde kalır", () => {
    expect(boxAt([{ type: "move", toX: 1460 }], 300).tr).toMatchObject({ x: 500, y: 0 });
    expect(boxAt([{ type: "move", toY: 600 }], 300).tr).toMatchObject({ x: 0, y: 100 });
    expect(boxAt([{ type: "move", toX: 1460, toY: 600 }], 150).tr).toMatchObject({ x: 250, y: 50 });
  });

  it("walk hedefe giderken adımla sekter (en çok boyunun %1,2'si), bittikten sonra sekmez", () => {
    const ys = [10, 15, 20, 25, 30].map((f) => boxAt([{ type: "walk", toX: 1460 }], f).tr);
    expect(Math.min(...ys.map((tr) => tr.y))).toBeLessThan(-0.5);
    expect(Math.min(...ys.map((tr) => tr.y))).toBeGreaterThanOrEqual(-200 * 0.012 - 1e-9);
    expect(ys.every((tr) => tr.x > 0)).toBe(true);
    expect(boxAt([{ type: "walk", toX: 1460, start: 0, end: 0.5 }], 200).tr).toMatchObject({ x: 500, y: 0 });
    // Hedefsiz yürüyüş yerinde adım atar, pencere bitince durur.
    expect(boxAt([{ type: "walk", start: 0, end: 0.5 }], 200).tr).toMatchObject({ x: 0, y: 0 });
  });

  it("katmana uygulanmayan animasyon (typewriter) yerleşimi değiştirmez", () => {
    expect(boxAt([{ type: "typewriter" }], 150).tr).toEqual({ x: 0, y: 0, rotate: 0, sx: 1, sy: 1 });
  });

  it("flip yatay ölçeği ters çevirir, rotate eklenir", () => {
    expect(boxAt([], 0, { flip: true, rotate: 12 }).tr).toMatchObject({ rotate: 12, sx: -1, sy: 1 });
  });
});

/** Ön planda ayakta duran karakter. */
const heroShot = (layer: object = {}) => ({ layers: [{ asset: "hero", x: 960, depth: 0, ...layer }] });
const heroAt = (frame: number, layer: object = {}, shotId = "s1") => {
  const c = scene(heroShot(layer), { frame, shotId });
  const css = c.querySelector("style")!.textContent!;
  const get = (part: string) => pose(css, part, `${shotId}-0-`);
  const box = layerBox(c, "body", shotId);
  return { get, box, c };
};

describe("vektör sahne: karakter iskeleti", () => {
  it("bütün iskelet parçaları kendi dönme noktasıyla dönüştürülür", () => {
    const { c } = heroAt(0);
    const css = c.querySelector("style")!.textContent!;
    // Bacaklar yalnız yürürken/otururken poz alır.
    for (const [part, [px, py]] of Object.entries(RIG.pivots).filter(([k]) => !/^(leg|shin)-/.test(k))) {
      expect(css).toContain(`#s1-0-${part}{transform:`);
      expect(css).toContain(`transform-origin:${px}px ${py}px;transform-box:view-box}`);
    }
  });

  it("jestler pencerenin ortasında hedef poza ulaşır", () => {
    const at = (type: string) => {
      const r = heroAt(150, { anims: [{ type }] });
      cleanup();
      return r.get;
    };
    let g = at("wave");
    expect(g("arm-r").rotate).toBeCloseTo(-150, 1);
    expect(g("brows").ty).toBeCloseTo(-4, 1);
    g = at("point");
    // Hedef yoksa öne-yana yatay (omuz hizasında).
    expect([g("arm-r").rotate, g("forearm-r").rotate, g("head").rotate, g("eyes").tx]).toEqual([-90, -6, -4, 5]);
    g = at("think");
    expect([g("forearm-r").rotate, g("head").rotate, g("eyes").tx]).toEqual([162, 7, 5]);
    g = at("cheer");
    expect([g("forearm-l").rotate, g("forearm-r").rotate, g("brows").ty, g("mouth").sy]).toEqual([-15, 15, -8, 1.5]);
    g = at("surprised");
    expect([g("arm-l").rotate, g("forearm-l").rotate, g("forearm-r").rotate, g("eyes").sy, g("mouth").sy]).toEqual([30, 115, -115, 1.25, 1.6]);
    g = at("shrug");
    expect([g("arm-l").rotate, g("arm-l").ty, g("forearm-l").rotate, g("forearm-r").rotate, g("head").rotate]).toEqual([16, -7, 62, -62, -6]);
    const t = 5;
    g = at("explain");
    // Tek başına: baskın el sağdaki; öbür el kalça hizasında küçük eşlik.
    expect(g("forearm-r").rotate).toBeCloseTo(-(60 + Math.sin(t * 3.4) * 12), 1);
    expect(g("forearm-l").rotate).toBeCloseTo(28 + Math.sin(t * 3 + 1) * 8, 1);
    expect(g("brows").ty).toBeCloseTo(-3 + Math.sin(t * 3) * 2, 1);
    // Yerinde yürüyüş (hedefsiz): adımlar rahat tempoda; kalkan bacağın uyluğu kısalır, baldır boyunu korur.
    g = at("walk");
    const s = Math.sin(Math.PI * ((t * 1.3) / 0.7));
    const lift = (k: number) => 1 - 0.3 * Math.max(0, k);
    expect(g("leg-l").sy).toBeCloseTo(lift(s), 2);
    expect(g("leg-r").sy).toBeCloseTo(lift(-s), 2);
    expect(g("shin-l").sy).toBeCloseTo(1 / lift(s), 2);
    // Yer değiştirmeden yürürken yön yok: bacak yana açılmaz.
    expect(g("leg-l").rotate).toBeCloseTo(0, 5);
  });

  it("yürüyüşte adımlar alınan yoldan gelir: yol iki katına çıkınca adım sayısı da iki katına çıkar", () => {
    // Bir bacağın kalkıp indiği her geçiş bir adımdır; geçişleri sayarız.
    const stepsTo = (toX: number) => {
      let steps = 0;
      let prev = 0;
      for (let f = 0; f <= 300; f += 1) {
        const { get, c: root } = heroAt(f, { anims: [{ type: "walk", toX }] });
        const css = root.querySelector("style")!.textContent!;
        const sy = (part: string) => (css.includes(`s1-0-${part}{`) ? get(part).sy : 1);
        const lifted = sy("leg-l") < 0.97 ? 1 : sy("leg-r") < 0.97 ? 2 : 0;
        if (lifted && lifted !== prev) steps++;
        if (lifted) prev = lifted;
        cleanup();
      }
      return steps;
    };
    const short = stepsTo(960 + 280 * 4); // 4 adımlık yol (0,7 m × 400 px)
    const long = stepsTo(960 - 280 * 8); // 8 adım, sola
    expect(short).toBeGreaterThanOrEqual(3);
    expect(short).toBeLessThanOrEqual(5);
    expect(long).toBeGreaterThanOrEqual(7);
    expect(long).toBeLessThanOrEqual(9);
  });

  it("yürürken gövde gidiş yönüne eğilir, durunca bacaklar iner ve poz almaz", () => {
    const right = transformOf(heroAt(20, { anims: [{ type: "walk", toX: 1500 }] }).box).rotate;
    cleanup();
    const left = transformOf(heroAt(20, { anims: [{ type: "walk", toX: 400 }] }).box).rotate;
    cleanup();
    expect(right).toBeGreaterThan(1.5);
    expect(left).toBeLessThan(-1.5);
    // Kalkan bacak gidiş yönüne açılır; aynalanan çizimde dönüş ters verilir ki ekranda yine gidiş yönüne açılsın.
    const legTilt = (flip: boolean) => {
      let tilt = 0;
      for (let f = 3; f < 45 && !tilt; f += 3) {
        const { get } = heroAt(f, { anims: [{ type: "walk", toX: 1500 }], flip });
        tilt = get("leg-l").rotate || get("leg-r").rotate;
        cleanup();
      }
      return tilt;
    };
    expect(legTilt(false)).toBeGreaterThan(0);
    expect(legTilt(true)).toBeLessThan(0);
    // Varınca (pencere sonu) adım biter: bacak parçaları CSS'te poz almaz.
    const css = heroAt(300, { anims: [{ type: "walk", toX: 1500, end: 0.6 }] }).c.querySelector("style")!.textContent!;
    expect(css).not.toContain("s1-0-leg-l{");
  });

  it("slide_in ve move ile gelen karakter de yürür (kaymaz)", () => {
    for (const anim of [{ type: "slide_in", from: "right", end: 0.6 }, { type: "move", toX: 1500 }]) {
      const css = heroAt(20, { anims: [anim] }).c.querySelector("style")!.textContent!;
      expect(css).toContain("s1-0-leg-l{");
      cleanup();
    }
  });

  it("surprised karakteri pencere başında bir kez zıplatır ve yere indirir", () => {
    const y = (frame: number) => {
      const r = transformOf(heroAt(frame, { anims: [{ type: "surprised", start: 0.5, end: 1 }] }).box).y;
      cleanup();
      return r;
    };
    // 10 sn'lik çekimde pencere 150. karede başlar; sıçrayış 0,45 sn (~13 kare) sürer.
    expect(y(149)).toBe(0);
    expect(y(157)).toBeLessThan(-10);
    expect(y(170)).toBe(0);
    expect(y(250)).toBe(0);
  });

  it("karakter cheer ile zıplar", () => {
    const t = 150 / 30;
    const tr = transformOf(heroAt(150, { anims: [{ type: "cheer" }] }).box);
    expect(tr.y).toBeCloseTo(-Math.abs(Math.sin(t * 6)) * 18, 1);
    cleanup();
    // Pencereden önce zıplamaz.
    expect(transformOf(heroAt(30, { anims: [{ type: "cheer", start: 0.5 }] }).box).y).toBe(0);
  });

  it("nod başı mevcut salınımın üstüne sallar", () => {
    const still = heroAt(150).get("head").rotate;
    cleanup();
    const nod = heroAt(150, { anims: [{ type: "nod" }] }).get("head").rotate;
    expect(nod - still).toBeCloseTo(Math.sin(5 * 6) * 7, 1);
  });

  it("talk ağzı açıp kapar; somurtan yüzde ağız ters kalır", () => {
    const want = 0.35 + Math.abs(Math.sin(5 * 13)) * 0.9;
    expect(heroAt(150, { anims: [{ type: "talk" }] }).get("mouth").sy).toBeCloseTo(want, 2);
    cleanup();
    expect(heroAt(150, { anims: [{ type: "talk" }], expression: "sad" }).get("mouth").sy).toBeCloseTo(-want, 2);
  });

  it("jest girerken ön kol üst kolu geriden izler", () => {
    // Pencere 5. sn'de (kare 150) başlar; 2 kare sonra üst kol kalkmaya başlamış, ön kol (0,08 sn gecikme) henüz değil.
    const rest = heroAt(152).get;
    cleanup();
    const g = heroAt(152, { anims: [{ type: "shrug", start: 0.5, end: 1 }] }).get;
    expect(g("arm-l").rotate).not.toBeCloseTo(rest("arm-l").rotate, 2);
    expect(g("forearm-l").rotate).toBeCloseTo(rest("forearm-l").rotate, 2);
  });

  it("pencere dışındaki jest pozu değiştirmez", () => {
    const { get } = heroAt(30, { anims: [{ type: "wave", start: 0.5, end: 1 }] });
    expect(get("arm-r").rotate).toBeGreaterThan(-30);
  });

  it("yüz ifadesi kaş, ağız ve bakışı ayarlar", () => {
    // Kare 0'da kendiliğinden jest/kırpma olabilir; ağız yalnız ifadeye bağlı.
    const mouth = (expression?: string) => {
      const r = heroAt(0, expression ? { expression } : {}).get;
      cleanup();
      return r("mouth").sy;
    };
    expect(mouth()).toBe(1);
    expect(mouth("happy")).toBe(1.35);
    expect(mouth("sad")).toBe(-0.8);
    expect(mouth("angry")).toBe(-0.45);
    expect(heroAt(0, { expression: "thinking" }).get("eyes").tx).toBe(6);
  });

  it("göz kırpar ve ara ara iki koluyla da kendiliğinden anlatır", () => {
    let blinks = 0;
    let right = 0;
    let left = 0;
    // "g1" tohumunda ilk 6 sn'de bir kırpma, bir sol ve bir sağ kol jesti var.
    for (let f = 0; f < 180; f += 2) {
      const { get } = heroAt(f, {}, "g1");
      if (get("eyes").sy === 0.1) blinks++;
      // Doğal duruşta ön kol ±13° (hafif içe); jestte el dışa açılır: sağdaki ön kol eksiye, soldaki artıya.
      if (get("forearm-r").rotate < -30) right++;
      if (get("forearm-l").rotate > 30) left++;
      cleanup();
    }
    expect(blinks).toBeGreaterThan(0);
    expect(blinks).toBeLessThan(10); // kırpma kısa sürer
    expect(right).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
  });

  it("kolu meşgul eden jest sürerken kendiliğinden el hareketi yapılmaz", () => {
    for (let f = 0; f < 300; f += 3) {
      const { get } = heroAt(f, { anims: [{ type: "nod" }, { type: "think", start: 0, end: 1 }] }, "g1");
      expect(get("forearm-l").rotate).toBeLessThan(30);
      cleanup();
    }
  });

  it("ayaktayken gövde hafifçe salınır; oturacak yer yoksa sit animasyonu yok sayılır (havada çömelmez)", () => {
    expect(transformOf(heroAt(10).box).rotate).not.toBe(0);
    cleanup();
    const css = heroAt(150, { anims: [{ type: "sit" }] }).c.querySelector("style")!.textContent!;
    expect(css).not.toContain("s1-0-leg-l{");
  });

  it("sandalyedeki karakter oturur: salınmaz, ayakları yerde kalacak kadar iner", () => {
    const c = scene({ layers: [{ asset: "chair", x: 960, depth: 0 }, { asset: "hero", x: 960, on: 0 }] }, { frame: 10 });
    const box = layerBox(c, "body");
    const tr = transformOf(box);
    const h = parseFloat(box.style.height);
    expect(tr.rotate).toBe(0);
    expect(tr.y).toBeCloseTo((630 - 520) * (1 - 0.35) * (h / RIG.height));
    expect(pose(c, "leg-r", "s1-1-").sy).toBe(0.35);
  });
});

describe("vektör sahne: dikkat (işaret ve bakış)", () => {
  /** Ortadaki karakter ve verilen diğer katmanlar; kare 150'de karakterin iskelet pozu. */
  const withOthers = (hero: object, others: object[], frame = 150) => {
    const c = scene({ layers: [{ asset: "hero", x: 960, depth: 0, ...hero }, ...others] }, { frame });
    const css = c.querySelector("style")!.textContent!;
    cleanup();
    return (part: string) => pose(css, part);
  };
  const point = { anims: [{ type: "point" }] };

  it("point yanındaki nesneyi hedefler: sağdaki için sağ kol, soldaki için sol kol omuzdan ona uzanır", () => {
    const right = withOthers(point, [{ asset: "box", x: 1500, y: 300, height: 100 }]);
    expect(right("arm-r").rotate).toBeLessThan(-90); // omuzdan yukarı-sağa
    expect(right("eyes").tx).toBe(5);
    const left = withOthers(point, [{ asset: "box", x: 400, y: 300, height: 100 }]);
    expect(left("arm-l").rotate).toBeGreaterThan(90); // yukarı-sola
    expect(left("head").rotate).toBeGreaterThan(0);
    expect(left("eyes").tx).toBe(-5);
  });

  it("aşağıdaki hedefe aşağı doğru gösterir; aynalanan karakterde de hedef ekranda aynı yandadır", () => {
    const low = withOthers(point, [{ asset: "chair", x: 1500, depth: 0 }]);
    expect(low("arm-r").rotate).toBeGreaterThan(-90);
    expect(low("arm-r").rotate).toBeLessThan(0);
    // Aynalanınca ekranın sağı iskeletin solu olur: sol kol kalkar (çizim aynalandığı için ekranda yine sağa).
    const flipped = withOthers({ ...point, flip: true }, [{ asset: "box", x: 1500, y: 300, height: 100 }]);
    expect(flipped("arm-l").rotate).toBeGreaterThan(90);
  });

  it("target verilmişse en yakını değil o katmanı gösterir; gövdesinin önündeki nesne hedef sayılmaz", () => {
    const others = [
      { asset: "box", x: 1300, y: 300, height: 100 },
      { asset: "cup", x: 300, y: 300, height: 100 },
    ];
    expect(withOthers({ anims: [{ type: "point", target: 2 }] }, others)("arm-l").rotate).toBeGreaterThan(90);
    expect(withOthers(point, others)("arm-r").rotate).toBeLessThan(-90);
    // Tam önündeki nesne atlanır; yazı varsa ona gösterir.
    const c = scene({ layers: [{ asset: "hero", x: 960, depth: 0, ...point }, { asset: "box", x: 980, y: 900, height: 100 }], texts: [{ text: "1923", x: 400, y: 200 }] }, { frame: 150 });
    expect(pose(c, "arm-l").rotate).toBeGreaterThan(90);
  });

  it("explain'de baskın el konuşulan kişiye doğru açılır", () => {
    const t = 5;
    const left = withOthers({ anims: [{ type: "explain" }] }, [{ asset: "walker", x: 300, depth: 0 }]);
    expect(left("forearm-l").rotate).toBeCloseTo(60 + Math.sin(t * 3.4) * 12, 1);
    expect(left("forearm-r").rotate).toBeCloseTo(-(28 + Math.sin(t * 3 + 1) * 8), 1);
    const right = withOthers({ anims: [{ type: "explain" }] }, [{ asset: "walker", x: 1600, depth: 0 }]);
    expect(right("forearm-r").rotate).toBeCloseTo(-(60 + Math.sin(t * 3.4) * 12), 1);
  });

  it("aynı karakterin kopyası çizilmez", () => {
    const c = scene({ layers: [{ asset: "hero", x: 600, depth: 0.2 }, { asset: "hero", x: 1400, depth: 0.2 }, { asset: "box", x: 0 }] });
    expect(c.querySelectorAll('[id$="-head"]').length).toBe(1);
    expect(c.querySelector('[id$="-box"]')).not.toBeNull();
  });

  it("sahnede başka karakter varsa gözler çoğunlukla ona döner", () => {
    let toward = 0;
    let away = 0;
    for (let f = 0; f < 300; f += 15) {
      const c = scene({ layers: [{ asset: "hero", x: 600, depth: 0.2 }, { asset: "walker", x: 1400, depth: 0.2 }] }, { frame: f });
      const tx = pose(c, "eyes").tx;
      // Göz kırpma ya da kendiliğinden jest bakışı değiştirmez; sağdaki karaktere bakan göz sağa (artı) kayar.
      if (tx > 2) toward++;
      if (tx < -2) away++;
      cleanup();
    }
    expect(toward).toBeGreaterThan(away);
    expect(toward).toBeGreaterThan(8);
  });
});

describe("vektör sahne: yan görünüş", () => {
  /** Ön görünüşü "hero", yan görünüşü "walker~side" olan karakter (yan çizim mavi). */
  const walkerAt = (frame: number, layer: object, extra: object[] = []) => {
    const c = scene({ layers: [{ asset: "walker", x: 600, depth: 0, ...layer }, ...extra] }, { frame });
    const box = layerBox(c, "body");
    return { c, box, side: box.innerHTML.includes("#0000aa"), tr: transformOf(box), css: c.querySelector("style")!.textContent! };
  };

  it("yürürken yan çizime döner: iskelet yan dönme noktalarıyla pozlanır, bacaklar öne-arkaya salınır", () => {
    const { side, tr, css } = walkerAt(25, { anims: [{ type: "walk", toX: 1500 }] });
    expect(side).toBe(true);
    expect(tr.sx).toBeGreaterThan(0); // sağa giderken çizim olduğu gibi (sağa bakar)
    expect(css).toContain(`#s1-0-head{transform:`);
    expect(css).toContain(`transform-origin:${RIG_SIDE.pivots.head[0]}px ${RIG_SIDE.pivots.head[1]}px`);
    const legs = [pose(css, "leg-l").rotate, pose(css, "leg-r").rotate];
    expect(legs[0]).toBeCloseTo(-legs[1]!, 5);
    expect(pose(css, "eyes").tx).toBe(0);
    cleanup();
  });

  it("yerinde yürüyüşte (hedefsiz) yön yoktur: yan çizim katmanın aynalamasını kullanır", () => {
    expect(walkerAt(60, { anims: [{ type: "walk", start: 0, end: 1 }] }).side).toBe(true);
    cleanup();
    expect(walkerAt(60, { anims: [{ type: "walk", start: 0, end: 1 }], flip: true }).tr.sx).toBeLessThan(0);
    cleanup();
  });

  it("sola yürürken çizim aynalanır; durunca ön çizime döner", () => {
    expect(walkerAt(25, { anims: [{ type: "walk", toX: 0 }] }).tr.sx).toBeLessThan(0);
    cleanup();
    const rest = walkerAt(290, { anims: [{ type: "walk", toX: 1000 }] });
    expect(rest.side).toBe(false);
    expect(rest.tr.sx).toBe(1);
    cleanup();
  });

  it("önden yana geçerken çizim yatayda daralır (dönüş); yan görünüş yoksa daralma olmaz", () => {
    // Yürüyüşün ilk kareleri: genlik yarının altında, hâlâ ön çizim ama daralmış.
    let turning: ReturnType<typeof walkerAt> | undefined;
    for (let f = 1; f < 20 && !turning; f++) {
      const r = walkerAt(f, { anims: [{ type: "walk", toX: 1500 }] });
      if (!r.side && r.tr.sx < 0.99) turning = r;
      cleanup();
    }
    expect(turning!.tr.sx).toBeGreaterThanOrEqual(0.6);
    const plain = transformOf(heroAt(25, { anims: [{ type: "walk", toX: 1500 }] }).box);
    expect(plain.sx).toBe(1);
  });

  it("yan görünüşte kol jesti uygulanmaz (kollar yürür), yüz jesti sürer", () => {
    const { css } = walkerAt(25, { anims: [{ type: "walk", toX: 1500 }, { type: "wave" }, { type: "surprised" }] });
    expect(Math.abs(pose(css, "arm-r").rotate)).toBeLessThan(25);
    expect(pose(css, "mouth").sy).toBeCloseTo(1.6, 1);
    cleanup();
  });

  it("yan görünüşte yürürken tutulan nesne yine elde kalır", () => {
    const c = scene({ layers: [{ asset: "walker", x: 600, depth: 0, anims: [{ type: "walk", toX: 1500 }] }, { asset: "cup", x: 0, heldBy: 0 }] }, { frame: 25 });
    const body = layerBox(c, "body");
    const cup = layerBox(c, "cup");
    const bodyX = parseFloat(body.style.left) + parseFloat(body.style.width) / 2 + transformOf(body).x;
    const cupX = parseFloat(cup.style.left) + parseFloat(cup.style.width) / 2;
    expect(Math.abs(cupX - bodyX)).toBeLessThan(parseFloat(body.style.width) / 2);
  });

  it("oturan karakter yan görünüşe dönmez", () => {
    const c = scene({ layers: [{ asset: "chair", x: 600, depth: 0 }, { asset: "walker", x: 600, on: 0, anims: [{ type: "walk", toX: 1500 }] }] }, { frame: 25 });
    expect(layerBox(c, "body").innerHTML).not.toContain("#0000aa");
  });
});

describe("vektör sahne: elde tutulan nesne", () => {
  const held = (holder: object, cupAnims: object[] = [], frame = 150) => {
    const c = scene({ layers: [{ asset: "hero", x: 960, depth: 0, ...holder }, { asset: "cup", x: 0, heldBy: 0, anims: cupAnims }] }, { frame });
    const cup = layerBox(c, "cup");
    const r = { left: parseFloat(cup.style.left), top: parseFloat(cup.style.top), width: parseFloat(cup.style.width) };
    cleanup();
    return r;
  };

  it("nesne tutan karakter sol eliyle düşünür: nesne yüze kalkmaz", () => {
    const c = scene({ layers: [{ asset: "hero", x: 960, depth: 0, anims: [{ type: "think" }] }, { asset: "cup", x: 0, heldBy: 0 }] }, { frame: 150 });
    expect(pose(c, "forearm-l").rotate).toBeCloseTo(-162, 0);
    expect(Math.abs(pose(c, "forearm-r").rotate)).toBeLessThan(40);
    cleanup();
    expect(held({ anims: [{ type: "think" }] }).top).toBeCloseTo(held({}).top, -1);
  });

  it("nesne tutanın elini izler: el kalkınca nesne de yükselir", () => {
    const down = held({});
    const up = held({ anims: [{ type: "wave" }] });
    expect(up.top).toBeLessThan(down.top - 100);
  });

  it("aynalanan karakterde el, karakterin ekseninde simetrik yerdedir", () => {
    const a = held({ anims: [{ type: "point" }] });
    const b = held({ anims: [{ type: "point" }], flip: true });
    expect(a.left + a.width / 2 + (b.left + b.width / 2)).toBeCloseTo(2 * 960, 0);
    expect(a.top).toBeCloseTo(b.top);
  });

  it("nesnenin kendi yer değiştiren animasyonları yok sayılır (hareketi tutandan gelir)", () => {
    expect(held({}, [{ type: "move", toX: 100, toY: 100 }])).toEqual(held({}));
    for (const type of ["float", "sway", "shake", "slide_in", "walk"]) expect(held({}, [{ type }])).toEqual(held({}));
  });

  it("tutan yürürken nesne elde kalır", () => {
    for (const frame of [60, 150, 240]) {
      const c = scene({ layers: [{ asset: "hero", x: 600, depth: 0, anims: [{ type: "walk", toX: 1300 }] }, { asset: "cup", x: 0, heldBy: 0 }] }, { frame });
      const hero = layerBox(c, "body");
      const cup = layerBox(c, "cup");
      const heroX = parseFloat(hero.style.left) + parseFloat(hero.style.width) / 2 + transformOf(hero).x;
      const cupX = parseFloat(cup.style.left) + parseFloat(cup.style.width) / 2;
      // Sağ el gövde ekseninden en çok yarım gövde genişliği uzaktadır.
      expect(Math.abs(cupX - heroX)).toBeLessThan(parseFloat(hero.style.width) / 2);
      cleanup();
    }
  });

  it("oturan karakterin eli de aşağı iner", () => {
    const c = scene(
      { layers: [{ asset: "chair", x: 960, depth: 0 }, { asset: "hero", x: 960, on: 0 }, { asset: "cup", x: 0, heldBy: 1 }] },
      { frame: 150 },
    );
    const hero = layerBox(c, "body");
    const cup = layerBox(c, "cup");
    const heroTop = parseFloat(hero.style.top) + transformOf(hero).y;
    const heroH = parseFloat(hero.style.height);
    const cupMid = parseFloat(cup.style.top) + parseFloat(cup.style.height) / 2;
    // Elin olduğu yer gövdenin orta bölümünde (ayak hizasının üstünde).
    expect(cupMid).toBeGreaterThan(heroTop + heroH * 0.3);
    expect(cupMid).toBeLessThan(heroTop + heroH * 0.9);
  });

  it("karakter olmayan tutan yok sayılır, nesne kendi yerinde kalır", () => {
    const c = scene({ layers: [{ asset: "box", x: 400, y: 500, height: 200 }, { asset: "cup", x: 1200, y: 400, height: 100, heldBy: 0 }] });
    expect(layerBox(c, "cup").style.left).toBe("1150px");
  });
});

describe("vektör sahne: yerçekimi", () => {
  /** Yerde duran sandalye (derinlikle yerleşir). */
  const chairAt = (anims: object[], frame: number) => {
    const c = scene({ layers: [{ asset: "chair", x: 960, depth: 0.3, anims }] }, { frame });
    const tr = transformOf(layerBox(c, "chair"));
    cleanup();
    return tr;
  };

  it("yerdeki nesne dikeyde hareket etmez: toY yok sayılır, yalnız yatay hedef kalır", () => {
    // Bölüm verisi: at ve araba "toY: 0" ile ekranın tepesine uçuyordu.
    expect(chairAt([{ type: "move", toY: 0 }], 300)).toMatchObject({ x: 0, y: 0 });
    expect(chairAt([{ type: "move", toX: 1460, toY: 0 }], 300)).toMatchObject({ x: 500, y: 0 });
  });

  it("yerdeki nesne süzülmez; yukarıdan/aşağıdan kayarak gelen yerinde belirir", () => {
    expect(chairAt([{ type: "float" }], 60)).toMatchObject({ x: 0, y: 0 });
    const slid = (from: string) => {
      const c = scene({ layers: [{ asset: "chair", x: 960, depth: 0.3, anims: [{ type: "slide_in", from, end: 0.5 }] }] }, { frame: 75 });
      const el = layerBox(c, "chair");
      cleanup();
      return { tr: transformOf(el), opacity: Number(el.style.opacity) };
    };
    for (const from of ["top", "bottom"]) {
      const r = slid(from);
      expect(r.tr).toMatchObject({ x: 0, y: 0 });
      expect(r.opacity).toBeCloseTo(0.5);
    }
    // Yandan gelen yine kayar.
    expect(slid("left").tr.x).toBeLessThan(0);
  });

  it("havadaki nesne süzülür ve dikeyde hareket edebilir", () => {
    expect(boxAt([{ type: "float" }], 60).tr.y).not.toBe(0);
    expect(boxAt([{ type: "move", toY: 600 }], 300).tr.y).toBe(100);
  });
});

describe("vektör sahne: yazılar", () => {
  const textAt = (text: object, frame = 150, palette: string[] = []) => {
    const c = scene({ texts: [{ x: 960, y: 300, ...text }] }, { frame, palette });
    const divs = [...c.querySelectorAll("div")].filter((d) => d.style.width === "1500px");
    const el = divs[0] as HTMLElement;
    const r = { el, shown: el.querySelector("span")?.textContent ?? null, color: el.style.color };
    cleanup();
    return r;
  };

  it("başlık beyaz, açık renk korunur, koyu renk beyaza döner", () => {
    expect(textAt({ text: "Başlık", style: "title" }).color).toBe("white");
    expect(textAt({ text: "Renkli", color: "#ffd84d" }).color).toBe("#ffd84d");
    expect(textAt({ text: "Koyu", color: "#000000" }).color).toBe("white");
  });

  it("sayılar paletin vurgu rengiyle, vurgu koyuysa sarıyla yazılır", () => {
    expect(textAt({ text: "42", style: "number" }, 150, ["#000", "#111", "#aaffaa"]).color).toBe("#aaffaa");
    expect(textAt({ text: "42", style: "number" }, 150, ["#000", "#111", "#202020"]).color).toBe("#ffd84d");
    expect(textAt({ text: "42", style: "number" }).color).toBe("#ffd84d");
  });

  it("typewriter metni harf harf yazar; boşken plaka çizilmez", () => {
    expect(textAt({ text: "abcdefgh", anims: [{ type: "typewriter" }] }, 0).shown).toBeNull();
    expect(textAt({ text: "abcdefgh", anims: [{ type: "typewriter" }] }, 150).shown).toBe("abcd");
    expect(textAt({ text: "abcdefgh", anims: [{ type: "typewriter" }] }, 300).shown).toBe("abcdefgh");
  });

  it("count_up sayıyı biçimini koruyarak sıfırdan sayar", () => {
    const up = (text: string, frame = 150) => textAt({ text, anims: [{ type: "count_up" }] }, frame).shown;
    // Kare 150: ease-out(0,5) = 0,875
    expect(up("60.000 $")).toBe("52.500 $");
    expect(up("1971")).toBe("1725");
    expect(up("3.14")).toBe("2.75");
    expect(up("%1,5 büyüme")).toBe("%1,3 büyüme");
    expect(up("1.000.000.")).toBe("875.000.");
    expect(up("sayı yok")).toBe("sayı yok");
    expect(up("60.000 $", 300)).toBe("60.000 $");
  });

  it("yazı yatayda kadraj içine alınır", () => {
    expect(textAt({ text: "kenar", x: 100 }).el.style.left).toBe("40px");
    expect(textAt({ text: "kenar", x: 1900 }).el.style.left).toBe(`${1920 - 1500 - 40}px`);
  });

  it("yazı animasyonu uygulanır (fade_in)", () => {
    expect(textAt({ text: "x", anims: [{ type: "fade_in", start: 0.6, end: 1 }] }).el.style.opacity).toBe("0");
  });

  it("alt sınırı aşan yazılar birlikte yukarı kaydırılır", () => {
    const t = (y: number) => VectorShot.shape.texts.parse([{ text: "Uzun başlık", x: 960, y, style: "title" }])[0]!;
    const [a, b] = layoutTexts([t(800), t(800)]);
    expect(b!.y + 104 * 1.12 / 2).toBeCloseTo(800);
    expect(b!.y - a!.y).toBeCloseTo(104 * 1.12 + 24);
  });
});

describe("vektör sahne: arka plan, harita ve kadraj", () => {
  const bgDiv = (c: HTMLElement, id: string) => c.querySelector(`[id="s1-bg-${id}"]`)!.closest("svg")!.parentElement as HTMLElement;

  it("çizilmiş arka plan soluklaştırılır, kök svg kutuyu dolduracak şekilde ayarlanır", () => {
    const c = scene({ background: "room" });
    const div = bgDiv(c, "wall");
    expect(div.style.filter).toBe("saturate(0.78) contrast(0.86) brightness(0.94)");
    const svg = div.querySelector("svg")!;
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
    expect(svg.getAttribute("width")).toBe("100%");
  });

  it("gerçek veriden üretilen bayrak olduğu gibi gösterilir, etiket/rota yoksa üst katman boştur", () => {
    const c = scene({ background: "flag" }, { lineStyle: "flat" });
    expect(bgDiv(c, "red").style.filter).toBe("");
    expect(c.querySelector("style")).toBeNull();
    expect(bgDiv(c, "red").innerHTML).toContain('fill="#e30a17"');
  });

  it("harita rotaları sırayla çizilir, etiketler sırayla belirir", () => {
    const at = (frame: number) => {
      const c = scene({ background: "map" }, { frame });
      const css = c.querySelector("style")!.textContent!;
      const offset = (i: number) => Number(new RegExp(`#s1-bg-route-${i}\\{stroke-dashoffset:([\\d.]+)\\}`).exec(css)![1]);
      const labels = [...c.querySelectorAll("div")].filter((d) => d.style.whiteSpace === "nowrap").map((d) => d.textContent);
      cleanup();
      return { r0: offset(0), r1: offset(1), labels };
    };
    const start = at(0);
    expect(start).toEqual({ r0: 1, r1: 1, labels: [] });
    const mid = at(120); // p = 0,4
    expect(mid.r0).toBeLessThan(mid.r1);
    expect(mid.r1).toBeLessThan(1);
    expect(mid.labels).toEqual(["Türkiye", "İstanbul"]);
    const end = at(300);
    expect(end).toEqual({ r0: 0, r1: 0, labels: ["Türkiye", "İstanbul", "Sefer"] });
  });

  it("etiket türüne göre biçimlenir", () => {
    const c = scene({ background: "map" }, { frame: 300 });
    const byText = (t: string) => [...c.querySelectorAll("div")].find((d) => d.textContent === t && d.style.whiteSpace === "nowrap") as HTMLElement;
    expect(byText("Türkiye").style.textTransform).toBe("uppercase");
    expect(byText("İstanbul").style.color).toBe("#1f2430");
    expect(byText("Sefer").style.color).toBe("#fff");
    expect(byText("Sefer").style.left).toBe("700px");
  });

  it("bozuk varlık atlanır, sahnenin geri kalanı çizilir", () => {
    const c = scene({ layers: [{ asset: "broken", x: 300, y: 500, height: 100 }, { asset: "box", x: 960, y: 500, height: 200 }] });
    expect(layerBox(c, "box")).toBeTruthy();
    expect(c.innerHTML).not.toContain("bu bir svg değil");
  });

  it("arka plan yoksa paletten degrade; palet yoksa varsayılan renkler", () => {
    const root = (palette: string[]) => {
      const el = scene({}, { palette }).firstElementChild as HTMLElement;
      cleanup();
      return el.style.background;
    };
    expect(root([])).toContain("#1d2433");
    expect(root(["#101010", "#202020"])).toContain("#101010");
  });

  it("sketch çizgi stili titreşim filtresini ekler ve katmanlara uygular", () => {
    const c = scene(boxShot([]), { lineStyle: "sketch" });
    expect(c.querySelector("filter#ys-sketch feTurbulence, filter#ys-sketch feturbulence")).toBeTruthy();
    expect(layerBox(c, "box").style.filter).toBe("url(#ys-sketch)");
  });

  it("kamera odak noktasına doğru yakınlaşır; ışık havası uygulanır", () => {
    const c = scene({ camera: { zoomFrom: 1, zoomTo: 1.2, focusX: 300, focusY: 200 }, mood: "night" }, { frame: 300 });
    // Odak noktası ekranda yerinde kalır: kayma = odak × (1 − zoom).
    const cam = [...c.querySelectorAll("div")].find((d) => d.style.transform.includes("scale(1.2)")) as HTMLElement;
    expect(cam.style.transform).toBe("translate(-60px, -40px) scale(1.2) translateX(0%)");
    expect(cam.style.transformOrigin).toMatch(/^0(px)? 0(px)?$/);
    expect([...c.querySelectorAll("div")].some((d) => d.style.mixBlendMode === "multiply")).toBe(true);
  });

  it("odak verilmezse kadraj merkezine yakınlaşır", () => {
    const c = scene({});
    expect([...c.querySelectorAll("div")].some((d) => d.style.transform.startsWith("translate(-0px, -0px) scale(1)") || d.style.transform.startsWith("translate(0px, 0px) scale(1)"))).toBe(true);
  });

  it("yakın çekimde özne çok küçükse zoom büyür ve özne ortalanır; büyük özne ve harita çekimi olduğu gibi", () => {
    const tiny = { ...PL, width: 40, height: 30, x: 1500, y: 900, grounded: true };
    const wall = { ...PL, index: 1, width: 40, height: 40, x: 960, y: 560, grounded: false };
    const cam = { zoomFrom: 1.6, zoomTo: 1.9, panX: 0, focusX: 960, focusY: 540 };
    // Duvardaki öğe odağa daha yakın ama yerdeki nesne özne seçilir.
    const out = closeUpCamera(cam, [tiny, wall], false);
    expect(out.centre).toBe(true);
    expect(out.cam).toMatchObject({ focusX: 1500, focusY: 885 });
    expect(out.cam.zoomTo).toBeCloseTo(3.2);
    expect(out.cam.zoomFrom).toBeCloseTo((1.6 * 3.2) / 1.9);
    expect(cameraTransform(out.cam, 1, true)).toBe("translate(-3840px, -2292px) scale(3.2) translateX(0%)");
    // Köşedeki özne ortalanamaz: kamera tuvalin dışını göstermez, kenara dayanır.
    expect(cameraTransform({ ...out.cam, focusX: 1900, focusY: 1070 }, 1, true)).toBe("translate(-4224px, -2376px) scale(3.2) translateX(0%)");
    // Odak verilmezse merkeze en yakın yerdeki nesne seçilir.
    const near = { ...tiny, index: 2, x: 1000, y: 600 };
    expect(closeUpCamera({ zoomFrom: 1.6, zoomTo: 1.9, panX: 0 }, [tiny, near], false).cam).toMatchObject({ focusX: 1000, focusY: 585 });
    expect(closeUpCamera({ zoomFrom: 1.6, zoomTo: 1.9, panX: 0 }, [near, tiny], false).cam).toMatchObject({ focusX: 1000 });
    // Yalnız havada öğe varsa o özne olur; zoom tavandaysa yalnız odak düzelir.
    expect(closeUpCamera({ ...cam, zoomFrom: 3.2, zoomTo: 3.2 }, [wall], false).cam).toMatchObject({ zoomTo: 3.2, focusX: 960, focusY: 540 });
    for (const keep of [
      closeUpCamera(cam, [{ ...tiny, height: 400 }], false),
      closeUpCamera(cam, [tiny], true),
      closeUpCamera({ ...cam, zoomFrom: 1, zoomTo: 1.2 }, [tiny], false),
      closeUpCamera(cam, [], false),
    ])
      expect(keep).toEqual({ cam: expect.objectContaining({ zoomTo: keep.cam.zoomTo }), centre: false });
    // Odaksız kamera merkezden yaklaşır; tuvalden küçük zoom'da da ortada kalır.
    expect(cameraTransform({ zoomFrom: 0.5, zoomTo: 0.5, panX: 0 }, 0, true)).toBe("translate(480px, 270px) scale(0.5) translateX(0%)");
  });

  it("dikey kadrajda sahne 1,3 kat yakın çekimle ortalanır, boşluğu bulanık arka plan doldurur", () => {
    const c = scene({ background: "room" }, { width: 1080, height: 1920 });
    const fit = (1080 / 1920) * 1.3;
    const box = [...c.querySelectorAll("div")].find((d) => d.style.transformOrigin === "0 0" || d.style.transformOrigin === "0px 0px") as HTMLElement;
    expect(box.style.transform).toBe(`scale(${fit})`);
    expect(parseFloat(box.style.left)).toBeCloseTo((1080 - 1920 * fit) / 2);
    expect(parseFloat(box.style.top)).toBeCloseTo((1920 - 1080 * fit) / 2);
    expect(c.querySelector('[id="s1-bd-wall"]')!.closest("svg")!.parentElement!.style.filter).toContain("blur(28px)");
  });

  it("kare kadrajda büyütme yapılmaz; arka plan yoksa bulanık kopya da yoktur", () => {
    const c = scene({}, { width: 1080, height: 1080 });
    const box = [...c.querySelectorAll("div")].find((d) => d.style.transformOrigin === "0 0" || d.style.transformOrigin === "0px 0px") as HTMLElement;
    expect(box.style.transform).toBe(`scale(${1080 / 1920})`);
    expect(c.querySelector('[id^="s1-bd-"]')).toBeNull();
  });
});
