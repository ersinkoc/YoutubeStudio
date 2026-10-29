import { estimateCost } from "@ys/pipeline/light";
import { episodeSpentUsd, getJob, repo } from "../../../../lib/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const state = await repo().load(id);
    const castSize = (state.cast?.characters.length ?? 0) + (state.cast?.locations.length ?? 0) || undefined;
    return Response.json({
      state,
      job: getJob(id) ?? null,
      spentUsd: await episodeSpentUsd(id),
      // Hareket modu seçilirken üç seçeneğin maliyeti yan yana gösterilir.
      estimates: Object.fromEntries(
        (["animated", "mixed", "still"] as const).map((motionMode) => [
          motionMode,
          estimateCost({ ...state.input, motionMode }, { shots: state.shots?.length, castSize }),
        ]),
      ),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
