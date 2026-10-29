import { groupCosts } from "@ys/media-gateway";
import { estimateEpisode, motionModeOf, progressOf, type MotionMode } from "@ys/pipeline/light";
import { episodeSpentUsd, estimateContext, getJob, ledgerEntries, quotaOf, repo } from "../../../../lib/server";
import type { EpisodeResponse, QuotaView } from "../../../../lib/types";

const MODES: MotionMode[] = ["animated", "mixed", "still"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const [state, entries, estimateCtx] = await Promise.all([repo().load(id), ledgerEntries(id), estimateContext()]);
    const estimates = Object.fromEntries(MODES.map((m) => [m, estimateEpisode(state, estimateCtx, m)])) as EpisodeResponse["estimates"];

    // Ses henüz bitmediyse kullanılacak sağlayıcının kotası yetiyor mu?
    let quota: QuotaView | null = null;
    if (!state.done.voice) {
      const row = estimates[motionModeOf(state.input)].rows.find((r) => r.stage === "voice");
      const providerId = state.voiceProviderId ?? row?.providerId;
      const q = providerId ? await quotaOf(providerId) : undefined;
      if (providerId && q && row) {
        const voiced = new Set(Object.keys(state.voice ?? {}));
        const needed =
          state.script?.scenes.filter((s) => !voiced.has(s.id)).reduce((n, s) => n + s.narration.length, 0) ?? row.quantity;
        quota = { providerId, quota: q, needed };
      }
    }

    const body: EpisodeResponse = {
      state,
      job: getJob(id) ?? null,
      spentUsd: await episodeSpentUsd(id),
      estimates,
      actual: {
        byStage: groupCosts(entries, (e) => e.stage ?? "—"),
        byProvider: groupCosts(entries, (e) => e.providerId),
      },
      progress: progressOf(state) ?? null,
      quota,
    };
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
