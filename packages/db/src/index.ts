import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Micros } from "@ys/core";
import type { CostEntry, CostLedger } from "@ys/media-gateway";
import * as schema from "./schema.ts";

export { schema };

export function createDb(url: string) {
  return drizzle(postgres(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

export class DbCostLedger implements CostLedger {
  constructor(private readonly db: Db) {}

  async record(entry: CostEntry): Promise<void> {
    await this.db.insert(schema.costEntries).values({ ...entry, at: new Date(entry.at) });
  }

  async spent(episodeId: string): Promise<Micros> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${schema.costEntries.estimateMicros}), 0)` })
      .from(schema.costEntries)
      .where(and(eq(schema.costEntries.episodeId, episodeId), eq(schema.costEntries.cacheHit, false)));
    return Number(row?.total ?? 0);
  }
}
