import { createDb, DbCostLedger } from "@ys/db";
import { createProvidersFromEnv, HealthTracker, JsonlLedger, MediaGateway, type CostLedger } from "@ys/media-gateway";
import { EpisodePipeline } from "@ys/pipeline";
import { createStoreFromEnv } from "@ys/storage";

let shared:
  | {
      store: ReturnType<typeof createStoreFromEnv>;
      ledger: CostLedger;
      providers: ReturnType<typeof createProvidersFromEnv>["providers"];
      health: HealthTracker;
    }
  | undefined;

/**
 * Her çalıştırmaya ayrı pipeline (günlük tamponu, aşama ve model seçimi örnek başına; aynı anda iki bölüm koşarsa
 * karışmasın). Depo, defter (DB bağlantısı), sağlayıcılar ve sağlık takibi süreç başına paylaşılır.
 */
export function getPipeline(log: (message: string) => void): EpisodePipeline {
  const env = process.env;
  shared ??= {
    store: createStoreFromEnv(env),
    ledger: env.LEDGER === "db" && env.DATABASE_URL ? new DbCostLedger(createDb(env.DATABASE_URL)) : new JsonlLedger(".data/ledger.jsonl"),
    providers: createProvidersFromEnv(env).providers,
    // Sağlayıcı sağlığı süreç boyunca ortak: bir çalıştırmada çöken sağlayıcı diğerinde de soğumada sayılır.
    health: new HealthTracker(),
  };
  const { store, ledger, providers, health } = shared;
  const gateway = new MediaGateway({ providers, store, ledger, health, log });
  return new EpisodePipeline({
    gateway,
    store,
    ledger,
    workDir: env.YS_WORK_DIR ?? ".data/episodes",
    log,
    agentDeps: { log },
  });
}
