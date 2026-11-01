/**
 * Vektör renderer'ını model çağrısı olmadan dener: elle yazılmış iskeletli bir karakter, bir nesne ve bir
 * arka planla tek sahnelik kısa video ve birkaç kare çıkarır.
 *
 *   pnpm tsx packages/video/scripts/preview-vector.ts <outDir>
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { Timeline } from "@ys/core";
import { ENTRY } from "../src/render.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Kullanım: preview-vector.ts <outDir>");
  process.exit(1);
}

// RIG sözleşmesine uyan karakter: 400×800 tuval, parça kimlikleri ve dönme noktaları core/vector.ts'teki gibi.
const character = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800">
  <g id="leg-l"><rect x="155" y="505" width="42" height="140" rx="20" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/>
    <g id="shin-l"><rect x="157" y="615" width="38" height="130" rx="18" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/><ellipse cx="168" cy="748" rx="38" ry="15" fill="#1a1a1a"/></g></g>
  <g id="leg-r"><rect x="203" y="505" width="42" height="140" rx="20" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/>
    <g id="shin-r"><rect x="205" y="615" width="38" height="130" rx="18" fill="#2b3a55" stroke="#1b1f2a" stroke-width="4"/><ellipse cx="234" cy="748" rx="38" ry="15" fill="#1a1a1a"/></g></g>
  <g id="body"><path d="M128 290 Q200 262 272 290 L286 540 Q200 562 114 540 Z" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/><path d="M200 280 L286 540 Q240 556 200 558 Z" fill="#a8432f"/></g>
  <g id="arm-l"><rect x="120" y="285" width="38" height="130" rx="19" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/>
    <g id="forearm-l"><rect x="122" y="385" width="34" height="120" rx="17" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/><g id="hand-l"><circle cx="139" cy="512" r="21" fill="#f2c79b" stroke="#1b1f2a" stroke-width="4"/></g></g></g>
  <g id="arm-r"><rect x="242" y="285" width="38" height="130" rx="19" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/>
    <g id="forearm-r"><rect x="244" y="385" width="34" height="120" rx="17" fill="#c8553d" stroke="#1b1f2a" stroke-width="4"/><g id="hand-r"><circle cx="261" cy="512" r="21" fill="#f2c79b" stroke="#1b1f2a" stroke-width="4"/></g></g></g>
  <g id="head">
    <rect x="184" y="228" width="32" height="44" fill="#e0b088"/>
    <circle cx="200" cy="170" r="82" fill="#f2c79b" stroke="#1b1f2a" stroke-width="4"/>
    <path d="M200 88 A82 82 0 0 1 282 170 L282 175 Q250 160 240 120 Q210 140 200 88Z" fill="#e0b088" opacity="0.6"/>
    <path d="M118 160 Q130 80 200 82 Q275 80 284 160 Q260 115 200 118 Q140 115 118 160 Z" fill="#3b2a20"/>
    <g id="brows"><rect x="156" y="140" width="32" height="8" rx="4" fill="#3b2a20"/><rect x="212" y="140" width="32" height="8" rx="4" fill="#3b2a20"/></g>
    <g id="eyes"><ellipse cx="172" cy="170" rx="10" ry="13" fill="#222"/><ellipse cx="228" cy="170" rx="10" ry="13" fill="#222"/><circle cx="175" cy="166" r="3" fill="#fff"/><circle cx="231" cy="166" r="3" fill="#fff"/></g>
    <path d="M200 178 Q194 196 202 198" fill="none" stroke="#b9805a" stroke-width="4" stroke-linecap="round"/>
    <g id="mouth"><path d="M178 212 Q200 228 222 212 Q200 238 178 212 Z" fill="#8a3b2e"/></g>
  </g>
</svg>`;
const chip = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d4b5c"/><stop offset="1" stop-color="#1c232c"/></linearGradient></defs>
  ${Array.from({ length: 6 }, (_, i) => `<rect x="${60 + i * 34}" y="20" width="12" height="40" fill="#c9a227"/><rect x="${60 + i * 34}" y="240" width="12" height="40" fill="#c9a227"/>`).join("")}
  <rect x="40" y="55" width="220" height="190" rx="14" fill="url(#g)"/>
  <rect x="95" y="105" width="110" height="90" rx="6" fill="none" stroke="#7fd1ff" stroke-width="4"/>
</svg>`;

const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
  <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26324a"/><stop offset="1" stop-color="#3e4f6e"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#wall)"/>
  <rect x="1250" y="140" width="440" height="320" rx="10" fill="#9fc6e8" opacity="0.55"/>
  <line x1="1470" y1="140" x2="1470" y2="460" stroke="#26324a" stroke-width="10"/>
  <rect y="820" width="1920" height="260" fill="#5a4636"/>
  <rect x="250" y="700" width="760" height="40" rx="8" fill="#7b5a43"/>
  <rect x="290" y="740" width="30" height="180" fill="#5f4433"/><rect x="940" y="740" width="30" height="180" fill="#5f4433"/>
</svg>`;

const DUR = 150;
const timeline = Timeline.parse({
  episodeId: "vector-preview",
  lang: "tr",
  durationInFrames: DUR * 2,
  palette: ["#1d2433", "#3a4a66", "#ffd84d"],
  vectorAssets: {
    c1: { id: "c1", kind: "character", svg: character, width: 400, height: 800 },
    chip: { id: "chip", kind: "prop", svg: chip, width: 300, height: 300 },
    l1: { id: "l1", kind: "background", svg: background, width: 1920, height: 1080 },
  },
  visuals: [
    {
      shotId: "v1",
      assetUrl: "",
      kind: "motion_graphic",
      fromFrame: 0,
      durationInFrames: DUR,
      ambience: "dust",
      vector: {
        background: "l1",
        layers: [
          { asset: "c1", x: 1400, y: 940, height: 640, anims: [{ type: "walk", start: 0, end: 0.35, toX: 1150 }, { type: "explain", start: 0.38, end: 0.7 }, { type: "surprised", start: 0.75, end: 1 }] },
          { asset: "chip", x: 630, y: 700, height: 200, anims: [{ type: "pop", start: 0.1, end: 0.3 }, { type: "float", start: 0.3, end: 1 }] },
        ],
        texts: [
          { text: "1971", x: 630, y: 260, style: "number", anims: [{ type: "count_up", start: 0.15, end: 0.6 }] },
          { text: "Intel", x: 630, y: 990, style: "label" },
          { text: "fazladan üçüncü yazı", x: 900, y: 500, style: "label" },
        ],
        camera: { zoomFrom: 1, zoomTo: 1.08, panX: 0 },
      },
    },
    {
      shotId: "v2",
      assetUrl: "",
      kind: "motion_graphic",
      fromFrame: DUR,
      durationInFrames: DUR,
      ambience: "rays",
      vector: {
        layers: [
          { asset: "c1", x: 960, y: 1000, height: 760, anims: [{ type: "slide_in", from: "bottom", start: 0, end: 0.25 }, { type: "think", start: 0.25, end: 0.6 }, { type: "cheer", start: 0.65, end: 1 }] },
        ],
        texts: [
          { text: "İlk mikroişlemci", x: 960, y: 140, style: "title", anims: [{ type: "fade_in", start: 0, end: 0.2 }] },
          { text: "2.300 transistör", x: 960, y: 150, style: "subtitle", anims: [{ type: "typewriter", start: 0.3, end: 0.7 }] },
        ],
        camera: { zoomFrom: 1.1, zoomTo: 1, panX: 0 },
      },
    },
  ],
  audio: [],
  captions: [
    { text: "Bin", startMs: 0, endMs: 4000 },
    { text: "dokuz", startMs: 4000, endMs: 6000 },
    { text: "yüz", startMs: 6000, endMs: 8000 },
    { text: "yetmiş", startMs: 8000, endMs: 10000 },
  ],
});

await mkdir(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: await mkdtemp(join(tmpdir(), "ys-vec-")) });
const inputProps = { timeline };
const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });
for (const frame of [30, 85, 140, 210, 270]) {
  const output = join(outDir, `vector-${frame}.png`);
  await renderStill({ serveUrl, composition, inputProps, frame, output });
  console.log(`kare: ${output}`);
}
const started = Date.now();
await renderMedia({ serveUrl, composition, inputProps, codec: "h264", outputLocation: join(outDir, "vector.mp4"), concurrency: 8 });
console.log(`video: ${join(outDir, "vector.mp4")} (${((Date.now() - started) / (DUR * 2)).toFixed(0)} ms/kare)`);
