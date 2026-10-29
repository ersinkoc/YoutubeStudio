import { logger, metadata, task } from "@trigger.dev/sdk";
import { STAGES, type Stage } from "@ys/pipeline";
import { getPipeline } from "./context.ts";

export interface RunEpisodePayload {
  episodeId: string;
  until?: Stage;
  from?: Stage;
}

/**
 * Bir bölümü kaldığı yerden sürdürür. Aşamalar idempotent olduğu için yeniden deneme
 * tamamlanmış işleri tekrar ödemez (durum + içerik hash önbelleği).
 * İlerleme `metadata` ile Stüdyo'ya canlı akar.
 */
export const runEpisode = task({
  id: "run-episode",
  queue: { concurrencyLimit: 2 },
  run: async (payload: RunEpisodePayload, { signal }) => {
    const pipeline = getPipeline((m) => {
      logger.info(m);
      const stage = STAGES.find((s) => m === `▶ ${s}`);
      if (stage) metadata.set("stage", stage).set("stageIndex", STAGES.indexOf(stage));
      else metadata.set("lastLog", m);
    });
    const state = await pipeline.run(payload.episodeId, { until: payload.until, from: payload.from, signal });
    return {
      episodeId: state.id,
      done: Object.keys(state.done),
      agentCostUsd: state.agentCostUsd,
      video: state.render?.path,
    };
  },
});
