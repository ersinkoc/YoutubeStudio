import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableConfig } from "drizzle-orm/pg-core";
import { usd } from "@ys/core";
import { createDb, DbCostLedger, schema, type Db } from "../src/index.ts";

/**
 * Veritabanı olmadan DbCostLedger testi: drizzle'a sahte bir postgres-js istemcisi verilir; üretilen SQL ve
 * parametreler kaydedilir, sorgu sonuçları elle verilir (sütun sırasıyla dizi satırlar).
 */
function fakeClient(rowsFor: (query: string) => unknown[][] = () => []) {
  const queries: { query: string; params: unknown[] }[] = [];
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ query, params });
      const rows = rowsFor(query);
      const result = Promise.resolve(rows) as Promise<unknown[][]> & { values(): Promise<unknown[][]> };
      result.values = () => Promise.resolve(rows);
      return result;
    },
  };
  const db = drizzle(client as never, { schema }) as unknown as Db;
  return { db, queries };
}

describe("DbCostLedger", () => {
  it("kaydı tarih nesnesiyle cost_entries tablosuna ekler", async () => {
    const { db, queries } = fakeClient();
    await new DbCostLedger(db).record({
      at: "2026-10-30T10:00:00.000Z",
      episodeId: "e1",
      providerId: "fal:flux-dev",
      capability: "t2i",
      estimateMicros: usd(0.025),
      cacheHit: false,
      requestHash: "h",
      units: 1,
      unitLabel: "görsel",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toMatch(/^insert into "cost_entries"/);
    expect(queries[0]!.params).toEqual(
      expect.arrayContaining(["2026-10-30T10:00:00.000Z", "e1", "fal:flux-dev", "t2i", 25_000, false, "h", 1, "görsel"]),
    );
  });

  it("harcama: bölüm, önbellek dışı ve llm hariç filtreler; toplamı sayıya çevirir", async () => {
    const { db, queries } = fakeClient(() => [["1525000"]]);
    expect(await new DbCostLedger(db).spent("e1")).toBe(1_525_000);
    expect(queries[0]!.query).toBe(
      'select coalesce(sum("estimate_micros"), 0) from "cost_entries" where ("cost_entries"."episode_id" = $1 and "cost_entries"."cache_hit" = $2 and "cost_entries"."capability" <> $3)',
    );
    expect(queries[0]!.params).toEqual(["e1", false, "llm"]);
  });

  it("harcama: satır dönmezse 0", async () => {
    const { db } = fakeClient(() => []);
    expect(await new DbCostLedger(db).spent("e1")).toBe(0);
  });

  it("liste: satırları CostEntry'ye çevirir; null alanlar undefined olur", async () => {
    const columns = getTableConfig(schema.costEntries).columns.map((c) => c.name);
    const row = (over: Record<string, unknown>) => {
      const full: Record<string, unknown> = {
        id: 1,
        at: "2026-10-30 10:00:00+00",
        episode_id: null,
        stage: null,
        provider_id: "p",
        capability: "tts",
        estimate_micros: 0,
        actual_micros: null,
        cache_hit: true,
        request_hash: "h",
        ref_id: null,
        duration_ms: null,
        units: null,
        unit_label: null,
        error: null,
        ...over,
      };
      return columns.map((c) => full[c]);
    };
    const { db, queries } = fakeClient(() => [
      row({}),
      row({
        id: 2,
        at: "2026-10-30 11:00:00+00",
        episode_id: "e1",
        stage: "voice",
        ref_id: "s1",
        estimate_micros: 3000,
        cache_hit: false,
        duration_ms: 4200,
        units: 812,
        unit_label: "karakter",
        error: "kota doldu",
      }),
    ]);
    const ledger = new DbCostLedger(db);
    const rows = await ledger.list();
    expect(rows).toEqual([
      {
        at: "2026-10-30T10:00:00.000Z",
        episodeId: undefined,
        stage: undefined,
        refId: undefined,
        providerId: "p",
        capability: "tts",
        estimateMicros: 0,
        cacheHit: true,
        requestHash: "h",
        durationMs: undefined,
        units: undefined,
        unitLabel: undefined,
        error: undefined,
      },
      {
        at: "2026-10-30T11:00:00.000Z",
        episodeId: "e1",
        stage: "voice",
        refId: "s1",
        providerId: "p",
        capability: "tts",
        estimateMicros: 3000,
        cacheHit: false,
        requestHash: "h",
        durationMs: 4200,
        units: 812,
        unitLabel: "karakter",
        error: "kota doldu",
      },
    ]);
    // Bölümsüz listede where yok, zamana göre sıralı.
    expect(queries[0]!.query).not.toContain("where");
    expect(queries[0]!.query).toMatch(/order by "cost_entries"\."at" asc$/);

    await ledger.list("e1");
    expect(queries[1]!.query).toContain('where "cost_entries"."episode_id" = $1');
    expect(queries[1]!.params).toEqual(["e1"]);
  });
});

describe("createDb", () => {
  it("bağlantı açmadan drizzle örneği kurar (postgres-js tembel bağlanır)", async () => {
    const db = createDb("postgres://kullanici:sifre@127.0.0.1:1/yok");
    expect(typeof db.select).toBe("function");
    expect(db.$client.options.host).toEqual(["127.0.0.1"]);
    await db.$client.end();
  });
});

describe("şema", () => {
  it("yabancı anahtarlar ve indeksler tanımlı", () => {
    const fks = (t: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(t).foreignKeys.map((fk) => {
        const r = fk.reference();
        return `${r.columns.map((c) => c.name).join()}->${getTableConfig(r.foreignTable).name}.${r.foreignColumns.map((c) => c.name).join()}`;
      });
    expect(fks(schema.characters)).toEqual(["channel_id->channels.id"]);
    expect(fks(schema.episodes)).toEqual(["channel_id->channels.id"]);
    expect(fks(schema.assets)).toEqual(["episode_id->episodes.id"]);
    expect(getTableConfig(schema.assets).indexes.map((i) => i.config.name)).toEqual(["assets_episode_idx", "assets_hash_idx"]);
    expect(getTableConfig(schema.costEntries).indexes.map((i) => i.config.name)).toEqual(["cost_episode_idx"]);
    expect(getTableConfig(schema.providerPrices).primaryKeys).toEqual([]);
    expect(getTableConfig(schema.providerPrices).columns.find((c) => c.name === "provider_id")?.primary).toBe(true);
  });
});
