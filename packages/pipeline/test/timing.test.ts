import { describe, expect, it } from "vitest";
import type { ShotPlanOut } from "@ys/agents";
import {
  buildTimeline,
  estimateWordTimings,
  resolveShotTimes,
  SCENE_GAP_MS,
  type EpisodeState,
  type SceneVoice,
} from "../src/index.ts";

const voiceFor = (text: string, durationMs: number, key = "v.mp3"): SceneVoice => ({
  key,
  mimeType: "audio/mpeg",
  durationMs,
  words: estimateWordTimings(text, durationMs),
  estimatedTiming: true,
});

const shot = (startWord: number, kind: "still_motion" | "ai_clip" = "still_motion") => ({
  startWord,
  kind,
  characterIds: ["c1"],
  locationId: startWord === 0 ? "l1" : "",
  description: "d",
  imagePrompt: "p",
  motionPrompt: "m",
  camera: "push_in" as const,
});

describe("estimateWordTimings", () => {
  it("süreyi harf ağırlığıyla bölüştürür, boşluk bırakmaz", () => {
    const w = estimateWordTimings("a bbb", 1000);
    expect(w).toEqual([
      { text: "a", startMs: 0, endMs: 333 },
      { text: "bbb", startMs: 333, endMs: 1000 },
    ]);
  });
});

describe("resolveShotTimes", () => {
  const voice = {
    s1: voiceFor("bir iki üç dört", 4000, "s1.mp3"),
    s2: voiceFor("beş altı", 2000, "s2.mp3"),
  };

  it("kelime indekslerini mutlak zamana çevirir, sahneleri boşlukla ardışık dizer", () => {
    const plan: ShotPlanOut = {
      scenes: [
        { sceneId: "s1", shots: [shot(0), shot(2, "ai_clip")] },
        { sceneId: "s2", shots: [shot(0)] },
      ],
    };
    const shots = resolveShotTimes(plan, ["s1", "s2"], voice);
    expect(shots.map((s) => [s.id, s.startMs, s.endMs, s.kind])).toEqual([
      ["s1-sh1", 0, voice.s1.words[2]!.startMs, "still_motion"],
      ["s1-sh2", voice.s1.words[2]!.startMs, 4000 + SCENE_GAP_MS, "ai_clip"],
      ["s2-sh1", 4000 + SCENE_GAP_MS, 4000 + SCENE_GAP_MS + 2000 + SCENE_GAP_MS, "still_motion"],
    ]);
    // Referans görseller için kadro etiketleri taşınır; boş mekân kimliği "yok" demektir.
    expect(shots[0]).toMatchObject({ characterIds: ["c1"], locationId: "l1" });
    expect(shots[1]!.locationId).toBeUndefined();
  });

  it("bozuk indeksleri düzeltir: ilk çekim 0'dan başlar, tekrar eden/aralık dışı indeks düşer", () => {
    const plan: ShotPlanOut = { scenes: [{ sceneId: "s2", shots: [shot(5), shot(1), shot(1), shot(99)] }] };
    const shots = resolveShotTimes(plan, ["s1", "s2"], voice);
    // s2'de 2 kelime var: sadece indeks 0 ve 1 kullanılabilir.
    expect(shots.map((s) => s.id)).toEqual(["s2-sh1", "s2-sh2"]);
    expect(shots[0]!.startMs).toBe(4000 + SCENE_GAP_MS);
    expect(shots.at(-1)!.endMs).toBe(4000 + SCENE_GAP_MS + 2000 + SCENE_GAP_MS);
  });
});

describe("buildTimeline", () => {
  it("çekim, ses ve altyazıları kare zamanına çevirir; klip varsa onu tercih eder", () => {
    const voice = { s1: voiceFor("merhaba dünya", 3000, "voice/s1.mp3") };
    const state: EpisodeState = {
      id: "ep",
      createdAt: "",
      done: {},
      agentCostUsd: 0,
      input: { topic: "t", lang: "tr", targetSec: 3, tier: "economy", aiClipRatio: 0, budgetUsd: 1, width: 1920, height: 1080, fps: 30 },
      script: { scenes: [{ id: "s1", beatId: "b1", narration: "merhaba dünya", visualIntent: "", emotion: "", location: "" }] },
      voice,
      shots: [
        { id: "a", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 1500, description: "", imagePrompt: "", motionPrompt: "", camera: "pan_left" },
        { id: "b", sceneId: "s1", kind: "ai_clip", startMs: 1500, endMs: 3400, description: "", imagePrompt: "", motionPrompt: "", camera: "static" },
      ],
      keyframes: { a: { key: "kf/a.png", mimeType: "image/png" }, b: { key: "kf/b.png", mimeType: "image/png" } },
      clips: { b: { key: "clip/b.mp4", mimeType: "video/mp4", durationSec: 5 } },
    };

    const tl = buildTimeline(state, (k) => `assets/${k}`);
    expect(tl.durationInFrames).toBe(102);
    expect(tl.visuals).toMatchObject([
      { shotId: "a", kind: "still_motion", fromFrame: 0, durationInFrames: 45, assetUrl: "assets/kf/a.png", motion: { panX: -1 } },
      { shotId: "b", kind: "ai_clip", fromFrame: 45, durationInFrames: 57, assetUrl: "assets/clip/b.mp4", playbackRate: 1 },
    ]);
    expect(tl.audio).toEqual([{ role: "voice", assetUrl: "assets/voice/s1.mp3", fromFrame: 0, durationInFrames: 90, volume: 1 }]);
    expect(tl.captions.map((c) => c.text)).toEqual(["merhaba", "dünya"]);
  });
});
