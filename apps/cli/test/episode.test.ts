import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_AUTO, STYLE_CUSTOM, STYLE_PACK_IDS } from "@ys/core";
import type { EpisodeInput, EpisodeState } from "@ys/pipeline/light";
import { FsAssetStore } from "@ys/storage";

/** FFmpeg çalıştırılmaz: sahte execFile istenen çıktı dosyasını yazar. */
const ffmpeg = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<object>()),
  execFile: (cmd: string, args: string[], cb: (e: Error | null, out: { stdout: string; stderr: string }) => void) => {
    ffmpeg.calls.push([cmd, ...args]);
    writeFileSync(args.at(-1)!, `sahte ${cmd}`);
    cb(null, { stdout: "", stderr: "" });
  },
}));
// @ys/pipeline'ın ağır kısmı (Remotion, Agent SDK) yüklenmez; CLI'ın kullandığı saf yardımcılar gerçektir.
vi.mock("@ys/pipeline", async () => ({
  ...(await import("@ys/pipeline/light")),
  ...(await import("../../../packages/pipeline/src/timing.ts")),
}));

const { episodeCommand, positive, renderDemo } = await import("../src/episode.ts");

type Pipeline = Parameters<typeof episodeCommand>[0];

const base = (over: Partial<EpisodeState> = {}): EpisodeState =>
  ({
    id: "e1",
    createdAt: "t",
    input: { topic: "Fatih", lang: "tr", targetSec: 180, tier: "economy", aiClipRatio: 0, budgetUsd: 10, width: 1920, height: 1080, fps: 30 },
    done: {},
    agentCostUsd: 0.12345,
    ...over,
  }) as EpisodeState;

/** Sahte pipeline: durumları bellekte tutar, çağrıları kaydeder. */
function fakePipeline(initial: EpisodeState[] = []) {
  const states = new Map(initial.map((s) => [s.id, structuredClone(s)]));
  const calls = { create: [] as EpisodeInput[], run: [] as [string, unknown][], saved: [] as EpisodeState[], previewed: [] as string[] };
  const pipeline = {
    create: async (input: EpisodeInput) => {
      calls.create.push(input);
      const s = base({ id: `yeni-${calls.create.length}`, input });
      states.set(s.id, s);
      return s;
    },
    load: async (id: string) => {
      const s = states.get(id);
      if (!s) throw new Error(`Bölüm bulunamadı: ${id}`);
      return s;
    },
    save: async (s: EpisodeState) => {
      calls.saved.push(structuredClone(s));
      states.set(s.id, s);
    },
    run: async (id: string, opts: unknown) => {
      calls.run.push([id, opts]);
      return states.get(id)!;
    },
    previewConcept: async (id: string) => {
      calls.previewed.push(id);
      return states.get(id)!;
    },
  };
  return { pipeline: pipeline as unknown as Pipeline, calls, states };
}

let out: string[] = [];
beforeEach(() => {
  out = [];
  ffmpeg.calls = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("positive", () => {
  it("virgüllü ondalığı kabul eder, sıfır/negatif/sayı olmayanı reddeder", () => {
    expect(positive("--budget", "2,5")).toBe(2.5);
    expect(positive("--budget", 3)).toBe(3);
    for (const v of ["0", "-1", "$5", "abc", ""]) expect(() => positive("--budget", v)).toThrow("--budget pozitif bir sayı olmalı (ör. 2.5)");
  });
});

describe("episode new", () => {
  it("varsayılanlarla oluşturur ve kimliği basar", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { topic: "Kuşatma", series: "   " });
    expect(calls.create[0]).toEqual({
      topic: "Kuşatma",
      lang: "tr",
      targetSec: 180,
      tier: "economy",
      budgetUsd: 10,
      aiClipRatio: 0,
      motionMode: undefined,
      styleHint: undefined,
      voiceId: undefined,
      autoApprove: true,
      qa: true,
      realism: true,
      sideViews: false,
      captions: true,
      lineStyle: undefined,
      stylePack: STYLE_AUTO,
      series: undefined,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(out).toEqual(["yeni-1"]);
  });

  it("tüm bayraklar", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, {
      topic: "T",
      lang: "en",
      minutes: "1,5",
      budget: "4",
      tier: "premium",
      clips: "0.5",
      motion: "vector",
      style: "noir",
      voice: "v1",
      manual: true,
      noQa: true,
      noRealism: true,
      sideViews: true,
      noCaptions: true,
      presenter: " abcdef ",
      with: "x1, ,x2",
      line: "ink",
      stylePack: STYLE_PACK_IDS[0],
      series: " Seri ",
      vertical: true,
    });
    expect(calls.create[0]).toMatchObject({ lang: "en", targetSec: 90, budgetUsd: 4, tier: "premium", aiClipRatio: 0.5, motionMode: "vector", styleHint: "noir", voiceId: "v1", autoApprove: false, qa: false, realism: false, sideViews: true, captions: false, presenter: "abcdef", bankCast: ["x1", "x2"], lineStyle: "ink", stylePack: STYLE_PACK_IDS[0], series: "Seri", width: 1080, height: 1920 });
    await episodeCommand(pipeline, "new", undefined, { topic: "T", stylePack: STYLE_CUSTOM, motion: "still" });
    expect(calls.create[1]).toMatchObject({ stylePack: STYLE_CUSTOM, motionMode: "still" });
    await episodeCommand(pipeline, "new", undefined, { topic: "T", stylePack: STYLE_AUTO, motion: "animated" });
    await episodeCommand(pipeline, "new", undefined, { topic: "T", motion: "mixed" });
    expect(calls.create.map((c) => c.motionMode)).toEqual(["vector", "still", "animated", "mixed"]);
  });

  it("geçersiz girdiler bölüm oluşturmadan reddedilir", async () => {
    const { pipeline, calls } = fakePipeline();
    const bad: [Record<string, unknown>, string | RegExp][] = [
      [{}, "--topic gerekli"],
      [{ topic: "T", minutes: "0" }, "--minutes pozitif"],
      [{ topic: "T", budget: "abc" }, "--budget pozitif"],
      [{ topic: "T", clips: "1.5" }, "--clips 0 ile 1 arasında olmalı"],
      [{ topic: "T", clips: "-0.1" }, "--clips 0 ile 1 arasında olmalı"],
      [{ topic: "T", clips: "x" }, "--clips 0 ile 1 arasında olmalı"],
      [{ topic: "T", motion: "uçan" }, "--motion animated|mixed|still|vector"],
      [{ topic: "T", stylePack: "yok" }, /^--style-pack auto\|custom\|/],
      [{ topic: "T", line: "kalın" }, /./],
      [{ topic: "T", tier: "bedava" }, /./],
    ];
    for (const [args, error] of bad) await expect(episodeCommand(pipeline, "new", undefined, args)).rejects.toThrow(error);
    expect(calls.create).toHaveLength(0);
  });
});

describe("episode run, show, preview", () => {
  it("run aşama bayraklarını doğrular ve iletir", async () => {
    const { pipeline, calls } = fakePipeline([base()]);
    await episodeCommand(pipeline, "run", "e1", { until: "script", from: "style", only: undefined });
    expect(calls.run[0]).toEqual(["e1", { until: "script", from: "style", only: undefined }]);
    await episodeCommand(pipeline, "run", "e1", { only: "concept" });
    expect(calls.run[1]).toEqual(["e1", { until: undefined, from: undefined, only: "concept" }]);
    await expect(episodeCommand(pipeline, "run", "e1", { until: "bitiş" })).rejects.toThrow(/^Geçersiz aşama: bitiş \(style, story/);
    await expect(episodeCommand(pipeline, "run", undefined, {})).rejects.toThrow("bölüm kimliği gerekli");
  });

  it("show özet basar: başlık, bekleme, kadro adayları, çekimler, video", async () => {
    const full = base({
      story: { title: "Kuşatma" } as EpisodeState["story"],
      done: { style: "t", story: "t" },
      waitingFor: "concept",
      cast: { characters: [{ id: "c1", name: "Fatih" }], locations: [{ id: "l1", name: "Sur" }, { id: "l2", name: "Saray" }] } as unknown as EpisodeState["cast"],
      concept: { candidates: { c1: [{ key: "a", mimeType: "x" }, { key: "b", mimeType: "x" }], l1: [{ key: "c", mimeType: "x" }] }, selected: { c1: { key: "b", mimeType: "x" }, l1: { key: "yabancı", mimeType: "x" } } },
      shots: [{ id: "sh1" }, { id: "sh2" }] as EpisodeState["shots"],
      keyframes: { sh1: { key: "k", mimeType: "x" } },
      render: { path: "out/video.mp4" } as EpisodeState["render"],
    });
    full.input.motionMode = "vector";
    const { pipeline } = fakePipeline([full]);
    await episodeCommand(pipeline, "show", "e1", {});
    expect(out).toEqual([
      "Bölüm:   e1",
      "Konu:    Fatih (tr, 180 sn, economy, vector)",
      "Başlık:  Kuşatma",
      expect.stringMatching(/^Aşamalar: ✓style ✓story ·script/),
      "⏸ Onay bekleniyor: concept  →  pnpm ys episode approve e1 concept",
      "  c1 Fatih: 2 aday, seçili #1",
      "  l1 Sur: 1 aday",
      "  l2 Saray: 0 aday",
      "Çekim:   2 (1 keyframe, 0 klip)",
      "Ajan maliyeti: $0.1235",
      "Video:   out/video.mp4",
    ]);
  });

  it("show en kısa özet: hareket modu yoksa karışık; konsepti olmayan kadro", async () => {
    const { pipeline } = fakePipeline([base({ cast: { characters: [{ id: "c1", name: "A" }], locations: [] } as unknown as EpisodeState["cast"], shots: [] })]);
    await episodeCommand(pipeline, "show", "e1", {});
    expect(out).toEqual(["Bölüm:   e1", "Konu:    Fatih (tr, 180 sn, economy, mixed)", expect.stringMatching(/^Aşamalar: ·style/), "  c1 A: 0 aday", "Çekim:   0 (0 keyframe, 0 klip)", "Ajan maliyeti: $0.1235"]);
    await expect(episodeCommand(pipeline, "show", undefined, {})).rejects.toThrow("bölüm kimliği gerekli");
  });

  it("preview seçilen referanslarla deneme karesi ister", async () => {
    const { pipeline, calls } = fakePipeline([base()]);
    await episodeCommand(pipeline, "preview", "e1", {});
    expect(calls.previewed).toEqual(["e1"]);
    expect(out[0]).toBe("Bölüm:   e1");
    await expect(episodeCommand(pipeline, "preview", undefined, {})).rejects.toThrow("bölüm kimliği gerekli");
  });

  it("bilinmeyen alt komut kullanımı gösterir", async () => {
    const { pipeline } = fakePipeline();
    await expect(episodeCommand(pipeline, undefined, undefined, {})).rejects.toThrow("Kullanım: episode new|run|show|preview|approve|select");
  });
});

describe("episode approve ve select", () => {
  it("approve kapıyı onaylar ve kaydeder; kullanım hatası", async () => {
    const { pipeline, calls } = fakePipeline([base({ script: { scenes: [] } as unknown as EpisodeState["script"], waitingFor: "script" })]);
    await episodeCommand(pipeline, "approve", "e1", { gate: "script" });
    expect(calls.saved[0]!.approvals?.script).toBeDefined();
    expect(calls.saved[0]!.waitingFor).toBeUndefined();
    for (const [id, gate] of [[undefined, "script"], ["e1", "render"], ["e1", undefined]] as const) {
      await expect(episodeCommand(pipeline, "approve", id, { gate })).rejects.toThrow("Kullanım: episode approve <id> script|concept");
    }
    await expect(episodeCommand(pipeline, "approve", "e1", { gate: "concept" })).resolves.toBeUndefined();
  });

  it("select adayı seçer; biçim hatası", async () => {
    const cands = [{ key: "a", mimeType: "x" }, { key: "b", mimeType: "x" }];
    const { pipeline, calls } = fakePipeline([base({ concept: { candidates: { c1: cands }, selected: {} } })]);
    await episodeCommand(pipeline, "select", "e1", { pick: "c1=1" });
    expect(calls.saved[0]!.concept!.selected.c1?.key).toBe("b");
    for (const [id, pick] of [[undefined, "c1=1"], ["e1", "c1"], ["e1", "=1"], ["e1", undefined]] as const) {
      await expect(episodeCommand(pipeline, "select", id, { pick })).rejects.toThrow("Kullanım: episode select <id> <varlık>=<sıra>");
    }
  });
});

describe("renderDemo", () => {
  it("FFmpeg test görselleri ve sesiyle sahte bölüm kurar, render'a kadar çalıştırır ve geçici klasörü siler", async () => {
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-demo-store-")));
    const { pipeline, calls } = fakePipeline();
    await renderDemo(pipeline, store);

    expect(ffmpeg.calls).toHaveLength(5);
    expect(ffmpeg.calls.every((c) => c[0] === "ffmpeg")).toBe(true);
    const tmp = dirname(ffmpeg.calls[0]!.at(-1)!);
    expect(existsSync(tmp)).toBe(false);
    for (const key of ["demo/kf0.png", "demo/kf1.png", "demo/kf2.png", "demo/voice-s1.mp3", "demo/voice-s2.mp3"]) {
      expect(new TextDecoder().decode((await store.get(key))!)).toBe("sahte ffmpeg");
    }

    expect(calls.create[0]).toMatchObject({ topic: "render demo", tier: "ultra", budgetUsd: 0 });
    const saved = calls.saved[0]!;
    expect(saved.approvals).toEqual({ script: "demo", concept: "demo" });
    expect(Object.keys(saved.done)).toEqual(["style", "story", "script", "cast", "concept", "voice", "shots", "keyframes", "clips"]);
    expect(saved.shots!.map((s) => [s.id, s.startMs, s.endMs])).toEqual([
      ["shot0", 0, 2200],
      ["shot1", 2200, 4400],
      ["shot2", 4400, 9800],
    ]);
    expect(saved.voice!.s2).toMatchObject({ durationMs: 5000, estimatedTiming: true });
    expect(saved.voice!.s1!.words!.length).toBeGreaterThan(5);
    expect(calls.run).toEqual([["yeni-1", { until: "render" }]]);
    expect(out[0]).toBe("Bölüm:   yeni-1");
  });

  it("hata olsa da geçici klasör silinir", async () => {
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-demo-store-")));
    const { pipeline } = fakePipeline();
    (pipeline as unknown as { create: () => Promise<never> }).create = async () => {
      throw new Error("oluşturulamadı");
    };
    await expect(renderDemo(pipeline, store)).rejects.toThrow("oluşturulamadı");
    expect(existsSync(dirname(ffmpeg.calls[0]!.at(-1)!))).toBe(false);
  });
});
