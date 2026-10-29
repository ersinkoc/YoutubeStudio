import { createDb, DbCostLedger } from "@ys/db";
import { createProvidersFromEnv, JsonlLedger, MediaGateway, type CostLedger } from "@ys/media-gateway";
import { EpisodePipeline } from "@ys/pipeline";
import { createStoreFromEnv } from "@ys/storage";

let cached: EpisodePipeline | undefined;

/** Worker süreci başına tek pipeline; sağlık takibi ve DB bağlantısı task'lar arasında paylaşılır. */
export function getPipeline(log: (message: string) => void): EpisodePipeline {
  if (cached) return cached;
  const env = process.env;
  const store = createStoreFromEnv(env);
  const ledger: CostLedger =
    env.LEDGER === "db" && env.DATABASE_URL ? new DbCostLedger(createDb(env.DATABASE_URL)) : new JsonlLedger(".data/ledger.jsonl");
  const { providers } = createProvidersFromEnv(env);
  const gateway = new MediaGateway({ providers, store, ledger, log });
  cached = new EpisodePipeline({
    gateway,
    store,
    ledger,
    workDir: env.YS_WORK_DIR ?? ".data/episodes",
    log,
    agentDeps: { log },
  });
  return cached;
}
