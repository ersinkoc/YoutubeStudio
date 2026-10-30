/**
 * Atmosfer katmanlarının render maliyetini ölçer: her efekt için aynı karenin 60 karelik (2 sn) render süresi.
 *
 *   pnpm tsx packages/video/scripts/bench-ambience.ts <publicDir> <kare>
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { Ambience, Timeline } from "@ys/core";
import { ENTRY } from "../src/render.ts";

const [publicDir, frame] = process.argv.slice(2);
if (!publicDir || !frame) {
  console.error("Kullanım: bench-ambience.ts <publicDir> <kare>");
  process.exit(1);
}

const FRAMES = 60;
const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: resolve(publicDir) });
const out = await mkdtemp(join(tmpdir(), "ys-bench-"));

for (const kind of Ambience.options) {
  const timeline = Timeline.parse({
    episodeId: "bench",
    lang: "tr",
    durationInFrames: FRAMES,
    visuals: [{ shotId: `b-${kind}`, assetUrl: frame, kind: "still_motion", fromFrame: 0, durationInFrames: FRAMES, ambience: kind }],
    audio: [],
  });
  const inputProps = { timeline };
  const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });
  const started = Date.now();
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", outputLocation: join(out, `${kind}.mp4`), concurrency: 8 });
  console.log(`${kind.padEnd(8)} ${((Date.now() - started) / FRAMES).toFixed(0)} ms/kare`);
}
