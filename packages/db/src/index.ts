import { and, asc, eq, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Capability, Micros } from "@ys/core";
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
      // Claude ajan çağrıları ("llm") bütçe tavanına sayılmaz.
      .where(and(eq(schema.costEntries.episodeId, episodeId), eq(schema.costEntries.cacheHit, false), ne(schema.costEntries.capability, "llm")));
    return Number(row?.total ?? 0);
  }

  async list(episodeId?: string): Promise<CostEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.costEntries)
      .where(episodeId ? eq(schema.costEntries.episodeId, episodeId) : undefined)
      .orderBy(asc(schema.costEntries.at));
    return rows.map((r) => ({
      at: r.at.toISOString(),
      episodeId: r.episodeId ?? undefined,
      stage: r.stage ?? undefined,
      refId: r.refId ?? undefined,
      providerId: r.providerId,
      capability: r.capability as Capability,
      estimateMicros: r.estimateMicros,
      cacheHit: r.cacheHit,
      requestHash: r.requestHash,
      durationMs: r.durationMs ?? undefined,
      units: r.units ?? undefined,
      unitLabel: r.unitLabel ?? undefined,
      error: r.error ?? undefined,
    }));
  }
}
