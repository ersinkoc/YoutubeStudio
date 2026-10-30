import { BudgetTier } from "@ys/core";
import { estimateEpisode, newEpisodeState, type MotionMode } from "@ys/pipeline/light";
import { estimateContext } from "../../../lib/server";

interface Body {
  lang?: string;
  minutes?: number;
  tier?: string;
  motionMode?: MotionMode;
  voiceId?: string;
  budgetUsd?: number;
  vertical?: boolean;
  qa?: boolean;
}

/** Yeni bölüm formu için canlı tahmin: henüz oluşturulmamış bir bölümün üç hareket modundaki maliyet ve süresi. */
export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  const state = newEpisodeState({
    topic: "tahmin",
    lang: b.lang || "tr",
    targetSec: Math.round((b.minutes || 3) * 60),
    tier: BudgetTier.catch("standard").parse(b.tier),
    motionMode: b.motionMode ?? "animated",
    aiClipRatio: 0.2,
    budgetUsd: b.budgetUsd || 20,
    voiceId: b.voiceId || undefined,
    qa: b.qa !== false,
    width: b.vertical ? 1080 : 1920,
    height: b.vertical ? 1920 : 1080,
    fps: 30,
  });
  const ctx = await estimateContext();
  return Response.json(
    Object.fromEntries((["animated", "mixed", "still", "vector"] as const).map((m) => [m, estimateEpisode(state, ctx, m)])),
  );
}
