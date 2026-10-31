// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { Timeline, VectorAsset, type Ambience as AmbienceKind } from "@ys/core";
import type { ReactNode } from "react";
import { random } from "remotion";
import { afterEach, describe, expect, it, vi } from "vitest";

// Remotion bağlamı yerine kare ve video ayarı testten verilir; medya öğeleri ve Sequence düz elemana çevrilir
// (gerçek tarayıcı/ffmpeg yok). Easing, interpolate, random gerçek.
const clock = vi.hoisted(() => ({ frame: 0, fps: 30, width: 1920, height: 1080 }));
const registered = vi.hoisted(() => ({ root: undefined as unknown, composition: undefined as Record<string, unknown> | undefined }));
vi.mock("remotion", async (orig) => ({
  ...(await orig<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: clock.fps, width: clock.width, height: clock.height, durationInFrames: 300 }),
  staticFile: (p: string) => `/public/${p}`,
  Sequence: (p: { from: number; durationInFrames: number; name: string; children: ReactNode }) => (
    <section data-from={p.from} data-duration={p.durationInFrames} data-name={p.name}>
      {p.children}
    </section>
  ),
  Img: (p: { src: string; style: object }) => <img data-kind="img" src={p.src} style={p.style} />,
  OffthreadVideo: (p: { src: string; muted: boolean; playbackRate: number }) => (
    <video data-kind="video" src={p.src} muted={p.muted} data-rate={p.playbackRate} />
  ),
  Audio: (p: { src: string; volume: number }) => <audio data-kind="audio" src={p.src} data-volume={p.volume} />,
  Composition: (p: Record<string, unknown>) => {
    registered.composition = p;
    return null;
  },
  registerRoot: (root: unknown) => {
    registered.root = root;
  },
}));

const { Episode } = await import("../src/index.ts");
const { Ambience } = await import("../src/Ambience.tsx");

afterEach(() => {
  cleanup();
  clock.frame = 0;
});

const draw = (node: ReactNode, frame = 0) => {
  clock.frame = frame;
  return render(<>{node}</>).container;
};

describe("atmosfer katmanları", () => {
  const amb = (kind: AmbienceKind, frame = 0, seed = "a1") => draw(<Ambience kind={kind} seed={seed} />, frame);

  it("none hiçbir şey çizmez", () => {
    expect(amb("none").innerHTML).toBe("");
  });

  it("yağmur 140 eğik damla çizer, damlalar zamanla düşer", () => {
    const c = amb("rain", 0);
    const lines = [...c.querySelectorAll("line")];
    expect(lines).toHaveLength(140);
    for (const l of lines.slice(0, 10)) {
      const dx = Number(l.getAttribute("x2")) - Number(l.getAttribute("x1"));
      const dy = Number(l.getAttribute("y2")) - Number(l.getAttribute("y1"));
      expect(dx / dy).toBeCloseTo(0.18); // rüzgâr eğimi
      expect(dy).toBeGreaterThanOrEqual(28);
      expect(dy).toBeLessThanOrEqual(74);
    }
    const y0 = Number(lines[0]!.getAttribute("y1"));
    cleanup();
    const y1 = Number(amb("rain", 3).querySelector("line")!.getAttribute("y1"));
    expect(y1).not.toBe(y0);
  });

  it("aynı tohum aynı kareyi verir (paralel render sekmeleri tutarlı)", () => {
    const a = amb("snow", 42, "x").innerHTML;
    cleanup();
    expect(amb("snow", 42, "x").innerHTML).toBe(a);
    cleanup();
    expect(amb("snow", 42, "y").innerHTML).not.toBe(a);
  });

  it("kar 110 beyaz tane çizer", () => {
    const circles = [...amb("snow").querySelectorAll("circle")];
    expect(circles).toHaveLength(110);
    for (const c of circles) {
      expect(c.getAttribute("fill")).toBe("white");
      expect(Number(c.getAttribute("r"))).toBeGreaterThanOrEqual(1.5);
      expect(Number(c.getAttribute("r"))).toBeLessThanOrEqual(5.5);
    }
  });

  it("sis iki katman zıt yönlerde kayar", () => {
    const c = amb("fog", 60, "f");
    const layers = [...c.querySelectorAll("div")].filter((d) => d.style.width === "200%") as HTMLElement[];
    expect(layers).toHaveLength(2);
    const t = 2;
    const offset = random("f-fog") * 100;
    expect(parseFloat(layers[0]!.style.transform.slice("translateX(".length))).toBeCloseTo(Math.sin((t + offset) * 0.07) * 12);
    expect(parseFloat(layers[1]!.style.transform.slice("translateX(".length))).toBeCloseTo(Math.sin((t + offset) * -0.05) * 12);
  });

  it("toz sıcak renkte 110 zerre, kıvılcım turuncu 90 zerre ve tepede söner", () => {
    const dust = [...amb("dust").querySelectorAll("circle")];
    expect(dust).toHaveLength(110);
    expect(dust[0]!.getAttribute("fill")).toBe("rgb(255,226,175)");
    expect(dust[0]!.getAttribute("filter")).toBe("url(#glow-a1)");
    cleanup();
    const c = amb("embers", 30);
    expect(c.querySelector("feGaussianBlur, fegaussianblur")!.getAttribute("stdDeviation") ?? c.querySelector("fegaussianblur")!.getAttribute("stddeviation")).toBe("2");
    const embers = [...c.querySelectorAll("circle")];
    expect(embers).toHaveLength(90);
    expect(embers[0]!.getAttribute("fill")).toBe("rgb(255,160,70)");
    // Tepenin yakınındaki kıvılcımın opaklığı yüksekliğiyle orantılı söner.
    for (const e of embers) {
      const y = Number(e.getAttribute("cy"));
      expect(Number(e.getAttribute("opacity"))).toBeLessThanOrEqual(Math.min(1, y / (1080 * 0.6)) + 1e-9);
    }
  });

  it("titreme ışığı ve gölgeyi zıt yönde oynatır", () => {
    const c = amb("flicker", 15, "m");
    const [light, shade] = [...c.querySelectorAll("div")].filter((d) => d.style.background.includes("radial-gradient")) as HTMLElement[];
    const t = 0.5;
    const p = random("m-flicker") * 10;
    const n = Math.sin((t + p) * 7.3) * 0.5 + Math.sin((t + p) * 13.1) * 0.3 + Math.sin((t + p) * 2.1) * 0.2;
    expect(Number(light!.style.opacity)).toBeCloseTo(0.6 + n * 0.4);
    expect(Number(shade!.style.opacity)).toBeCloseTo(0.55 - n * 0.3);
  });

  it("ışık huzmeleri tohuma göre soldan ya da sağdan, altı huzmeyle gelir", () => {
    const seeds = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const left = seeds.find((s) => random(`${s}-rays`) < 0.5)!;
    const right = seeds.find((s) => random(`${s}-rays`) >= 0.5)!;
    const bg = (seed: string) => {
      const el = amb("rays", 0, seed).firstElementChild as HTMLElement;
      const style = el.getAttribute("style")!;
      cleanup();
      return style;
    };
    const l = bg(left);
    expect(l).toContain("conic-gradient(at -10% -15%");
    expect(l).toContain("circle at 0% 0%");
    expect(l.match(/rgba\(255,238,195/g)).toHaveLength(6);
    const r = bg(right);
    expect(r).toContain("conic-gradient(at 110% -15%");
    expect(r).toContain("circle at 100% 0%");
  });
});

const hero = VectorAsset.parse({
  id: "hero",
  kind: "prop",
  svg: '<svg viewBox="0 0 100 100"><rect id="box" width="100" height="100" fill="#ff0000"/></svg>',
  width: 100,
  height: 100,
});

const timeline = (over: object = {}) =>
  Timeline.parse({
    episodeId: "e1",
    lang: "tr",
    durationInFrames: 300,
    visuals: [],
    audio: [],
    ...over,
  });

const shot = (shotId: string, kind: string, extra: object = {}) => ({
  shotId,
  assetUrl: `${shotId}.png`,
  kind,
  fromFrame: 0,
  durationInFrames: 100,
  ...extra,
});

describe("bölüm kompozisyonu", () => {
  const imgTransform = (c: HTMLElement) => (c.querySelector('[data-kind="img"]') as HTMLElement).style.transform;

  it("çekimler sırayla dizilir, sonuncu hariç hepsi geçiş kadar uzar", () => {
    const c = draw(
      <Episode
        timeline={timeline({
          visuals: [shot("a", "still_motion", { fromFrame: 0 }), shot("b", "ai_clip", { fromFrame: 100 }), shot("c", "still_motion", { fromFrame: 200 })],
        })}
      />,
    );
    const seq = [...c.querySelectorAll("section")].map((s) => [s.dataset.name, s.dataset.from, s.dataset.duration]);
    expect(seq).toEqual([
      ["a", "0", "108"],
      ["b", "100", "108"],
      ["c", "200", "100"],
    ]);
    expect((c.firstElementChild as HTMLElement).style.backgroundColor).toBe("black");
  });

  it("çekim geçişte yumuşakça belirir", () => {
    const fade = (frame: number) => {
      const c = draw(<Episode timeline={timeline({ visuals: [shot("a", "still_motion")] })} />, frame);
      const el = c.querySelector("section")!.firstElementChild as HTMLElement;
      const o = el.style.opacity;
      cleanup();
      return Number(o);
    };
    expect(fade(0)).toBe(0);
    expect(fade(4)).toBeCloseTo(0.5);
    expect(fade(20)).toBe(1);
  });

  it("durağan kare varsayılan olarak yavaşça yakınlaşır (ken burns)", () => {
    const at = (frame: number, motion?: object) => {
      const c = draw(<Episode timeline={timeline({ visuals: [shot("a", "still_motion", motion ? { motion } : {})] })} />, frame);
      const r = { transform: imgTransform(c), src: c.querySelector("img")!.getAttribute("src") };
      cleanup();
      return r;
    };
    expect(at(0)).toEqual({ transform: "scale(1) translateX(0%)", src: "/public/a.png" });
    expect(at(100).transform).toBe("scale(1.12) translateX(0%)");
    expect(at(100, { type: "none" }).transform).toBe("scale(1) translateX(0%)");
    // Kaydırma büyütmenin açtığı payla sınırlı.
    const pan = /^scale\(1\.2\) translateX\(([\d.]+)%\)$/.exec(at(100, { type: "ken_burns", zoomFrom: 1, zoomTo: 1.2, panX: 1 }).transform);
    expect(Number(pan![1])).toBeCloseTo((0.5 * 0.2 * 100) / 1.2);
  });

  it("durağan kareye atmosfer katmanı eklenir", () => {
    const c = draw(<Episode timeline={timeline({ visuals: [shot("a", "still_motion", { ambience: "rain" })] })} />);
    expect(c.querySelectorAll("line")).toHaveLength(140);
  });

  it("video klip sessiz ve hızıyla oynatılır; http adresi olduğu gibi kullanılır", () => {
    const c = draw(<Episode timeline={timeline({ visuals: [shot("a", "ai_clip", { assetUrl: "https://cdn.example/a.mp4", playbackRate: 1.5 })] })} />);
    const v = c.querySelector("video")!;
    expect(v.getAttribute("src")).toBe("https://cdn.example/a.mp4");
    expect(v.dataset.rate).toBe("1.5");
    expect(v.muted).toBe(true);
  });

  it("vektör çekim sahne tarifinden çizilir; tarifsiz grafik klip gibi oynatılır", () => {
    const vector = { layers: [{ asset: "hero", x: 960, y: 500, height: 200 }] };
    const c = draw(
      <Episode
        timeline={timeline({
          vectorAssets: { hero },
          visuals: [shot("v", "motion_graphic", { vector, ambience: "snow" }), shot("w", "motion_graphic", { fromFrame: 100 })],
        })}
      />,
    );
    const [v, w] = [...c.querySelectorAll("section")];
    expect(v!.querySelector('[id="v-0-box"]')).toBeTruthy();
    expect(v!.querySelectorAll("circle")).toHaveLength(110);
    expect(v!.querySelector("video")).toBeNull();
    expect(w!.querySelector("video")!.getAttribute("src")).toBe("/public/w.png");
  });

  it("ses parçaları rolüne göre sıralanır ve sesi ayarlanır", () => {
    const c = draw(
      <Episode
        timeline={timeline({
          audio: [
            { role: "voice", assetUrl: "voice.mp3", fromFrame: 0, durationInFrames: 300 },
            { role: "music", assetUrl: "https://x/m.mp3", fromFrame: 10, durationInFrames: 200, volume: 0.2 },
          ],
        })}
      />,
    );
    const seq = [...c.querySelectorAll("section")].map((s) => [s.dataset.name, s.dataset.from, s.dataset.duration]);
    expect(seq).toEqual([
      ["voice", "0", "300"],
      ["music", "10", "200"],
    ]);
    const audio = [...c.querySelectorAll("audio")].map((a) => [a.getAttribute("src"), a.dataset.volume]);
    expect(audio).toEqual([
      ["/public/voice.mp3", "1"],
      ["https://x/m.mp3", "0.2"],
    ]);
  });

  it("altyazı konuşulan kelimeyi vurgular, konuşma yokken gizlenir", () => {
    const captions = [
      { text: "Merhaba", startMs: 1000, endMs: 1500 },
      { text: "dünya", startMs: 1500, endMs: 2000 },
    ];
    const at = (frame: number) => {
      const c = draw(<Episode timeline={timeline({ captions })} />, frame);
      const spans = [...c.querySelectorAll("span")].map((s) => [s.textContent, (s as HTMLElement).style.color]);
      cleanup();
      return spans;
    };
    expect(at(0)).toEqual([]); // konuşma başlamadı
    // 1,2 sn: ilk kelime; 1,6 sn: ikinci kelime konuşuluyor.
    expect(at(36)).toEqual([
      ["Merhaba", "#FFD84D"],
      [" dünya", "white"],
    ]);
    expect(at(48)).toEqual([
      ["Merhaba", "white"],
      [" dünya", "#FFD84D"],
    ]);
    expect(at(61)).toEqual([]); // konuşma bitti
  });

  it("altyazı yoksa altyazı katmanı da yoktur", () => {
    const c = draw(<Episode timeline={timeline()} />);
    expect(c.firstElementChild!.childElementCount).toBe(0);
  });
});

describe("Remotion kökü", () => {
  it("giriş dosyası kökü kaydeder; kompozisyon süre ve boyutu timeline'dan alır", async () => {
    await import("../src/entry.ts");
    const { Root } = await import("../src/Root.tsx");
    expect(registered.root).toBe(Root);
    render(<Root />);
    const comp = registered.composition!;
    expect(comp.id).toBe("Episode");
    expect(comp.component).toBe(Episode);
    expect([comp.durationInFrames, comp.fps, comp.width, comp.height]).toEqual([90, 30, 1920, 1080]);
    expect((comp.defaultProps as { timeline: Timeline }).timeline.episodeId).toBe("placeholder");
    const meta = (comp.calculateMetadata as (a: { props: { timeline: Timeline } }) => object)({
      props: { timeline: timeline({ fps: 24, width: 1080, height: 1920, durationInFrames: 1234 }) },
    });
    expect(meta).toEqual({ durationInFrames: 1234, fps: 24, width: 1080, height: 1920 });
  });
});
