import { BudgetTier, LineStyle, STYLE_AUTO, STYLE_CUSTOM, stylePackOf } from "@ys/core";
import { cleanSeries, newEpisodeState, type MotionMode } from "@ys/pipeline/light";
import { msg } from "@ys/core/messages";
import { apiError } from "../../../lib/api";
import { repo, startJob } from "../../../lib/server";

export async function GET() {
  const episodes = await repo().list();
  return Response.json(
    episodes.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      topic: e.input.topic,
      title: e.story?.title,
      lang: e.input.lang,
      done: Object.keys(e.done),
      waitingFor: e.waitingFor,
      hasVideo: Boolean(e.render),
    })),
  );
}

interface CreateBody {
  topic: string;
  lang: string;
  minutes: number;
  tier: string;
  motionMode: MotionMode;
  voiceId?: string;
  styleHint?: string;
  budgetUsd: number;
  vertical?: boolean;
  qa?: boolean;
  realism?: boolean;
  sideViews?: boolean;
  lineStyle?: string;
  stylePack?: string;
  series?: string;
}

/** Bölümü oluşturur ve senaryo üretimini hemen başlatır (stil → hikâye → senaryo, sonra onay bekler). */
export async function POST(req: Request) {
  const body = (await req.json()) as CreateBody;
  if (typeof body.topic !== "string" || !body.topic.trim()) return apiError(req, msg("api.topic"));
  const minutes = Number(body.minutes ?? 3);
  const budget = Number(body.budgetUsd ?? 20);
  if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 30) return apiError(req, msg("api.minutes"));
  if (!Number.isFinite(budget) || budget <= 0) return apiError(req, msg("api.budget"));
  const motionMode = (["animated", "mixed", "still", "vector"] as const).find((m) => m === body.motionMode) ?? "animated";
  const lang = typeof body.lang === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.lang) ? body.lang : "tr";
  const state = newEpisodeState({
    topic: body.topic.trim(),
    lang,
    targetSec: Math.round(minutes * 60),
    tier: BudgetTier.catch("standard").parse(body.tier),
    motionMode,
    aiClipRatio: 0.2,
    budgetUsd: budget,
    voiceId: typeof body.voiceId === "string" && body.voiceId ? body.voiceId : undefined,
    styleHint: typeof body.styleHint === "string" ? body.styleHint.trim().slice(0, 300) || undefined : undefined,
    autoApprove: false,
    qa: body.qa !== false,
    realism: body.realism !== false,
    sideViews: body.sideViews === true,
    // Boş: stil paketinin çizgi stili.
    lineStyle: body.lineStyle ? LineStyle.optional().catch(undefined).parse(body.lineStyle) : undefined,
    series: typeof body.series === "string" ? cleanSeries(body.series) : undefined,
    stylePack: body.stylePack === STYLE_CUSTOM || stylePackOf(body.stylePack) ? body.stylePack : STYLE_AUTO,
    width: body.vertical ? 1080 : 1920,
    height: body.vertical ? 1920 : 1080,
    fps: 30,
  });
  await repo().save(state);
  startJob(state.id, "job.script", ["episode", "run", state.id, "--until", "script"]);
  return Response.json({ id: state.id });
}
