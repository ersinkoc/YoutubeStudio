import { describe, expect, it } from "vitest";
import type { ShotPlanOut } from "@ys/agents";
import { VectorShot } from "@ys/core";
import { buildTimeline, estimateWordTimings, resolveShotTimes, SCENE_GAP_MS, sceneOffsets } from "../src/timing.ts";
import type { EpisodeState, SceneVoice } from "../src/state.ts";

const voiceFor = (text: string, durationMs: number, key = "v.mp3"): SceneVoice => ({
  key,
  mimeType: "audio/mpeg",
  durationMs,
  words: estimateWordTimings(text, durationMs),
  estimatedTiming: true,
});

const planned = (startWord: number, vector?: VectorShot) => ({
  startWord,
  kind: "still_motion" as const,
  characterIds: [],
  locationId: "",
  description: "d",
  imagePrompt: "",
  motionPrompt: "",
  camera: "static" as const,
  ambience: "none" as const,
  ...(vector !== undefined ? { vector } : {}),
});

describe("zamanlama: kenar durumlar", () => {
  it("sesi olmayan sahne yalnız nefes payı kadar yer tutar", () => {
    expect(sceneOffsets(["s1", "s2", "s3"], { s2: voiceFor("a", 1000) })).toEqual({ s1: 0, s2: SCENE_GAP_MS, s3: 1000 + 2 * SCENE_GAP_MS });
  });

  it("sesi olmayan sahnenin çekimleri düşer; vektör tarifi çekime taşınır, boş tarif taşınmaz", () => {
    const spec = VectorShot.parse({ layers: [] });
    const plan = { scenes: [{ sceneId: "s1", shots: [planned(0, spec), planned(1, undefined)] }, { sceneId: "s2", shots: [planned(0)] }] } as ShotPlanOut;
    const shots = resolveShotTimes(plan, ["s1", "s2"], { s1: voiceFor("bir iki", 2000) });
    expect(shots.map((s) => s.id)).toEqual(["s1-sh1", "s1-sh2"]);
    expect(shots[0]!.vector).toEqual(spec);
    expect(shots[1]).not.toHaveProperty("vector");
  });
});

describe("timeline: kenar durumlar", () => {
  const base = (): EpisodeState => ({
    id: "ep",
    createdAt: "",
    done: {},
    agentCostUsd: 0,
    input: { topic: "t", lang: "tr", targetSec: 3, tier: "economy", aiClipRatio: 0, budgetUsd: 1, width: 1920, height: 1080, fps: 30 },
    script: {
      scenes: [
        { id: "s1", beatId: "b1", narration: "merhaba", visualIntent: "", emotion: "", location: "" },
        { id: "s2", beatId: "b1", narration: "sessiz", visualIntent: "", emotion: "", location: "" },
      ],
    },
    voice: { s1: voiceFor("merhaba", 1000, "voice/s1.mp3") },
    shots: [
      { id: "v", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 500, description: "", imagePrompt: "", motionPrompt: "", camera: "static", vector: VectorShot.parse({}) },
      { id: "k", sceneId: "s1", kind: "still_motion", startMs: 500, endMs: 900, description: "", imagePrompt: "", motionPrompt: "", camera: "pull_out" },
      { id: "yok", sceneId: "s1", kind: "still_motion", startMs: 900, endMs: 1000, description: "", imagePrompt: "", motionPrompt: "", camera: "static" },
    ],
    keyframes: { k: { key: "kf/k.png", mimeType: "image/png" } },
  });

  it("eksik girdiyle kurulmaz", () => {
    expect(() => buildTimeline({ ...base(), keyframes: undefined }, (k) => k)).toThrow("Timeline için script, voice, shots, keyframes gerekli");
    expect(() => buildTimeline({ ...base(), voice: undefined }, (k) => k)).toThrow("gerekli");
  });

  it("atmosferi olmayan eski çekimler 'none' alır; karesi olmayan çekim ve sesi olmayan sahne atlanır", () => {
    const tl = buildTimeline(base(), (k) => `a/${k}`);
    expect(tl.visuals.map((v) => [v.shotId, v.kind, v.ambience])).toEqual([
      ["v", "motion_graphic", "none"],
      ["k", "still_motion", "none"],
    ]);
    expect(tl.visuals[1]!.motion).toMatchObject({ type: "ken_burns", zoomFrom: 1.15, zoomTo: 1 });
    expect(tl.audio.map((a) => a.assetUrl)).toEqual(["a/voice/s1.mp3"]);
    expect(tl.captions).toEqual([{ text: "merhaba", startMs: 0, endMs: 1000 }]);
    expect(tl.palette).toEqual([]);
    expect(tl.vectorAssets).toEqual({});
  });
});

describe("klip süresi", () => {
  it("çekimi kapsayan tam saniye, 3–15 sn arasında", async () => {
    const { clipSeconds } = await import("../src/timing.ts");
    expect([0.5, 3, 5, 5.2, 6.2, 8, 15, 22].map(clipSeconds)).toEqual([3, 3, 5, 6, 7, 8, 15, 15]);
  });
});
