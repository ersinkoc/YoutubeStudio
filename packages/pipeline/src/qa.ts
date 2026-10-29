import type { FrameReviewOut } from "@ys/agents";
import type { FrameQa } from "./state.ts";

/** Bu sorunlardan biri varsa kare puanından bağımsız olarak yeniden çizilir. */
export const BLOCKING_ISSUES = new Set(["text", "panels", "duplicate_character", "wrong_character"]);
/** Bu puanın altındaki kareler yeniden çizilir. */
export const QA_MIN_SCORE = 7;
/** Claude görsel sınırı 5 MB (base64); büyük kareler denetlenmeden geçer. */
export const QA_MAX_BYTES = 3_500_000;

export function judgeFrame(out: FrameReviewOut, attempt: number): FrameQa {
  const passed = out.score >= QA_MIN_SCORE && !out.issues.some((i) => BLOCKING_ISSUES.has(i.type));
  return { score: out.score, issues: out.issues, attempts: attempt, passed, fix: out.fix || undefined };
}

/** Denemeler arasında seçim: geçen kare her zaman önde, sonra puan. Denetimsiz kare en geride. */
export function frameRank(qa: FrameQa | undefined): number {
  if (!qa) return -1;
  return (qa.passed ? 100 : 0) + qa.score;
}

/** Yeniden çizim prompt'u: denetçinin önerisi ve bulduğu sorunlar asıl prompt'a eklenir. */
export function redrawPrompt(imagePrompt: string, qa: FrameQa): string {
  const avoid = qa.issues.map((i) => i.detail).filter(Boolean);
  return [imagePrompt, qa.fix, avoid.length ? `Avoid: ${avoid.join("; ")}` : ""].filter(Boolean).join(". ");
}
