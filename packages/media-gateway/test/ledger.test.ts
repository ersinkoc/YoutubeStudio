import { describe, expect, it } from "vitest";
import { InMemoryLedger, type CostEntry } from "../src/index.ts";

const entry = (patch: Partial<CostEntry>): CostEntry => ({
  at: "2026-10-30T00:00:00Z",
  episodeId: "e1",
  providerId: "fal:kling",
  capability: "i2v",
  estimateMicros: 1_000_000,
  cacheHit: false,
  requestHash: "h",
  ...patch,
});

describe("bütçe tavanına sayılan harcama", () => {
  it("ücretli API'leri sayar; Claude ajan çağrıları, önbellek ve başka bölümler sayılmaz", async () => {
    const ledger = new InMemoryLedger();
    await ledger.record(entry({}));
    await ledger.record(entry({ providerId: "claude:claude-opus-5-5", capability: "llm", estimateMicros: 5_000_000 }));
    await ledger.record(entry({ cacheHit: true }));
    await ledger.record(entry({ episodeId: "e2" }));
    expect(await ledger.spent("e1")).toBe(1_000_000);
    // Claude kaydı listede kalır (maliyet ayrıca gösterilir).
    expect((await ledger.list("e1")).some((e) => e.capability === "llm")).toBe(true);
  });
});
