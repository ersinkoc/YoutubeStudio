import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Gerçek ffmpeg/ffprobe çalıştırılmaz: execFile sahte, son çağrının argümanları saklanır.
const proc = vi.hoisted(() => ({ calls: [] as { cmd: string; args: string[] }[], stdout: "", fileSeen: false }));
vi.mock("node:child_process", async () => {
  const fs = await import("node:fs");
  return {
    execFile: (cmd: string, args: string[], cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
      proc.calls.push({ cmd, args });
      // ffprobe çağrıldığında geçici dosya yazılmış olmalı.
      if (cmd === "ffprobe") proc.fileSeen = fs.existsSync(args.at(-1)!);
      if (proc.stdout === "çök") cb(new Error("ffprobe yok"));
      else cb(null, { stdout: proc.stdout, stderr: "" });
    },
  };
});

const { mapLimit, normalizeClip, probeDurationMs } = await import("../src/media.ts");

beforeEach(() => {
  proc.calls = [];
  proc.fileSeen = false;
});

describe("medya araçları", () => {
  it("ffprobe süresini milisaniyeye çevirir ve geçici klasörü siler", async () => {
    proc.stdout = "12.3456\n";
    expect(await probeDurationMs(new Uint8Array([1, 2]), "mp3")).toBe(12346);
    const { cmd, args } = proc.calls[0]!;
    expect(cmd).toBe("ffprobe");
    expect(args.slice(0, 6)).toEqual(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"]);
    expect(args.at(-1)).toMatch(/media\.mp3$/);
    expect(proc.fileSeen).toBe(true);
    expect(existsSync(args.at(-1)!)).toBe(false);
  });

  it("süre okunamazsa ya da ffprobe çökerse hata verir, geçici klasör yine silinir", async () => {
    proc.stdout = "N/A";
    await expect(probeDurationMs(new Uint8Array([1]), "wav")).rejects.toThrow("ffprobe süre okuyamadı: N/A");
    expect(existsSync(proc.calls[0]!.args.at(-1)!)).toBe(false);
    proc.stdout = "çök";
    await expect(probeDurationMs(new Uint8Array([1]), "wav")).rejects.toThrow("ffprobe yok");
  });

  it("klibi hedef boyuta kırpar, sabit fps ve sessiz yazar", async () => {
    proc.stdout = "";
    await normalizeClip("in.mp4", "out.mp4", 1920, 1080, 30);
    const { cmd, args } = proc.calls[0]!;
    expect(cmd).toBe("ffmpeg");
    expect(args).toContain("-an");
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30");
    expect(args[args.indexOf("-g") + 1]).toBe("30");
    expect(args.slice(0, 5)).toEqual(["-y", "-v", "error", "-i", "in.mp4"]);
    expect(args.at(-1)).toBe("out.mp4");
  });

  it("mapLimit sırayı korur; ilk hatadan sonra yeni iş almaz", async () => {
    expect(await mapLimit([3, 1, 2], 2, async (n, i) => n * 10 + i)).toEqual([30, 11, 22]);
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("iki");
        return n;
      }),
    ).rejects.toThrow("iki");
    expect(started).toEqual([1, 2]);
  });
});
