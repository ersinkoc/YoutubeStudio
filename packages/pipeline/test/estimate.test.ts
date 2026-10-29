import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@ys/media-gateway";
import { estimateEpisode, progressOf, type EpisodeState } from "../src/light.ts";

const adapter = (id: string, over: Partial<ProviderAdapter>): ProviderAdapter => ({
  id,
  local: false,
  capabilities: [],
  limits: {},
  qualityPrior: 0.8,
  price: { unit: "free" },
  generate: async () => ({ files: [] }),
  ...over,
});

const providers = [
  adapter("img", { capabilities: ["t2i", "i2i_multiref"], price: { unit: "per_output", usd: 0.03 } }),
  adapter("kling", { capabilities: ["i2v"], price: { unit: "per_second", usd: 0.05, stepSec: 5, minSec: 5 } }),
  adapter("tts", { capabilities: ["tts", "tts_timestamps"], limits: { requiresVoiceId: true }, price: { unit: "per_1k_chars", usd: 0.1 } }),
];

const state = (over: Partial<EpisodeState> = {}): EpisodeState => ({
  id: "ep",
  createdAt: "",
  done: {},
  agentCostUsd: 0,
  input: {
    topic: "t",
    lang: "tr",
    targetSec: 60,
    tier: "standard",
    motionMode: "animated",
    aiClipRatio: 0.2,
    budgetUsd: 20,
    voiceId: "v",
    width: 1920,
    height: 1080,
    fps: 30,
  },
  ...over,
});

describe("estimateEpisode", () => {
  it("planlama öncesi: hedef süreden çekim sayısı, router fiyatı ve fatura adımı", () => {
    const e = estimateEpisode(state(), { providers, latency: {} });
    const row = (s: string) => e.rows.find((r) => r.stage === s)!;
    expect(e.shots).toBe(13); // 60 sn / 4,5 sn
    expect(row("keyframes")).toMatchObject({ providerId: "img", quantity: 13, costUsd: 13 * 0.03 });
    // Animasyonda çekimler ~4,5 sn → her klip 5 sn faturalanır.
    expect(row("clips")).toMatchObject({ providerId: "kling", quantity: 65, costUsd: 13 * 0.25 });
    // tr: 115 kelime/dk × 6,5 karakter
    expect(row("voice")).toMatchObject({ providerId: "tts", quantity: 748 });
    expect(row("render").costUsd).toBe(0);
    expect(e.warnings).toEqual([]);
  });

  it("çekim planı varken gerçek sürelerle faturalar: 6 sn çekim 10 sn klip", () => {
    const shot = (id: string, startMs: number, endMs: number) => ({
      id, sceneId: "s1", kind: "ai_clip" as const, startMs, endMs, description: "", imagePrompt: "", motionPrompt: "", camera: "static" as const,
    });
    const e = estimateEpisode(state({ shots: [shot("a", 0, 4000), shot("b", 4000, 10_000)] }), { providers, latency: {} });
    expect(e.rows.find((r) => r.stage === "clips")).toMatchObject({ quantity: 15, costUsd: 0.75 });
  });

  it("hareketli resim modunda animasyon maliyeti sıfır; biten aşamalar kalandan düşer", () => {
    const e = estimateEpisode(state({ done: { style: "x", story: "x" } }), { providers, latency: {} }, "still");
    expect(e.rows.find((r) => r.stage === "clips")!.costUsd).toBe(0);
    expect(e.remainingUsd).toBeLessThan(e.totalUsd);
  });

  it("ölçülmüş gecikmeyi kullanır; sağlayıcı yoksa ve bütçe aşılıyorsa uyarır", () => {
    const measured = estimateEpisode(state(), { providers, latency: { kling: { avgMs: 30_000, n: 12 } } });
    expect(measured.rows.find((r) => r.stage === "clips")).toMatchObject({ seconds: 5 * 30, basis: "ölçüm (n=12); 13 klip" });
    const noVideo = estimateEpisode(state({ input: { ...state().input, budgetUsd: 1 } }), { providers: providers.slice(0, 1), latency: {} });
    expect(noVideo.warnings.some((w) => w.includes("i2v"))).toBe(true);
    expect(noVideo.warnings.some((w) => w.includes("bütçe"))).toBe(true);
  });
});

describe("progressOf", () => {
  it("çalışan aşamada biten/toplam ve gerçek hıza göre kalan süre", () => {
    const shots = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, sceneId: "s1", kind: "ai_clip" as const, startMs: 0, endMs: 1, description: "", imagePrompt: "", motionPrompt: "", camera: "static" as const,
    }));
    const keyframes = Object.fromEntries(shots.slice(0, 4).map((s) => [s.id, { key: "k", mimeType: "image/png" }]));
    const p = progressOf(
      state({ shots, keyframes, stats: { keyframes: { startedAt: "2026-10-30T00:00:00Z" } } }),
      Date.parse("2026-10-30T00:00:40Z"),
    );
    expect(p).toEqual({ stage: "keyframes", label: "Kareler", done: 4, total: 10, etaSec: 60 });
  });
});
