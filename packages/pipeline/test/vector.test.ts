import { describe, expect, it } from "vitest";
import { prefixSvgIds, sanitizeSvg, svgSize, VectorShot } from "@ys/core";
import { buildTimeline, type EpisodeState } from "../src/index.ts";

describe("SVG yardımcıları", () => {
  it("izin listesi dışındaki öğe ve öznitelikleri, tehlikeli değerleri atar", () => {
    const raw = [
      '<svg viewBox="0 0 10 10"><!-- <script>x()</script> -->',
      "<style>@import url(https://e/x.css); rect{fill:red}</style>",
      '<SCRIPT>alert(1)</SCRIPT><svg:script>alert(2)</svg:script>',
      '<g id="a" ONLOAD="x()" style="fill:url(https://e/p)"><rect width="5" height="5" fill="url(#g)" style="opacity:0.5"/></g>',
      '<use href="javascript:alert(1)"/><use xlink:href="#a"/><a href="https://e"><circle r="1"/></a>',
      '<animate attributeName="href" to="javascript:x()"/><text>gizli</text><foreignObject><div/></foreignObject>',
      '<path d="M0 0L5 5" fill="#fff" onclick=x()/></svg>',
    ].join("");
    expect(sanitizeSvg(raw)).toBe(
      '<svg viewBox="0 0 10 10"><g id="a"><rect width="5" height="5" fill="url(#g)" style="opacity:0.5"/></g><use/><use xlink:href="#a"/><circle r="1"/><path d="M0 0L5 5" fill="#fff"/></svg>',
    );
  });
  it("betik, olay, dış bağlantı ve gömülü görselleri atar; yalnız svg bloğunu tutar", () => {
    const raw = `İşte çizim:\n<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><image href="http://e/x.png"/><a href="https://e">x</a><use href="#a"/><rect id="a" fill="url(#g)"/></svg>\nBitti.`;
    const svg = sanitizeSvg(raw);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/script|onload|<image|https:/);
    // İç başvurular korunur.
    expect(svg).toContain('href="#a"');
    expect(() => sanitizeSvg("svg yok")).toThrow();
  });

  it("aynı varlık iki kez gömülünce kimlikler çakışmasın diye önek ekler", () => {
    const svg = '<svg><defs><linearGradient id="g"/></defs><g id="arm-r"><rect fill="url(#g)"/></g><use href="#arm-r"/></svg>';
    expect(prefixSvgIds(svg, "s1-0-")).toBe(
      '<svg><defs><linearGradient id="s1-0-g"/></defs><g id="s1-0-arm-r"><rect fill="url(#s1-0-g)"/></g><use href="#s1-0-arm-r"/></svg>',
    );
  });

  it("boyutu viewBox'tan okur", () => {
    expect(svgSize('<svg viewBox="0 0 400 800">')).toEqual({ width: 400, height: 800 });
    expect(svgSize('<svg width="300" height="200">')).toEqual({ width: 300, height: 200 });
    expect(() => svgSize("<svg>")).toThrow(/viewBox/);
  });
});

describe("vektör timeline", () => {
  it("vektör çekimi motion_graphic görseli olur, varlıklar ve palet timeline'a gömülür", () => {
    const spec = VectorShot.parse({ background: "l1", layers: [{ asset: "c1", x: 960, y: 940, height: 700 }] });
    const state: EpisodeState = {
      id: "ep",
      createdAt: "",
      done: {},
      agentCostUsd: 0,
      input: { topic: "t", lang: "tr", targetSec: 3, tier: "economy", motionMode: "vector", aiClipRatio: 0, budgetUsd: 1, width: 1920, height: 1080, fps: 30 },
      style: { artStyle: "flat", promptPrefix: "", palette: ["#111111", "#222222", "#ffcc00"], lighting: "", lensLanguage: "", negativeRules: [] },
      script: { scenes: [{ id: "s1", beatId: "b1", narration: "merhaba", visualIntent: "", emotion: "", location: "" }] },
      voice: { s1: { key: "v.mp3", mimeType: "audio/mpeg", durationMs: 2000, words: [{ text: "merhaba", startMs: 0, endMs: 2000 }], estimatedTiming: false } },
      shots: [
        { id: "a", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 2000, description: "", imagePrompt: "", motionPrompt: "", camera: "static", ambience: "dust", vector: spec },
      ],
      keyframes: {},
    } as EpisodeState;
    const assets = { c1: { id: "c1", kind: "character" as const, svg: "<svg/>", width: 400, height: 800, meta: {} } };

    const tl = buildTimeline(state, (k) => k, assets);
    expect(tl.visuals).toMatchObject([{ shotId: "a", kind: "motion_graphic", assetUrl: "", ambience: "dust", vector: { background: "l1" } }]);
    expect(tl.vectorAssets).toEqual(assets);
    expect(tl.palette).toEqual(["#111111", "#222222", "#ffcc00"]);
  });
});
