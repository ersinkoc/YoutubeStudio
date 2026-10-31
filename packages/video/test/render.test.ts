import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Timeline } from "@ys/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gerçek Chrome, webpack paketi ve ffmpeg yok: Remotion ve execFile sahte; dosya sistemi gerçek ama geçici klasörde.
const remotion = vi.hoisted(() => ({
  bundle: vi.fn(),
  openBrowser: vi.fn(),
  selectComposition: vi.fn(),
  renderMedia: vi.fn(),
  renderStill: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("@remotion/bundler", () => ({ bundle: remotion.bundle }));
vi.mock("@remotion/renderer", () => ({
  openBrowser: remotion.openBrowser,
  selectComposition: remotion.selectComposition,
  renderMedia: remotion.renderMedia,
  renderStill: remotion.renderStill,
}));
vi.mock("node:child_process", () => ({ execFile: remotion.execFile }));
// Yarış durumlarını (kilit dosyası arada silindi, geçici klasör silinemedi) üretmek için fs/promises sarılır.
const fsx = vi.hoisted(() => ({ readFile: undefined as undefined | ((...a: unknown[]) => Promise<unknown>), rm: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: (...a: Parameters<typeof real.readFile>) => (fsx.readFile ?? real.readFile)(...a),
    rm: (...a: Parameters<typeof real.rm>) => (fsx.rm ?? real.rm)(...a),
  };
});

// Gerçek makine kilidine dokunulmasın (o sırada bir bölüm render ediyor olabilir).
const DIR = mkdtempSync(join(tmpdir(), "ys-render-"));
const LOCK = join(DIR, "render.lock");
process.env.YS_RENDER_LOCK = LOCK;
const mod = await import("../src/render.ts");
const { renderEpisode, renderStills, withRenderLock, isTransientRenderFailure, normalizeLoudness, ENTRY } = mod;

const timeline = { episodeId: "e1" } as Timeline;
const browser = { close: vi.fn() };

beforeEach(() => {
  remotion.bundle.mockResolvedValue("http://bundle");
  remotion.selectComposition.mockResolvedValue({ id: "Episode" });
  remotion.renderMedia.mockImplementation(async (o: { onProgress: (p: { progress: number }) => void }) => {
    o.onProgress({ progress: 0.5 });
    o.onProgress({ progress: 1 });
  });
  remotion.renderStill.mockResolvedValue({});
  remotion.openBrowser.mockResolvedValue(browser);
  browser.close.mockResolvedValue(undefined);
  remotion.execFile.mockImplementation((_f: string, _a: string[], cb: (e: Error | null, r?: object) => void) => cb(null, { stdout: "", stderr: "" }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fsx.readFile = undefined;
  fsx.rm = undefined;
});

const out = (name: string) => join(mkdtempSync(join(DIR, "out-")), name);

describe("renderEpisode", () => {
  it("paketler, render eder, sesi -14 LUFS'a getirir ve ham dosyayı siler", async () => {
    const output = out("bolum.MP4");
    const progress: number[] = [];
    writeFileSync(output.replace(/\.mp4$/i, ".raw.mp4"), "ham");
    const savedTemp = process.env.TEMP;
    let tempDuring: string | undefined;
    remotion.bundle.mockImplementation(async () => {
      tempDuring = process.env.TEMP;
      return "http://bundle";
    });

    expect(await renderEpisode({ timeline, publicDir: "pub", outputPath: output, onProgress: (p) => progress.push(p) })).toBe(output);

    expect(remotion.bundle).toHaveBeenCalledWith({ entryPoint: ENTRY, publicDir: join(process.cwd(), "pub") });
    expect(remotion.selectComposition).toHaveBeenCalledWith({ serveUrl: "http://bundle", id: "Episode", inputProps: { timeline } });
    const media = remotion.renderMedia.mock.calls[0]![0];
    const rawPath = output.replace(/\.mp4$/i, "") + ".raw.mp4";
    expect(media).toMatchObject({
      serveUrl: "http://bundle",
      composition: { id: "Episode" },
      inputProps: { timeline },
      codec: "h264",
      outputLocation: rawPath,
      timeoutInMilliseconds: 120_000,
      offthreadVideoCacheSizeInBytes: 2 * 1024 ** 3,
    });
    expect(media.concurrency).toBeGreaterThanOrEqual(1);
    expect(media.concurrency).toBeLessThanOrEqual(8);
    expect(progress).toEqual([0.5, 1]);
    const [cmd, args] = remotion.execFile.mock.calls[0]!;
    expect(cmd).toBe("ffmpeg");
    expect(args).toEqual(expect.arrayContaining(["-i", rawPath, "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:v", "copy", output]));
    expect(existsSync(rawPath)).toBe(false);
    // Render sırasında Temp çıktının yanındaki klasöre yönlendirilir, sonra geri alınır ve klasör silinir.
    expect(tempDuring).toBe(join(output, "..", ".render-tmp"));
    expect(process.env.TEMP).toBe(savedTemp);
    expect(existsSync(join(output, "..", ".render-tmp"))).toBe(false);
    expect(existsSync(LOCK)).toBe(false);
  });

  it("verilen paralellik ve önbellek kullanılır; ilerleme dinleyicisi olmadan da çalışır", async () => {
    await renderEpisode({ timeline, publicDir: DIR, outputPath: out("a.mp4"), concurrency: 3, videoCacheBytes: 1024 });
    expect(remotion.renderMedia.mock.calls[0]![0]).toMatchObject({ concurrency: 3, offthreadVideoCacheSizeInBytes: 1024 });
  });

  it("geçici hatada bir kez baştan dener ve nedeni bildirir", async () => {
    remotion.renderMedia.mockRejectedValueOnce(new Error("mixing\nENOENT: no such file or directory, open 'x.wav'"));
    const reasons: string[] = [];
    await renderEpisode({ timeline, publicDir: DIR, outputPath: out("a.mp4"), onRetry: (r) => reasons.push(r) });
    expect(reasons).toEqual(["ENOENT: no such file or directory, open 'x.wav'"]);
    expect(remotion.renderMedia).toHaveBeenCalledTimes(2);
  });

  it("dinleyici yoksa da yeniden dener; ikinci geçici hatada vazgeçer", async () => {
    const err = new Error("Timed out after 30000ms while setting up the headless browser");
    remotion.bundle.mockRejectedValue(err);
    await expect(renderEpisode({ timeline, publicDir: DIR, outputPath: out("a.mp4") })).rejects.toBe(err);
    expect(remotion.bundle).toHaveBeenCalledTimes(2);
    expect(existsSync(LOCK)).toBe(false);
  });

  it("kalıcı hatayı yeniden denemeden iletir", async () => {
    const onRetry = vi.fn();
    remotion.renderMedia.mockRejectedValue(new Error("composition bulunamadı"));
    await expect(renderEpisode({ timeline, publicDir: DIR, outputPath: out("a.mp4"), onRetry })).rejects.toThrow("composition bulunamadı");
    expect(onRetry).not.toHaveBeenCalled();
    expect(remotion.renderMedia).toHaveBeenCalledTimes(1);
  });

  it("ffmpeg hatası render'ı düşürür", async () => {
    remotion.execFile.mockImplementation((_f: string, _a: string[], cb: (e: Error) => void) => cb(new Error("ffmpeg yok")));
    await expect(renderEpisode({ timeline, publicDir: DIR, outputPath: out("a.mp4") })).rejects.toThrow("ffmpeg yok");
  });

  it("geçici klasör silinemezse render yine başarılı sayılır", async () => {
    fsx.rm = async (p: unknown, o: unknown) => {
      if (String(p).endsWith(".render-tmp")) throw new Error("EBUSY");
      const { rm } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return rm(p as string, o as object);
    };
    const output = out("a.mp4");
    expect(await renderEpisode({ timeline, publicDir: DIR, outputPath: output })).toBe(output);
  });

  it("Windows dışında TMPDIR yönlendirilir; önceden yoksa render sonrası yine yoktur", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "linux" });
    const saved = process.env.TMPDIR;
    delete process.env.TMPDIR;
    let during: string | undefined;
    remotion.bundle.mockImplementation(async () => {
      during = process.env.TMPDIR;
      return "http://bundle";
    });
    try {
      const output = out("a.mp4");
      await renderEpisode({ timeline, publicDir: DIR, outputPath: output });
      expect(during).toBe(join(output, "..", ".render-tmp"));
      expect("TMPDIR" in process.env).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", platform);
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
  });
});

describe("normalizeLoudness", () => {
  it("görüntüyü yeniden kodlamadan sesi YouTube düzeyine getirir", async () => {
    await normalizeLoudness("in.mp4", "out.mp4");
    expect(remotion.execFile.mock.calls[0]!.slice(0, 2)).toEqual([
      "ffmpeg",
      ["-y", "-v", "error", "-i", "in.mp4", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "out.mp4"],
    ]);
  });
});

describe("isTransientRenderFailure", () => {
  it("yalnız dosya/tarayıcı kurulum hatalarını geçici sayar", () => {
    for (const m of ["ENOENT: x", "EBUSY: locked", "EPERM: operation", "No such file or directory", "while setting up the headless browser"]) {
      expect(isTransientRenderFailure(new Error(m))).toBe(true);
    }
    expect(isTransientRenderFailure(new Error("Out of memory"))).toBe(false);
    expect(isTransientRenderFailure("ENOENT")).toBe(false);
  });
});

describe("renderStills", () => {
  it("tek tarayıcıyla kareleri sırayla çıkarır ve tarayıcıyı kapatır", async () => {
    const outDir = mkdtempSync(join(DIR, "stills-"));
    const res = await renderStills({ timeline, publicDir: "pub", frames: { a: 0, b: 45 }, outDir });
    expect(res).toEqual({ a: join(outDir, "a.jpg"), b: join(outDir, "b.jpg") });
    expect(remotion.openBrowser).toHaveBeenCalledTimes(1);
    expect(remotion.openBrowser).toHaveBeenCalledWith("chrome");
    expect(remotion.selectComposition).toHaveBeenCalledWith({
      serveUrl: "http://bundle",
      id: "Episode",
      inputProps: { timeline },
      puppeteerInstance: browser,
      timeoutInMilliseconds: 120_000,
    });
    expect(remotion.renderStill.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ frame: 0, output: join(outDir, "a.jpg"), imageFormat: "jpeg", jpegQuality: 80, scale: 0.5, puppeteerInstance: browser }),
      expect.objectContaining({ frame: 45, output: join(outDir, "b.jpg") }),
    ]);
    expect(browser.close).toHaveBeenCalledWith({ silent: true });
  });

  it("takılan kare bir kez yeniden denenir", async () => {
    remotion.renderStill.mockRejectedValueOnce(new Error("timeout"));
    await renderStills({ timeline, publicDir: DIR, frames: { a: 10 }, outDir: DIR });
    expect(remotion.renderStill).toHaveBeenCalledTimes(2);
  });

  it("ikinci denemede de düşen kare hatası iletilir, tarayıcı yine kapanır (kapanış hatası yutulur)", async () => {
    remotion.renderStill.mockRejectedValue(new Error("kare alınamadı"));
    browser.close.mockRejectedValue(new Error("zaten kapalı"));
    await expect(renderStills({ timeline, publicDir: DIR, frames: { a: 10 }, outDir: DIR })).rejects.toThrow("kare alınamadı");
    expect(browser.close).toHaveBeenCalled();
    expect(existsSync(LOCK)).toBe(false);
  });
});

describe("render kilidi: kenar durumları", () => {
  /** Bekleme sürelerini atlar; her beklemede verilen adım çalışır. */
  const instantWaits = (onWait: (n: number) => void = () => {}) => {
    let n = 0;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      onWait(++n);
      fn();
      return 0;
    }) as typeof setTimeout);
    return () => n;
  };

  it("canlı sahibi bekler, bir kez bildirir, kilit boşalınca girer", async () => {
    writeFileSync(LOCK, `${process.pid}:baska-is`);
    const holders: number[] = [];
    const waits = instantWaits((n) => n === 2 && rmSync(LOCK)); // sahibi ikinci beklemede bitirir
    expect(await withRenderLock(async () => "tamam", (pid) => holders.push(pid))).toBe("tamam");
    expect(holders).toEqual([process.pid]);
    expect(waits()).toBe(2);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it("uzun süre boş kalan kilit dosyası bayat sayılır", async () => {
    writeFileSync(LOCK, "");
    const waits = instantWaits();
    const onWait = vi.fn();
    expect(await withRenderLock(async () => 7, onWait)).toBe(7);
    expect(waits()).toBe(50); // 50 × 200 ms kısa bekleme, 51. okumada bayat
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 200);
    expect(onWait).not.toHaveBeenCalled();
  });

  it("izin hatası veren süreç canlı sayılır (EPERM), diğer hatada ölü", async () => {
    writeFileSync(LOCK, "4242:x");
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      throw Object.assign(new Error("kill"), { code: pid === 4242 ? "EPERM" : "ESRCH" });
    });
    // İlk beklemede kilit ölü bir sürece geçer: bayat sayılıp silinir.
    instantWaits((n) => n === 1 && writeFileSync(LOCK, "4343:olu"));
    const onWait = vi.fn();
    expect(await withRenderLock(async () => 1, onWait)).toBe(1);
    expect(onWait).toHaveBeenCalledExactlyOnceWith(4242);
  });

  it("kilit okunurken silinirse boş sayılır; iş kilidi kendisi silerse sorun çıkmaz", async () => {
    writeFileSync(LOCK, `${process.pid}:x`);
    const { readFile } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let first = true;
    fsx.readFile = async (...a: unknown[]) => {
      if (first) {
        first = false;
        rmSync(LOCK);
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return (readFile as (...x: unknown[]) => Promise<unknown>)(...a);
    };
    instantWaits();
    const res = await withRenderLock(async () => {
      rmSync(LOCK);
      return "bitti";
    });
    expect(res).toBe("bitti");
    expect(existsSync(LOCK)).toBe(false);
  });

  it("başkasının aldığı kilit iş bitince silinmez", async () => {
    await withRenderLock(async () => writeFileSync(LOCK, "123:baskasi"));
    expect(readFileSync(LOCK, "utf8")).toBe("123:baskasi");
    rmSync(LOCK);
  });

  it("kilit dosyası açılamazsa (EEXIST dışı hata) hemen hata verir", async () => {
    vi.resetModules();
    process.env.YS_RENDER_LOCK = join(DIR, "yok", "alt", "render.lock");
    try {
      const fresh = await import("../src/render.ts");
      await expect(fresh.withRenderLock(async () => 1)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.env.YS_RENDER_LOCK = LOCK;
    }
  });

  it("kilit yolu verilmezse sistem Temp'indeki ys-render.lock kullanılır", async () => {
    // Temp geçici klasöre çevrilir: gerçek makine kilidine dokunulmaz.
    const temp = join(DIR, "temp");
    mkdirSync(temp);
    const keys = ["YS_RENDER_LOCK", "TEMP", "TMP", "TMPDIR"] as const;
    const saved = keys.map((k) => process.env[k]);
    delete process.env.YS_RENDER_LOCK;
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
    vi.resetModules();
    try {
      const fresh = await import("../src/render.ts");
      const lock = join(temp, "ys-render.lock");
      expect(await fresh.withRenderLock(async () => existsSync(lock))).toBe(true);
      expect(existsSync(lock)).toBe(false);
    } finally {
      keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
    }
  });
});
