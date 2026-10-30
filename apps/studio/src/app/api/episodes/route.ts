import { BudgetTier, LineStyle } from "@ys/core";
import { newEpisodeState, type MotionMode } from "@ys/pipeline/light";
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
  lineStyle?: string;
}

/** Bölümü oluşturur ve senaryo üretimini hemen başlatır (stil → hikâye → senaryo, sonra onay bekler). */
export async function POST(req: Request) {
  const body = (await req.json()) as CreateBody;
  if (!body.topic?.trim()) return Response.json({ error: "Konu gerekli" }, { status: 400 });
  const state = newEpisodeState({
    topic: body.topic.trim(),
    lang: body.lang || "tr",
    targetSec: Math.round((body.minutes || 3) * 60),
    tier: BudgetTier.parse(body.tier || "standard"),
    motionMode: body.motionMode ?? "animated",
    aiClipRatio: 0.2,
    budgetUsd: body.budgetUsd || 20,
    voiceId: body.voiceId || undefined,
    styleHint: body.styleHint?.trim() || undefined,
    autoApprove: false,
    qa: body.qa !== false,
    realism: body.realism !== false,
    lineStyle: LineStyle.catch("outline").parse(body.lineStyle),
    width: body.vertical ? 1080 : 1920,
    height: body.vertical ? 1920 : 1080,
    fps: 30,
  });
  await repo().save(state);
  startJob(state.id, "Senaryo yazılıyor", ["episode", "run", state.id, "--until", "script"]);
  return Response.json({ id: state.id });
}
