import { describe, expect, it } from "vitest";
import type { ShotPlanOut } from "@ys/agents";
import {
  buildTimeline,
  estimateWordTimings,
  resolveShotTimes,
  SCENE_GAP_MS,
  toSrt,
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
  ambience: "dust" as const,
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
        { id: "a", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 1500, description: "", imagePrompt: "", motionPrompt: "", camera: "pan_left", ambience: "rain" },
        { id: "b", sceneId: "s1", kind: "ai_clip", startMs: 1500, endMs: 3400, description: "", imagePrompt: "", motionPrompt: "", camera: "static", ambience: "rain" },
      ],
      keyframes: { a: { key: "kf/a.png", mimeType: "image/png" }, b: { key: "kf/b.png", mimeType: "image/png" } },
      clips: { b: { key: "clip/b.mp4", mimeType: "video/mp4", durationSec: 5 } },
    };

    const tl = buildTimeline(state, (k) => `assets/${k}`);
    expect(tl.durationInFrames).toBe(102);
    expect(tl.visuals).toMatchObject([
      { shotId: "a", kind: "still_motion", fromFrame: 0, durationInFrames: 45, assetUrl: "assets/kf/a.png", motion: { panX: -1 }, ambience: "rain" },
      // Gerçek klibin üstüne atmosfer çizilmez.
      { shotId: "b", kind: "ai_clip", fromFrame: 45, durationInFrames: 57, assetUrl: "assets/clip/b.mp4", playbackRate: 1, ambience: "none" },
    ]);
    expect(tl.audio).toEqual([{ role: "voice", assetUrl: "assets/voice/s1.mp3", fromFrame: 0, durationInFrames: 90, volume: 1 }]);
    expect(tl.captions.map((c) => c.text)).toEqual(["merhaba", "dünya"]);
  });
});

describe("toSrt", () => {
  const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

  it("kelimeleri satıra toplar: cümle sonu, uzun sessizlik, 8 kelime ve 3,5 sn yeni satır açar", () => {
    const words = [
      w("Merhaba", 0, 400),
      w("dünya.", 450, 900),
      w("Sonra", 1000, 1300),
      w("sessizlik", 2500, 2900),
      ...Array.from({ length: 9 }, (_, i) => w(`k${i}`, 3000 + i * 300, 3250 + i * 300)),
      w("uzun", 5800, 6000),
      w("süre", 9000, 9600),
    ];
    const cues = toSrt(words).trimEnd().split("\n\n");
    expect(cues[0]).toBe("1\n00:00:00,000 --> 00:00:00,900\nMerhaba dünya.");
    // Uzun sessizlik yeni satır açar.
    expect(cues[1]).toBe("2\n00:00:01,000 --> 00:00:01,300\nSonra");
    // En çok 8 kelime.
    expect(cues[2]!.split("\n")[2]).toBe("sessizlik k0 k1 k2 k3 k4 k5 k6");
    // 3,5 sn'yi aşan satır bölünür.
    expect(cues.at(-1)).toBe(`${cues.length}\n00:00:09,000 --> 00:00:09,600\nsüre`);
  });

  it("saat basamağı ve boş liste", () => {
    expect(toSrt([w("geç", 3_725_004, 3_726_000)])).toBe("1\n01:02:05,004 --> 01:02:06,000\ngeç\n");
    expect(toSrt([])).toBe("");
  });
});
