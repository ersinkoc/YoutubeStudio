/**
 * Bir bölümün kayıtlı zaman çizelgesinden seçili çekimlerin karelerini yeniden çıkarır (model çağrısı yok).
 * Renderer değişikliklerini gerçek bölüm üzerinde karşılaştırmak için.
 *
 *   pnpm tsx packages/video/scripts/restill.ts <state.json> <publicDir> <outDir> [shotId...]
 */
import { readFile } from "node:fs/promises";
import type { Timeline } from "@ys/core";
import { renderStills } from "../src/render.ts";

const [statePath, publicDir, outDir, ...only] = process.argv.slice(2);
if (!statePath || !publicDir || !outDir) {
  console.error("Kullanım: restill.ts <state.json> <publicDir> <outDir> [shotId...]");
  process.exit(1);
}
const state = JSON.parse(await readFile(statePath, "utf8")) as { timeline?: Timeline };
if (!state.timeline) throw new Error("zaman çizelgesi yok");
const visuals = state.timeline.visuals.filter((v) => !only.length || only.includes(v.shotId));
// İnceleme aşamasıyla aynı an: çekimin %80'i.
const frames = Object.fromEntries(visuals.map((v) => [v.shotId, v.fromFrame + Math.floor(v.durationInFrames * 0.8)]));
const out = await renderStills({ timeline: state.timeline, publicDir, frames, outDir });
for (const f of Object.values(out)) console.log(f);
