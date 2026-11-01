import { describe, expect, it, vi } from "vitest";

// Gerçek ffmpeg çalıştırılmaz: execFile sahte; Remotion'un kopyasının yolu sahte.
const proc = vi.hoisted(() => ({ calls: [] as string[], fail: {} as Record<string, string> }));
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, _args: string[], cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    proc.calls.push(cmd);
    const code = proc.fail[cmd];
    if (code) cb(Object.assign(new Error(`spawn ${cmd} ${code}`), { code }));
    else cb(null, { stdout: `${cmd} tamam`, stderr: "" });
  },
}));
vi.mock("@remotion/renderer", () => ({
  RenderInternals: { getExecutablePath: ({ type }: { type: string }) => `remotion/${type}.exe` },
}));

const { runMediaTool } = await import("../src/tools.ts");

describe("runMediaTool", () => {
  it("PATH'teki aracı kullanır; yoksa Remotion'un kopyasına düşer", async () => {
    proc.calls = [];
    proc.fail = {};
    expect((await runMediaTool("ffprobe", ["a"])).stdout).toBe("ffprobe tamam");
    proc.fail = { ffprobe: "ENOENT" };
    expect((await runMediaTool("ffprobe", ["a"])).stdout).toBe("remotion/ffprobe.exe tamam");
    expect(proc.calls).toEqual(["ffprobe", "ffprobe", "remotion/ffprobe.exe"]);
  });

  it("yedeksiz çağrıda ne yapılacağını söyler; başka hatayı olduğu gibi iletir", async () => {
    proc.fail = { ffmpeg: "ENOENT" };
    await expect(runMediaTool("ffmpeg", [], false)).rejects.toThrow("ffmpeg bulunamadı: FFmpeg'i kur ve PATH'e ekle");
    proc.fail = { ffmpeg: "EACCES" };
    await expect(runMediaTool("ffmpeg", [])).rejects.toThrow("spawn ffmpeg EACCES");
  });
});
