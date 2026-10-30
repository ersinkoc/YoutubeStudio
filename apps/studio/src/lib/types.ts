import type { CostGroup, Quota } from "@ys/media-gateway";
import type { EpisodeEstimate, EpisodeState, MotionMode, Progress, RunStatus, Stage } from "@ys/pipeline/light";

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
  /** Ücretli API harcaması (bütçe tavanına sayılan). */
  spentUsd: number;
  /** Claude ajan çağrıları: tavana sayılmaz, ayrıca gösterilir. */
  claudeUsd: number;
  estimates: Record<MotionMode, EpisodeEstimate>;
  /** Defterden aşama ve sağlayıcı bazında gerçekleşen. */
  actual: { byStage: CostGroup[]; byProvider: CostGroup[] };
  progress: Progress | null;
  /** Tek bakışta durum; Stüdyo'nun kendi işi sürüyorsa her zaman "running". */
  status: { status: RunStatus; stage?: Stage };
  quota: QuotaView | null;
}
