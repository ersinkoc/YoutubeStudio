import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { Timeline } from "@ys/core";

const run = promisify(execFile);

export const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "entry.ts");

export interface RenderOptions {
  timeline: Timeline;
  /** Timeline'daki göreli varlık yollarının (staticFile) çözüleceği klasör. */
  publicDir: string;
  outputPath: string;
  onProgress?: (fraction: number) => void;
  /** Geçici hatadan sonra render baştan alınırken çağrılır (neden). */
  onRetry?: (reason: string) => void;
  concurrency?: number;
  /** OffthreadVideo kare önbelleği. */
  videoCacheBytes?: number;
}

/**
 * Remotion varsayılanı sistem belleğinin yarısı; 32 iş parçacıklı Windows makinede 16 paralel
 * sekmeyle commit sınırına çarpıp compositor'ı çökertti (29 Eki gerçek render, %50'de).
 */
const DEFAULT_VIDEO_CACHE_BYTES = 2 * 1024 ** 3;

/**
 * Tarayıcı kurulumu ve sayfa yüklemesi için süre. Remotion varsayılanı 30 sn; makine yükteyken (iki bölüm + paralel
 * Claude Code süreçleri) "Timed out after 30000ms while setting up the headless browser" ile aşama düşüyordu (30 Eki).
 */
const BROWSER_TIMEOUT_MS = 120_000;
const MAX_DEFAULT_CONCURRENCY = 8;

/**
 * Geçici dosya hatası (klasör/dosya kayboldu, kilitli) veya tarayıcı kurulumu zaman aşımı: aynı render'ı tekrar denemek
 * güvenli. 30 Eki: %90'dan sonra ses karıştırmada Temp altındaki "remotion-audio-mixing" klasörü kaybolunca 17 dk'lık
 * render boşa gitti.
 */
export const isTransientRenderFailure = (e: unknown) =>
  e instanceof Error && /No such file or directory|ENOENT|EBUSY|EPERM|while setting up the headless browser/i.test(e.message);

/**
 * Remotion geçici klasörlerini os.tmpdir() altında açar; Windows'ta sistem Temp'i dışarıdan temizlenebiliyor. Render
 * süresince Temp çıktının yanındaki klasöre yönlendirilir (os.tmpdir() her çağrıda TEMP/TMP'yi okur).
 */
async function withTempDir<R>(dir: string, fn: () => Promise<R>): Promise<R> {
  await mkdir(dir, { recursive: true });
  const keys = process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) process.env[k] = dir;
  try {
    return await fn();
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/** Timeline'ı yerelde MP4'e render eder (Remotion; ≤3 kişilik ekipte lisans ücretsiz). Geçici hatada bir kez yeniden dener. */
export async function renderEpisode(opts: RenderOptions): Promise<string> {
  const tempDir = join(dirname(resolve(opts.outputPath)), ".render-tmp");
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTempDir(tempDir, () => renderOnce(opts));
    } catch (e) {
      if (attempt >= 1 || !isTransientRenderFailure(e)) throw e;
      opts.onRetry?.((e as Error).message.split("\n").at(-1) ?? "");
    }
  }
}

async function renderOnce(opts: RenderOptions): Promise<string> {
  // Göreli publicDir ile bundle sunucusu görselleri çözemiyor ("source image cannot be decoded").
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: resolve(opts.publicDir) });
  const inputProps = { timeline: opts.timeline };
  const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });

  // Uzantı ne olursa olsun ham dosya ayrı: aynı yol olursa ffmpeg kendi girdisinin üstüne yazar, rm sonucu siler.
  const rawPath = `${opts.outputPath.replace(/\.mp4$/i, "")}.raw.mp4`;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    outputLocation: rawPath,
    concurrency:
      opts.concurrency ?? Math.max(1, Math.min(MAX_DEFAULT_CONCURRENCY, Math.floor(availableParallelism() / 2))),
    timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
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
  // Tek tarayıcı bütün kareler için: önceden her kare ayrı Chrome açıyordu (30+ açılış); yükte biri zaman aşımına düşünce
  // tüm aşama düşüyordu.
  const browser = await openBrowser("chrome");
  try {
    const composition = await selectComposition({ serveUrl, id: "Episode", inputProps, puppeteerInstance: browser, timeoutInMilliseconds: BROWSER_TIMEOUT_MS });
    const out: Record<string, string> = {};
    for (const [name, frame] of Object.entries(opts.frames)) {
      const output = join(opts.outDir, `${name}.jpg`);
      const still = () =>
        renderStill({
          serveUrl,
          composition,
          inputProps,
          frame,
          output,
          imageFormat: "jpeg",
          jpegQuality: 80,
          scale: 0.5,
          puppeteerInstance: browser,
          timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
        });
      // Takılan tek kare bir kez yeniden denenir.
      await still().catch(still);
      out[name] = output;
    }
    return out;
  } finally {
    await browser.close({ silent: true }).catch(() => {});
  }
}