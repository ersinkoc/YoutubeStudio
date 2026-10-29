import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { usd } from "@ys/core";
import { S3AssetStore } from "@ys/storage";
import { createDb, DbCostLedger } from "../src/index.ts";

// Sadece `pnpm test:integration` ile (docker compose ayaktayken) çalışır.
const mode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
const run = mode === "integration" ? describe : describe.skip;

run("entegrasyon: Postgres + RustFS", () => {
  it("DbCostLedger kayıt eder ve önbellek isabetlerini harcamaya saymaz", async () => {
    const db = createDb(process.env.DATABASE_URL ?? "postgres://ys:ys@localhost:5433/youtube_studio");
    const ledger = new DbCostLedger(db);
    const episodeId = `test-${randomUUID()}`;
    const base = { providerId: "fal:flux-dev", capability: "t2i" as const, requestHash: "h" };
    await ledger.record({ ...base, at: new Date().toISOString(), episodeId, estimateMicros: usd(0.025), cacheHit: false });
    await ledger.record({ ...base, at: new Date().toISOString(), episodeId, estimateMicros: 0, cacheHit: true });
    await ledger.record({ ...base, at: new Date().toISOString(), episodeId, estimateMicros: usd(1.5), cacheHit: false });
    expect(await ledger.spent(episodeId)).toBe(usd(1.525));
    await db.$client.end();
  });

  it("S3AssetStore RustFS'e yazar ve okur", async () => {
    const store = new S3AssetStore({
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      region: "auto",
      bucket: process.env.S3_BUCKET ?? "ys-assets",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "ysrustfs",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "ysrustfs-secret",
    });
    await store.ensureBucket();
    const key = `test/${randomUUID()}.bin`;
    const uri = await store.put(key, new Uint8Array([1, 2, 3]), "application/octet-stream");
    expect(uri).toContain(key);
    expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get(`test/${randomUUID()}`)).toBeNull();
  });
});
