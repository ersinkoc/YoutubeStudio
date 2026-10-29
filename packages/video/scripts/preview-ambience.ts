/**
 * Atmosfer katmanlarını API çağrısı yapmadan dener: verilen kareler üzerine her efekti
 * 3 sn'lik bir çekim olarak dizer, her birinden bir kare (PNG) ve tüm diziyi MP4 olarak çıkarır.
 *
 *   pnpm tsx packages/video/scripts/preview-ambience.ts <publicDir> <outDir> <dışKare> <içKare>
 *
 * Kareler publicDir'e göreli yollardır (ör. bir bölümün keyframe anahtarları).
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { Ambience, Timeline } from "@ys/core";
import { ENTRY } from "../src/render.ts";

const [publicDir, outDir, outdoor, indoor] = process.argv.slice(2);
if (!publicDir || !outDir || !outdoor || !indoor) {
  console.error("Kullanım: preview-ambience.ts <publicDir> <outDir> <dışKare> <içKare>");
  process.exit(1);
}

const OUTDOOR = new Set(["rain", "snow", "fog", "none"]);
const SHOT = 90;
const kinds = Ambience.options;

const timeline = Timeline.parse({
  episodeId: "ambience-preview",
  lang: "tr",
  durationInFrames: SHOT * kinds.length,
  visuals: kinds.map((kind, i) => ({
    shotId: `amb-${kind}`,
    assetUrl: OUTDOOR.has(kind) ? outdoor : indoor,
    kind: "still_motion",
    fromFrame: i * SHOT,
    durationInFrames: SHOT,
    motion: { type: "ken_burns", zoomFrom: 1.03, zoomTo: 1.08 },
    ambience: kind,
  })),
  audio: [],
});

await mkdir(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: resolve(publicDir) });
const inputProps = { timeline };
const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });

for (const [i, kind] of kinds.entries()) {
  const output = join(outDir, `${kind}.png`);
  await renderStill({ serveUrl, composition, inputProps, frame: i * SHOT + SHOT / 2, output });
  console.log(`kare: ${output}`);
}
const video = join(outDir, "ambience.mp4");
await renderMedia({ serveUrl, composition, inputProps, codec: "h264", outputLocation: video, concurrency: 8 });
console.log(`video: ${video}`);
