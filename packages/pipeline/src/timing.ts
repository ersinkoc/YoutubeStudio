import type { ShotPlanOut } from "@ys/agents";
import type { Timeline, VectorAsset, VectorShot, WordTiming } from "@ys/core";
import type { EpisodeState, PlannedShotState, SceneVoice } from "./state.ts";
import { lineStyleOf } from "./state.ts";

/** Sahneler arasında bırakılan nefes payı. */
export const SCENE_GAP_MS = 400;

/**
 * Sağlayıcı kelime zamanlaması vermediğinde (Gemini TTS) harf sayısıyla orantılı tahmin.
 * Yerel WhisperX hizalaması gelene kadar altyazı ve kesim için yeterli doğrulukta.
 */
export function estimateWordTimings(text: string, durationMs: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return words.map((w, i) => {
    const len = (weights[i]! / total) * durationMs;
    const word = { text: w, startMs: Math.round(cursor), endMs: Math.round(cursor + len) };
    cursor += len;
    return word;
  });
}

/** Her sahnenin bölüm içindeki başlangıç zamanı (ms). */
export function sceneOffsets(sceneIds: string[], voice: Record<string, SceneVoice>): Record<string, number> {
  const offsets: Record<string, number> = {};
  let t = 0;
  for (const id of sceneIds) {
    offsets[id] = t;
    t += (voice[id]?.durationMs ?? 0) + SCENE_GAP_MS;
  }
  return offsets;
}

/**
 * Director'ın kelime indeksli planını mutlak zamanlara çevirir.
 * Çekim, başlangıç kelimesinin başladığı anda başlar; bir sonrakine kadar sürer.
 * Bozuk indeksler (azalan, aralık dışı) düzeltilir, plan reddedilmez.
 */
export function resolveShotTimes(
  plan: ShotPlanOut,
  sceneIds: string[],
  voice: Record<string, SceneVoice>,
): PlannedShotState[] {
  const offsets = sceneOffsets(sceneIds, voice);
  const shots: PlannedShotState[] = [];

  for (const sceneId of sceneIds) {
    const v = voice[sceneId];
    const planned = plan.scenes.find((s) => s.sceneId === sceneId)?.shots ?? [];
    if (!v || planned.length === 0) continue;
    const sceneStart = offsets[sceneId]!;
    const sceneEnd = sceneStart + v.durationMs + SCENE_GAP_MS;

    const kept: { startMs: number; shot: (typeof planned)[number] }[] = [];
    let lastIdx = -1;
    for (const [i, shot] of planned.entries()) {
      const idx = i === 0 ? 0 : Math.min(Math.max(shot.startWord, lastIdx + 1), v.words.length - 1);
      if (idx <= lastIdx) continue; // kelime kalmadı; bu çekimi düşür
      lastIdx = idx;
      // idx burada 0 < idx < words.length: kelime her zaman vardır.
      kept.push({ startMs: i === 0 ? sceneStart : sceneStart + v.words[idx]!.startMs, shot });
    }

    kept.forEach(({ startMs, shot }, i) => {
      shots.push({
        id: `${sceneId}-sh${i + 1}`,
        sceneId,
        kind: shot.kind,
        startMs,
        endMs: kept[i + 1]?.startMs ?? sceneEnd,
        description: shot.description,
        imagePrompt: shot.imagePrompt,
        motionPrompt: shot.motionPrompt,
        camera: shot.camera,
        ambience: shot.ambience,
        // Vektör modunda yönetmen sahne tarifini çekimle birlikte verir.
        ...("vector" in shot && shot.vector ? { vector: shot.vector as VectorShot } : {}),
        characterIds: shot.characterIds?.slice(0, 3),
        locationId: shot.locationId || undefined,
      });
    });
  }
  return shots;
}

const CAMERA_MOTION: Record<PlannedShotState["camera"], { zoomFrom: number; zoomTo: number; panX: number }> = {
  push_in: { zoomFrom: 1.0, zoomTo: 1.15, panX: 0 },
  pull_out: { zoomFrom: 1.15, zoomTo: 1.0, panX: 0 },
  pan_left: { zoomFrom: 1.12, zoomTo: 1.12, panX: -1 },
  pan_right: { zoomFrom: 1.12, zoomTo: 1.12, panX: 1 },
  static: { zoomFrom: 1.03, zoomTo: 1.06, panX: 0 },
};

/** Remotion'ın göreceği timeline. Varlık yolları render klasörünün public/ dizinine göreli. */
export function buildTimeline(
  state: EpisodeState,
  assetPath: (key: string) => string,
  vectorAssets: Record<string, VectorAsset> = {},
): Timeline {
  const { input, script, voice, shots, keyframes } = state;
  if (!script || !voice || !shots || !keyframes) throw new Error("Timeline için script, voice, shots, keyframes gerekli");

  const fps = input.fps;
  const toFrame = (ms: number) => Math.round((ms / 1000) * fps);
  const sceneIds = script.scenes.map((s) => s.id);
  const offsets = sceneOffsets(sceneIds, voice);
  const totalMs = shots.reduce((m, s) => Math.max(m, s.endMs), 0);

  const visuals: Timeline["visuals"] = shots.flatMap((shot): Timeline["visuals"] => {
    if (shot.vector) {
      const fromFrame = toFrame(shot.startMs);
      return [
        {
          shotId: shot.id,
          assetUrl: "",
          kind: "motion_graphic" as const,
          fromFrame,
          durationInFrames: Math.max(1, toFrame(shot.endMs) - fromFrame),
          ambience: shot.ambience ?? "none",
          vector: shot.vector,
          playbackRate: 1,
        },
      ];
    }
    const clip = state.clips?.[shot.id];
    const still = keyframes[shot.id];
    const asset = clip ?? still;
    if (!asset) return [];
    const fromFrame = toFrame(shot.startMs);
    const durationInFrames = Math.max(1, toFrame(shot.endMs) - fromFrame);
    return [
      {
        shotId: shot.id,
        assetUrl: assetPath(asset.key),
        kind: clip ? ("ai_clip" as const) : ("still_motion" as const),
        fromFrame,
        durationInFrames,
        motion: clip ? undefined : { type: "ken_burns" as const, ...CAMERA_MOTION[shot.camera] },
        // Gerçek klipte hareket zaten var; katman yalnız durağan karelere.
        ambience: clip ? ("none" as const) : (shot.ambience ?? "none"),
        // Klip çekimden kısaysa yavaşlatılır (en fazla 2 kat); uzunsa kırpılır.
        playbackRate: clip ? Math.min(1, Math.max(0.5, clip.durationSec / ((shot.endMs - shot.startMs) / 1000))) : 1,
      },
    ];
  });

  const audio: Timeline["audio"] = sceneIds.flatMap((id) => {
    const v = voice[id];
    if (!v) return [];
    return [
      {
        role: "voice" as const,
        assetUrl: assetPath(v.key),
        fromFrame: toFrame(offsets[id]!),
        durationInFrames: Math.max(1, toFrame(v.durationMs)),
        volume: 1,
      },
    ];
  });

  const captions = sceneIds.flatMap((id) =>
    (voice[id]?.words ?? []).map((w) => ({
      text: w.text,
      startMs: w.startMs + offsets[id]!,
      endMs: w.endMs + offsets[id]!,
    })),
  );

  return {
    episodeId: state.id,
    lang: input.lang,
    fps,
    width: input.width,
    height: input.height,
    durationInFrames: Math.max(1, toFrame(totalMs)),
    visuals,
    audio,
    captions,
    vectorAssets,
    palette: state.style?.palette ?? [],
    lineStyle: lineStyleOf(state),
  };
}

/**
 * İstenen klip süresi: çekimi kapsayan tam saniye, 3–15 sn. Kling v3 saniye başı faturalar; eski 5/10 sn yuvarlaması
 * 6 sn'lik çekime 10 sn ödetiyordu (31 Eki sağlayıcı incelemesi). Sağlayıcı kendi sınırına ayrıca sıkıştırır.
 */
export function clipSeconds(shotSec: number): number {
  return Math.min(15, Math.max(3, Math.ceil(shotSec - 1e-9)));
}
