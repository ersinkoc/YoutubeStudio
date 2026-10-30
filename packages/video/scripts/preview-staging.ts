/**
 * Sahne fiziğini ve çizgi stillerini model çağrısı olmadan dener: oda kabuğu + masa + sandalyede oturan ve
 * elinde çip tutan karakterler. Her çizgi stili için bir kare çıkarır.
 *
 *   pnpm tsx packages/video/scripts/preview-staging.ts <outDir>
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { LineStyle, Timeline } from "@ys/core";
import { ENTRY } from "../src/render.ts";
import { chair, character, chip, clock, desk, room } from "./fixtures.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Kullanım: preview-staging.ts <outDir>");
  process.exit(1);
}

const DUR = 120;
const timeline = (lineStyle: LineStyle) =>
  Timeline.parse({
    episodeId: "staging-preview",
    lang: "tr",
    durationInFrames: DUR,
    palette: ["#1d2433", "#3a4a66", "#ffd84d"],
    lineStyle,
    vectorAssets: {
      room: { id: "room", kind: "background", svg: room, width: 1920, height: 1080, meta: { floorY: 700 } },
      c1: { id: "c1", kind: "character", svg: character, width: 400, height: 800, meta: { realHeight: 1.75 } },
      c2: { id: "c2", kind: "character", svg: character, width: 400, height: 800, meta: { realHeight: 1.6 } },
      desk: { id: "desk", kind: "prop", svg: desk, width: 600, height: 300, meta: { realHeight: 0.76, grounded: true, surface: 0.97 } },
      chair: { id: "chair", kind: "prop", svg: chair, width: 300, height: 400, meta: { realHeight: 0.95, grounded: true, surface: 0.5 } },
      chip: { id: "chip", kind: "prop", svg: chip, width: 200, height: 200, meta: { realHeight: 0.12, grounded: false } },
      clock: { id: "clock", kind: "prop", svg: clock, width: 200, height: 200, meta: { realHeight: 0.4, grounded: false } },
    },
    visuals: [
      {
        shotId: "st",
        assetUrl: "",
        kind: "motion_graphic",
        fromFrame: 0,
        durationInFrames: DUR,
        vector: {
          background: "room",
          mood: "warm",
          layers: [
            { asset: "clock", x: 420, y: 330, height: 150 },
            { asset: "chair", x: 700, depth: 0.55 },
            { asset: "c1", x: 700, on: 1, expression: "sad", anims: [{ type: "talk", start: 0.1, end: 1 }] },
            { asset: "desk", x: 760, depth: 0.35 },
            { asset: "chip", x: 900, on: 3 },
            { asset: "c2", x: 1350, depth: 0.15, expression: "surprised", anims: [{ type: "explain", start: 0.1, end: 1 }] },
            { asset: "chip", x: 0, heldBy: 5 },
          ],
          texts: [{ text: "1971", x: 960, y: 140, style: "number", color: "#1f6f6a" }],
          camera: { zoomFrom: 1, zoomTo: 1 },
        },
      },
    ],
    audio: [],
  });

await mkdir(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: await mkdtemp(join(tmpdir(), "ys-stage-")) });
for (const style of LineStyle.options) {
  const inputProps = { timeline: timeline(style) };
  const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });
  const output = join(outDir, `staging-${style}.png`);
  await renderStill({ serveUrl, composition, inputProps, frame: 80, output });
  console.log(`kare: ${output}`);
}
