import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { Timeline } from "@ys/core";

const run = promisify(execFile);

export const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "entry.ts");

export interface RenderOptions {
  timeline: Timeline;
  /** Timeline'daki göreli varlık yollarının (staticFile) çözüleceği klasör. */
  publicDir: string;
  outputPath: string;
  onProgress?: (fraction: number) => void;
  concurrency?: number;
  /** OffthreadVideo kare önbelleği. */
  videoCacheBytes?: number;
}

/**
 * Remotion varsayılanı sistem belleğinin yarısı; 32 iş parçacıklı Windows makinede 16 paralel
 * sekmeyle commit sınırına çarpıp compositor'ı çökertti (29 Eki gerçek render, %50'de).
 */
const DEFAULT_VIDEO_CACHE_BYTES = 2 * 1024 ** 3;
const MAX_DEFAULT_CONCURRENCY = 8;

/** Timeline'ı yerelde MP4'e render eder (Remotion; ≤3 kişilik ekipte lisans ücretsiz). */
export async function renderEpisode(opts: RenderOptions): Promise<string> {
  // Göreli publicDir ile bundle sunucusu görselleri çözemiyor ("source image cannot be decoded").
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: resolve(opts.publicDir) });
  const inputProps = { timeline: opts.timeline };
  const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });

  const rawPath = opts.outputPath.replace(/\.mp4$/, ".raw.mp4");
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    outputLocation: rawPath,
    concurrency:
      opts.concurrency ?? Math.max(1, Math.min(MAX_DEFAULT_CONCURRENCY, Math.floor(availableParallelism() / 2))),
    offthreadVideoCacheSizeInBytes: opts.videoCacheBytes ?? DEFAULT_VIDEO_CACHE_BYTES,
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });

  await normalizeLoudness(rawPath, opts.outputPath);
  await rm(rawPath, { force: true });
  return opts.outputPath;
}

/**
 * YouTube oynatımı -14 LUFS'a göre ayarlar; daha sessiz video rakiplerinden kısık duyulur
 * (29 Eki ilk bölüm -18,7 LUFS çıktı). Görüntü yeniden kodlanmaz.
 */
export async function normalizeLoudness(input: string, output: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-c:v",
    "copy",
    "-af",
    "loudnorm=I=-14:TP=-1.5:LRA=11",
    "-ar",
    "48000",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ]);
}

export interface StillsOptions {
  timeline: Timeline;
  publicDir: string;
  /** Çıkarılacak kareler: dosya adı → kare numarası. */
  frames: Record<string, number>;
  outDir: string;
}

/**
 * Timeline'dan tek tek kareler (JPEG) çıkarır; inceleme aşaması ve stüdyo küçük resimleri için.
 * Bundle bir kez yapılır, kareler sırayla alınır (render'a göre çok hafif).
 */
export async function renderStills(opts: StillsOptions): Promise<Record<string, string>> {
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: resolve(opts.publicDir) });
  const inputProps = { timeline: opts.timeline };
  const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });
  const out: Record<string, string> = {};
  for (const [name, frame] of Object.entries(opts.frames)) {
    const output = join(opts.outDir, `${name}.jpg`);
    await renderStill({ serveUrl, composition, inputProps, frame, output, imageFormat: "jpeg", jpegQuality: 80, scale: 0.5 });
    out[name] = output;
  }
  return out;
}