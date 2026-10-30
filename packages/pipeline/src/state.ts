import type { CastOut, LessonTarget, MotionMode, ScriptOut, ShotPlanOut, StoryOut, StyleBibleOut } from "@ys/agents";
import type { Ambience, AssetCheck, BudgetTier, FlagSpec, LineStyle, MapSpec, Timeline, VectorShot, WordTiming } from "@ys/core";

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
  /** Render sonrası inceleme: kareler denetlenir, dersler kalıcı deftere yazılır. */
  "review",
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
  /** Vektör modunda çizgi stili (kalın kontur, konturksuz, el çizimi, mürekkep). */
  lineStyle?: LineStyle;
  /** Kare kalite kontrolü (görsel model). Varsayılan açık; false ile kapatılır. */
  qa?: boolean;
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
  /** Eski planlarda yok; yoksa "none". */
  ambience?: Ambience;
  /** Vektör modunda sahne tarifi; varsa kare/klip üretilmez. */
  vector?: VectorShot;
  characterIds?: string[];
  locationId?: string;
}

export interface EpisodeReview {
  at: string;
  shots: Record<string, { score: number; issues: { type: string; detail: string }[] }>;
  /** Bu incelemede çıkan genel kurallar (deftere de yazılır). */
  lessons: { target: LessonTarget; rule: string }[];
}

export interface FrameQa {
  score: number;
  issues: { type: string; detail: string }[];
  /** Kaç kez çizildi (1 = ilk deneme kabul edildi). */
  attempts: number;
  passed: boolean;
  /** Denetçinin yeniden çizim için önerisi. */
  fix?: string;
  /** Denetim yapılamadıysa nedeni (ajan hatası, görsel çok büyük…). */
  skipped?: string;
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

/** Bir aşamanın son çalışmasının zamanlaması (maliyet, defterden aşamaya göre toplanır). */
export interface StageStat {
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

/** Bölüm günlüğünün bir satırı; CLI'dan da Stüdyo'dan da çalışsa kalıcıdır. */
export interface ActivityEntry {
  at: string;
  stage?: Stage;
  level: "stage" | "info" | "warn" | "error";
  msg: string;
}

/** Durumda tutulan günlük satırı sınırı (state.json büyümesin). */
export const ACTIVITY_LIMIT = 400;

export interface EpisodeError {
  stage: Stage;
  message: string;
  at: string;
}

export interface EpisodeState {
  id: string;
  createdAt: string;
  input: EpisodeInput;
  done: Partial<Record<Stage, string>>;
  stats?: Partial<Record<Stage, StageStat>>;
  /** Pipeline'ın son kaydı; çalışan bir aşama uzun süre güncellenmezse süreç düşmüş demektir. */
  heartbeatAt?: string;
  /** Son günlük satırları (en yeni sonda). */
  activity?: ActivityEntry[];
  /** Render ilerlemesi (0–100); sadece render sürerken anlamlı. */
  renderPct?: number;
  /** Son başarısız aşama; stüdyo sunucusu yeniden başlasa da görünür kalsın diye durumda tutulur. */
  lastError?: EpisodeError;
  /** Bölümün anlatıcı sesini üreten sağlayıcı; sahneler arasında ses karışmasın diye sabitlenir. */
  voiceProviderId?: string;
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
  /** İnceleme aşamasının çekim kareleri (stüdyo küçük resmi de bunlar). */
  stills?: Record<string, AssetRef>;
  /** Render sonrası inceleme sonucu. */
  review?: EpisodeReview;
  /** Render öncesi taslak kontrolü: ortalama puan ve yeniden planlanan sahneler. */
  draftReview?: EpisodeReview & { avg: number; revisedScenes: string[] };
  /** Senaryo doktorunun düzelttiği sorunlar (bölümler arası öğrenme için saklanır). */
  scriptNotes?: string[];
  /** Vektör modunda çekimlerin kullandığı nesneler: kimlik → tarif ve çizildiyse SVG anahtarı. */
  vectorProps?: Record<
    string,
    { description: string; key?: string; kind?: "prop" | "background"; map?: MapSpec; flag?: FlagSpec; reference?: string }
  >;
  /** Kalite kapısı sonuçları (varlık anahtarı → sonuç); reddedilenler de görünür. */
  assetChecks?: Record<string, AssetCheck>;
  /** Elle istenen yeniden çizim sayısı (çekim başına); seed olarak kullanılır. */
  redraws?: Record<string, number>;
  /** Çekim başına kare denetimi sonucu. */
  qa?: Record<string, FrameQa>;
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
