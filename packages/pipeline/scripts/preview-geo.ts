/**
 * Gerçek veriden harita ve bayrak üretimini model çağrısı olmadan dener; her sahneden bir kare çıkarır.
 *
 *   pnpm tsx packages/pipeline/scripts/preview-geo.ts <outDir>
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MapSpec, Timeline, type VectorAsset } from "@ys/core";
import { renderStills } from "@ys/video/render";
import { generateFlag, generateMap } from "../src/geo.ts";
import { character } from "../../video/scripts/fixtures.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Kullanım: preview-geo.ts <outDir>");
  process.exit(1);
}
const palette = ["#1d2433", "#3a4a66", "#c8553d"];
const asset = (id: string, kind: VectorAsset["kind"], g: Awaited<ReturnType<typeof generateMap>>): VectorAsset => ({ id, kind, ...g });

const rise = await generateMap(
  MapSpec.parse({
    focus: ["TUR", "GRC", "BGR"],
    highlight: [{ countries: ["TUR"], tone: "accent" }],
    markers: [
      { lon: 30.18, lat: 40.02, label: "Söğüt" },
      { lon: 29.06, lat: 40.19, label: "Bursa" },
      { lon: 26.56, lat: 41.68, label: "Edirne" },
      { lon: 28.98, lat: 41.01, label: "İstanbul" },
    ],
    routes: [
      {
        points: [
          { lon: 30.18, lat: 40.02 },
          { lon: 29.06, lat: 40.19 },
          { lon: 26.56, lat: 41.68 },
          { lon: 28.98, lat: 41.01 },
        ],
        label: "1299–1453",
      },
    ],
  }),
  "tr",
  palette,
);
const globe = await generateMap(MapSpec.parse({ projection: "globe", focus: ["TUR"], highlight: [{ countries: ["TUR"] }] }), "tr", palette);
const world = await generateMap(
  MapSpec.parse({ highlight: [{ countries: ["USA", "GBR", "FRA"], tone: "cool", label: "Müttefikler" }, { countries: ["DEU", "AUT", "HUN"], tone: "warm" }] }),
  "tr",
  palette,
);
const trFlag = await generateFlag({ code: "ottoman", pole: true });
const usFlag = await generateFlag({ code: "us", pole: false });

const DUR = 150;
const shot = (shotId: string, from: number, vector: unknown) => ({ shotId, assetUrl: "", kind: "motion_graphic", fromFrame: from, durationInFrames: DUR, vector });
const timeline = Timeline.parse({
  episodeId: "geo-preview",
  lang: "tr",
  durationInFrames: DUR * 4,
  palette,
  vectorAssets: {
    rise: asset("rise", "background", rise),
    globe: asset("globe", "background", globe),
    world: asset("world", "background", world),
    flagTr: asset("flagTr", "prop", trFlag),
    flagUs: asset("flagUs", "prop", usFlag),
    c1: { id: "c1", kind: "character", svg: character, width: 400, height: 800, meta: { realHeight: 1.75 } },
  },
  visuals: [
    shot("rise", 0, { background: "rise", layers: [], texts: [{ text: "Bir beylikten imparatorluğa", x: 960, y: 90, style: "title" }], camera: { zoomFrom: 1, zoomTo: 1.08 } }),
    shot("globe", DUR, { background: "globe", layers: [], texts: [], camera: { zoomFrom: 1, zoomTo: 1.05 } }),
    shot("world", DUR * 2, { background: "world", layers: [], texts: [], camera: { zoomFrom: 1, zoomTo: 1 } }),
    shot("flags", DUR * 3, {
      layers: [
        { asset: "flagTr", x: 520, depth: 0.45 },
        { asset: "c1", x: 1200, depth: 0.2, expression: "happy", anims: [{ type: "explain" }] },
        { asset: "flagUs", x: 0, heldBy: 1 },
      ],
      texts: [],
      camera: { zoomFrom: 1, zoomTo: 1 },
    }),
  ],
  audio: [],
});
await mkdir(outDir, { recursive: true });
const frames = Object.fromEntries(timeline.visuals.map((v) => [v.shotId, v.fromFrame + Math.floor(v.durationInFrames * 0.92)]));
const out = await renderStills({ timeline, publicDir: await mkdtemp(join(tmpdir(), "ys-geo-")), frames, outDir });
for (const f of Object.values(out)) console.log(f);
console.log(`harita boyutu: ${(rise.svg.length / 1024).toFixed(0)} KB, dünya: ${(world.svg.length / 1024).toFixed(0)} KB`);
