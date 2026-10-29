import type { CastOut, MotionMode, ScriptOut, ShotPlanOut, StoryOut, StyleBibleOut } from "@ys/agents";
import type { BudgetTier, Timeline, WordTiming } from "@ys/core";

export type { MotionMode };

export const STAGES = [
  "style",
  "story",
  "script",
  "cast",
  "concept",
  "voice",
  "shots",
  "keyframes",
  "clips",
  "timeline",
  "render",
] as const;
export type Stage = (typeof STAGES)[number];

/** İnsan onayı gerektiren noktalar ve onaydan sonra açılan ilk aşama. */
export const GATES = {
  script: "cast",
  concept: "voice",
} as const satisfies Record<string, Stage>;
export type Gate = keyof typeof GATES;

export interface EpisodeInput {
  topic: string;
  lang: string;
  targetSec: number;
  tier: BudgetTier;
  styleHint?: string;
  /** animated: her çekim AI video · mixed: aiClipRatio kadarı · still: sadece hareketlendirilmiş resim. */
  motionMode?: MotionMode;
  /** mixed modda AI video oranı. */
  aiClipRatio: number;
  /** Bölüm harcama tavanı (USD). */
  budgetUsd: number;
  /** TTS ses kimliği (sağlayıcıya özgü). */
  voiceId?: string;
  /** true: onay kapılarında durma (CLI varsayılanı). Stüdyo false kullanır. */
  autoApprove?: boolean;
  width: number;
  height: number;
  fps: number;
}

export interface SceneVoice {
  key: string;
  mimeType: string;
  durationMs: number;
  /** Sahne içi kelime zamanlamaları (sahne başına göre). */
  words: WordTiming[];
  /** true: sağlayıcı zamanlama vermedi, harf sayısına göre tahmin edildi. */
  estimatedTiming: boolean;
}

export interface PlannedShotState {
  id: string;
  sceneId: string;
  kind: "still_motion" | "ai_clip";
  /** Bölüm başına göre. */
  startMs: number;
  endMs: number;
  description: string;
  imagePrompt: string;
  motionPrompt: string;
  camera: "push_in" | "pull_out" | "pan_left" | "pan_right" | "static";
  characterIds?: string[];
  locationId?: string;
}

export interface AssetRef {
  key: string;
  mimeType: string;
}

export interface ConceptState {
  /** Karakter/mekân kimliği → aday görseller. */
  candidates: Record<string, AssetRef[]>;
  /** Karakter/mekân kimliği → seçilen referans görsel. */
  selected: Record<string, AssetRef>;
  /** Kaçıncı aday turu (yeniden üretimlerde seed değişsin diye). */
  round?: number;
  /** Seçilen referanslarla üretilmiş deneme kareleri. */
  previews?: (AssetRef & { caption: string })[];
}

export interface EpisodeState {
  id: string;
  createdAt: string;
  input: EpisodeInput;
  done: Partial<Record<Stage, string>>;
  approvals?: Partial<Record<Gate, string>>;
  /** Pipeline bir onay kapısında durduysa hangisi. */
  waitingFor?: Gate;
  agentCostUsd: number;
  style?: StyleBibleOut;
  story?: StoryOut;
  script?: ScriptOut;
  cast?: CastOut;
  concept?: ConceptState;
  voice?: Record<string, SceneVoice>;
  shotPlan?: ShotPlanOut;
  shots?: PlannedShotState[];
  keyframes?: Record<string, AssetRef>;
  clips?: Record<string, AssetRef & { durationSec: number }>;
  timeline?: Timeline;
  render?: { path: string; at: string };
}

/** Bu aşamaya geçmek için gereken onay (varsa). */
export function gateBefore(stage: Stage): Gate | undefined {
  return (Object.keys(GATES) as Gate[]).find((g) => GATES[g] === stage);
}

export function isApproved(state: EpisodeState, gate: Gate): boolean {
  return Boolean(state.input.autoApprove || state.approvals?.[gate]);
}

export function motionModeOf(input: EpisodeInput): MotionMode {
  return input.motionMode ?? (input.aiClipRatio > 0 ? "mixed" : "still");
}
