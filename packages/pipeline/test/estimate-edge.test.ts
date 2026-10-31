import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@ys/media-gateway";
import { estimateEpisode, progressOf, runStatusOf, STALL_AFTER_MS } from "../src/estimate.ts";
import type { EpisodeState, PlannedShotState } from "../src/state.ts";

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
  adapter("tts", { capabilities: ["tts"], price: { unit: "per_1k_chars", usd: 0.1 } }),
];

const state = (over: Partial<EpisodeState> = {}, input: Partial<EpisodeState["input"]> = {}): EpisodeState => ({
  id: "ep",
  createdAt: "",
  done: {},
  agentCostUsd: 0,
  input: { topic: "t", lang: "tr", targetSec: 60, tier: "standard", aiClipRatio: 0.5, budgetUsd: 50, width: 1920, height: 1080, fps: 30, ...input },
  ...over,
});

const shot = (id: string, kind: PlannedShotState["kind"], startMs: number, endMs: number): PlannedShotState => ({
  id,
  sceneId: "s1",
  kind,
  startMs,
  endMs,
  description: "",
  imagePrompt: "",
  motionPrompt: "",
  camera: "static",
});

const cast = {
  characters: [{ id: "c1", name: "A", kind: "person" as const, role: "", visualDescription: "", scenes: [] }],
  locations: [{ id: "l1", name: "L", visualDescription: "", scenes: [] }, { id: "l2", name: "M", visualDescription: "", scenes: [] }],
};

describe("tahmin: vektör modu", () => {
  it("görsel API'si yok: kare ve konsept Claude SVG, render daha uzun; çekim planı sahne başı", () => {
    const e = estimateEpisode(state({ cast }), { providers, latency: {} }, "vector");
    const rows = (s: string) => e.rows.filter((r) => r.stage === s);
    expect(e.mode).toBe("vector");
    expect(rows("concept")).toEqual([expect.objectContaining({ providerId: "claude (SVG)", quantity: 3, unit: "varlık" })]);
    expect(rows("concept")[0]!.basis).not.toContain("kadro tahmini");
    expect(rows("shots")).toEqual([expect.objectContaining({ providerId: "claude", unit: "sahne", quantity: 2 })]);
    expect(rows("keyframes").map((r) => r.providerId)).toEqual(["claude (SVG)", "claude (taslak denetimi)"]);
    expect(rows("keyframes")[0]!.quantity).toBe(4);
    expect(rows("render")[0]).toMatchObject({ seconds: 30 + 60 * 1.9 });
    expect(rows("render")[0]!.basis).toContain("vektör");
    expect(rows("clips")[0]).toMatchObject({ costUsd: 0, basis: "hareket modu: animasyon yok" });
    // Vektör modunda görsel/video sağlayıcısı istenmez ama ses yine router'dan.
    expect(rows("voice")[0]!.providerId).toBe("tts");
  });
});

describe("tahmin: girdi çeşitleri", () => {
  it("en-boy oranı çözünürlükten çıkar; premium seviyede düşük kaliteli sağlayıcı aday olmaz", () => {
    const only = (id: string, ratio: "1:1" | "9:16", qualityPrior = 0.9) =>
      adapter(id, { capabilities: ["t2i", "i2i_multiref"], qualityPrior, limits: { aspectRatios: [ratio] }, price: { unit: "per_output", usd: 0.03 } });
    const concept = (s: EpisodeState, p: ProviderAdapter[]) => estimateEpisode(s, { providers: p, latency: {} }, "still").rows.find((r) => r.stage === "concept")!;
    expect(concept(state({}, { width: 1080, height: 1080 }), [only("kare", "1:1"), only("dikey", "9:16")]).providerId).toBe("kare");
    expect(concept(state({}, { width: 1080, height: 1920 }), [only("kare", "1:1"), only("dikey", "9:16")]).providerId).toBe("dikey");
    expect(concept(state({}, { width: 1080, height: 1080, tier: "premium" }), [only("kare", "1:1", 0.7)]).providerId).toBeUndefined();
    expect(concept(state({}, { width: 1080, height: 1080, tier: "premium" }), [only("kare", "1:1", 0.85)]).providerId).toBe("kare");
  });

  it("seslendirme bitince süre sesten, metin senaryodan; bilinmeyen dilde varsayılan konuşma hızı", () => {
    const voiced = estimateEpisode(
      state({
        script: { scenes: [{ id: "s1", beatId: "b", narration: "x".repeat(500), visualIntent: "", emotion: "", location: "" }] },
        voice: { s1: { key: "v", mimeType: "audio/mpeg", durationMs: 90_000, words: [], estimatedTiming: false } },
      }),
      { providers, latency: {} },
      "still",
    );
    expect(voiced.videoSec).toBe(90);
    const voice = voiced.rows.find((r) => r.stage === "voice")!;
    expect(voice).toMatchObject({ quantity: 500, basis: "varsayılan" });
    const ja = estimateEpisode(state({}, { lang: "ja" }), { providers, latency: {} }, "still");
    // 1 dk × 140 kelime × 6,5 karakter
    expect(ja.rows.find((r) => r.stage === "voice")).toMatchObject({ quantity: 910, basis: "varsayılan; metin tahmini" });
  });

  it("karışık modda klip sayısı plandaki ai_clip çekimlerinden, plan yoksa orandan", () => {
    const planned = estimateEpisode(state({ shots: [shot("a", "ai_clip", 0, 5000), shot("b", "still_motion", 5000, 9000)] }), { providers, latency: {} });
    expect(planned.mode).toBe("mixed");
    expect(planned.rows.find((r) => r.stage === "clips")).toMatchObject({ quantity: 5, basis: "varsayılan; 1 klip" });
    expect(planned.rows.find((r) => r.stage === "keyframes")!.basis).not.toContain("çekim sayısı tahmini");
    const ratio = estimateEpisode(state(), { providers, latency: {} });
    // 60 sn / 5,5 sn ≈ 11 çekim, yarısı klip
    expect(ratio.shots).toBe(11);
    expect(ratio.rows.find((r) => r.stage === "clips")!.basis).toBe("varsayılan; 6 klip");
  });

  it("sağlayıcı yoksa varsayılan gecikmeyle sıfır maliyet ve uyarı", () => {
    const e = estimateEpisode(state(), { providers: [], latency: {} }, "still");
    expect(e.rows.find((r) => r.stage === "concept")).toMatchObject({ costUsd: 0, providerId: undefined, basis: "sağlayıcı yok; kadro tahmini (2 karakter, 3 mekân)" });
    expect(e.warnings).toEqual(expect.arrayContaining(['"t2i" için uygun sağlayıcı yok (anahtar eksik olabilir)', '"tts" için uygun sağlayıcı yok (anahtar eksik olabilir)']));
  });
});

describe("ilerleme: kenar durumlar", () => {
  const at = "2026-10-30T00:00:00Z";
  const now = Date.parse("2026-10-30T00:01:00Z");

  it("çalışan aşama yoksa ilerleme yok; sayaçsız aşama 0/0", () => {
    expect(progressOf(state())).toBeUndefined();
    expect(progressOf(state({ stats: { style: { startedAt: at } } }), now)).toEqual({ stage: "style", label: "Stil", done: 0, total: 0, etaSec: undefined });
  });

  it("konsept: vektörde seçilen varlık, görselde aday sayılır; kadro yoksa 0", () => {
    const stats = { concept: { startedAt: at } };
    const concept = { candidates: { c1: [{ key: "a", mimeType: "" }, { key: "b", mimeType: "" }] }, selected: { c1: { key: "a", mimeType: "" } } };
    expect(progressOf(state({ stats, cast, concept }, { motionMode: "vector" }), now)).toMatchObject({ done: 1, total: 3, etaSec: 120 });
    expect(progressOf(state({ stats, cast, concept }, { motionMode: "still" }), now)).toMatchObject({ done: 2, total: 7 });
    expect(progressOf(state({ stats }, { motionMode: "vector" }), now)).toMatchObject({ done: 0, total: 0 });
    expect(progressOf(state({ stats }, { motionMode: "still" }), now)).toMatchObject({ done: 0, total: 0 });
  });

  it("vektör kareleri: çizilen nesneler; nesne yoksa 0", () => {
    const stats = { keyframes: { startedAt: at } };
    const vectorProps = { "p-a": { description: "", kind: "prop" as const, key: "k" }, "p-b": { description: "", kind: "prop" as const } };
    expect(progressOf(state({ stats, vectorProps }, { motionMode: "vector" }), now)).toMatchObject({ done: 1, total: 2 });
    expect(progressOf(state({ stats }, { motionMode: "vector" }), now)).toMatchObject({ done: 0, total: 0 });
  });

  it("durum: kalp atışı yoksa aşamanın başlangıcından takılma ölçülür", () => {
    const s = state({ stats: { voice: { startedAt: at } } });
    expect(runStatusOf(s, Date.parse(at) + STALL_AFTER_MS + 1)).toEqual({ status: "stalled", stage: "voice" });
    expect(runStatusOf(s, Date.parse(at) + 1000)).toEqual({ status: "running", stage: "voice" });
  });
});
