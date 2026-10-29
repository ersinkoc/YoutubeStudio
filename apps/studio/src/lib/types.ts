import type { CostGroup, Quota } from "@ys/media-gateway";
import type { EpisodeEstimate, EpisodeState, MotionMode, Progress } from "@ys/pipeline/light";

/** Sunucu ile istemci arasında paylaşılan yanıt tipleri (sadece tip; çalışma anı kodu yok). */

export interface JobView {
  label: string;
  status: "running" | "done" | "error";
  log: string[];
  startedAt: string;
  endedAt?: string;
}

export interface QuotaView {
  providerId: string;
  quota: Quota;
  /** Kalan aşamalar için gereken miktar (karakter). */
  needed: number;
}

export interface EpisodeResponse {
  state: EpisodeState;
  job: JobView | null;
  spentUsd: number;
  estimates: Record<MotionMode, EpisodeEstimate>;
  /** Defterden aşama ve sağlayıcı bazında gerçekleşen. */
  actual: { byStage: CostGroup[]; byProvider: CostGroup[] };
  progress: Progress | null;
  quota: QuotaView | null;
}
