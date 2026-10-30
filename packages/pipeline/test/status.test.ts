import { describe, expect, it } from "vitest";
import { newEpisodeState, progressOf, runStatusOf, STALL_AFTER_MS, type EpisodeInput, type EpisodeState } from "../src/light.ts";
import { levelOf } from "../src/pipeline.ts";

const input: EpisodeInput = {
  topic: "t",
  lang: "tr",
  targetSec: 180,
  tier: "standard",
  aiClipRatio: 0.1,
  budgetUsd: 10,
  width: 1920,
  height: 1080,
  fps: 30,
};

const at = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse("2026-10-30T10:00:00Z");

function state(patch: Partial<EpisodeState> = {}, autoApprove = false): EpisodeState {
  return { ...newEpisodeState({ ...input, autoApprove }), ...patch };
}

describe("bölüm durumu", () => {
  it("yeni bölüm beklemede, sıradaki aşama stil", () => {
    expect(runStatusOf(state(), NOW)).toEqual({ status: "idle", stage: "style" });
  });

  it("senaryo bitti ve onay yoksa (kısmi çalıştırma, waitingFor yazılmamış) onay bekliyor", () => {
    const s = state({ done: { style: at(NOW), story: at(NOW), script: at(NOW) } });
    expect(runStatusOf(s, NOW)).toEqual({ status: "waiting", stage: "cast" });
    // CLI bölümleri otomatik onaylıdır: bekleme yok.
    expect(runStatusOf({ ...s, input: { ...s.input, autoApprove: true } }, NOW).status).toBe("idle");
  });

  it("çalışan aşama son kayıttan sonra uzun süre güncellenmezse takılmış sayılır", () => {
    const s = state({ done: { style: at(NOW) }, stats: { story: { startedAt: at(NOW - 60_000) } }, heartbeatAt: at(NOW - 30_000) });
    expect(runStatusOf(s, NOW)).toEqual({ status: "running", stage: "story" });
    expect(runStatusOf({ ...s, heartbeatAt: at(NOW - STALL_AFTER_MS - 1) }, NOW).status).toBe("stalled");
  });

  it("hata ve render edilmiş video", () => {
    expect(runStatusOf(state({ lastError: { stage: "voice", message: "x", at: at(NOW) } }), NOW)).toEqual({ status: "error", stage: "voice" });
    expect(runStatusOf(state({ render: { path: "v.mp4", at: at(NOW) }, done: { render: "x" } }), NOW).status).toBe("done");
    // Render yeniden açıldıysa (ör. nesne kabul edildi) eski video "bitti" saydırmaz.
    expect(runStatusOf(state({ render: { path: "v.mp4", at: at(NOW) } }), NOW).status).not.toBe("done");
  });

  it("render ilerlemesi yüzde olarak görünür", () => {
    const s = state({ stats: { render: { startedAt: at(NOW - 100_000) } }, renderPct: 40 });
    expect(progressOf(s, NOW)).toMatchObject({ stage: "render", done: 40, total: 100 });
    expect(progressOf(s, NOW)!.etaSec).toBeCloseTo(150);
  });
});

describe("günlük satırı önemi", () => {
  it("aşama, uyarı ve bilgi ayrılır", () => {
    expect(levelOf("▶ keyframes")).toBe("stage");
    expect(levelOf("  inceleme grubu atlandı: zaman aşımı")).toBe("warn");
    expect(levelOf("  s1: 12.0 sn (gemini)")).toBe("info");
  });
});
