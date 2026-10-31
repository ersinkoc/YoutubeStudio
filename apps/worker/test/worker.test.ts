import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Trigger.dev görevi ve paylaşılan bağlam. Trigger.dev SDK'sı, pipeline ve Postgres sahtedir: görev tanımı doğrudan
 * çağrılır, gerçek bölüm çalıştırılmaz.
 */

const fake = vi.hoisted(() => {
  const state = {
    pipelines: [] as { opts: Record<string, any>; runs: [string, unknown][] }[],
    gateways: [] as Record<string, any>[],
    stores: [] as unknown[],
    providerCalls: 0,
    dbUrls: [] as string[],
    logs: [] as string[],
    meta: [] as [string, unknown][],
    runResult: undefined as unknown,
  };
  class FakePipeline {
    readonly runs: [string, unknown][] = [];
    constructor(readonly opts: Record<string, any>) {
      state.pipelines.push(this);
    }
    async run(id: string, opts: unknown) {
      this.runs.push([id, opts]);
      for (const m of ["▶ style", "  · bir ayrıntı", "▶ render"]) this.opts.log(m);
      return state.runResult;
    }
  }
  class FakeGateway {
    constructor(opts: Record<string, any>) {
      state.gateways.push(opts);
    }
  }
  const metadata = {
    set(key: string, value: unknown) {
      state.meta.push([key, value]);
      return metadata;
    },
  };
  return { state, FakePipeline, FakeGateway, metadata };
});

// Gerçek modüller bir kez yüklenir (sahteler kaydedilmeden önce); her testte modül yeniden yüklense de bunlar yeniden
// derlenmez, yük altında yavaşlamaz.
const real = await vi.hoisted(async () => ({ light: await import("@ys/pipeline/light"), gateway: await import("@ys/media-gateway") }));

vi.mock("@trigger.dev/sdk", () => ({
  task: (def: unknown) => def,
  logger: { info: (m: string) => fake.state.logs.push(m) },
  metadata: fake.metadata,
}));
vi.mock("@ys/pipeline", () => ({ STAGES: real.light.STAGES, EpisodePipeline: fake.FakePipeline }));
vi.mock("@ys/db", () => ({
  createDb: (url: string) => ({ url }),
  DbCostLedger: class {
    constructor(db: { url: string }) {
      fake.state.dbUrls.push(db.url);
    }
  },
}));
vi.mock("@ys/storage", () => ({
  createStoreFromEnv: () => {
    const s = { sahte: "depo" };
    fake.state.stores.push(s);
    return s;
  },
}));
vi.mock("@ys/media-gateway", () => ({
  JsonlLedger: real.gateway.JsonlLedger,
  HealthTracker: real.gateway.HealthTracker,
  MediaGateway: fake.FakeGateway,
  createProvidersFromEnv: () => {
    fake.state.providerCalls++;
    return { providers: [{ id: "fake" }], skipped: [] };
  },
}));

beforeEach(() => {
  vi.resetModules();
  Object.assign(fake.state, { pipelines: [], gateways: [], stores: [], providerCalls: 0, dbUrls: [], logs: [], meta: [], runResult: undefined });
  delete process.env.LEDGER;
  delete process.env.DATABASE_URL;
  delete process.env.YS_WORK_DIR;
});
afterEach(() => {
  delete process.env.LEDGER;
  delete process.env.DATABASE_URL;
  delete process.env.YS_WORK_DIR;
});

describe("getPipeline", () => {
  it("her çağrıya ayrı pipeline; depo, defter, sağlayıcılar ve sağlık takibi süreç başına paylaşılır", async () => {
    const { getPipeline } = await import("../src/context.ts");
    const log = vi.fn();
    const a = getPipeline(log) as unknown as InstanceType<typeof fake.FakePipeline>;
    const b = getPipeline(() => {}) as unknown as InstanceType<typeof fake.FakePipeline>;
    expect(a).not.toBe(b);
    expect(fake.state.providerCalls).toBe(1);
    expect(fake.state.stores).toHaveLength(1);
    expect(a.opts.store).toBe(b.opts.store);
    expect(a.opts.ledger).toBe(b.opts.ledger);
    expect(a.opts.ledger).toBeInstanceOf(real.gateway.JsonlLedger);
    expect(a.opts.workDir).toBe(".data/episodes");
    expect(a.opts.log).toBe(log);
    expect(a.opts.agentDeps.log).toBe(log);
    const [ga, gb] = fake.state.gateways;
    expect(ga!.health).toBe(gb!.health);
    expect(ga!.providers).toEqual([{ id: "fake" }]);
    expect(ga!.log).toBe(log);
    expect(a.opts.gateway).toBeInstanceOf(fake.FakeGateway);
  });

  it("LEDGER=db ise Postgres defteri; YS_WORK_DIR çalışma klasörünü değiştirir", async () => {
    process.env.LEDGER = "db";
    process.env.DATABASE_URL = "postgres://w";
    process.env.YS_WORK_DIR = "/tmp/ys-episodes";
    const { getPipeline } = await import("../src/context.ts");
    const p = getPipeline(() => {}) as unknown as InstanceType<typeof fake.FakePipeline>;
    expect(fake.state.dbUrls).toEqual(["postgres://w"]);
    expect(p.opts.workDir).toBe("/tmp/ys-episodes");
  });

  it("LEDGER=db ama DATABASE_URL yoksa JSONL defter", async () => {
    process.env.LEDGER = "db";
    const { getPipeline } = await import("../src/context.ts");
    getPipeline(() => {});
    expect(fake.state.dbUrls).toEqual([]);
  });
});

describe("run-episode görevi", () => {
  it("bölümü sürdürür, aşamaları ve son günlüğü metadata'ya yazar, özet döndürür", async () => {
    const { runEpisode } = await import("../src/episode.ts");
    const def = runEpisode as unknown as {
      id: string;
      queue: { concurrencyLimit: number };
      run: (p: { episodeId: string; until?: string; from?: string }, ctx: { signal: AbortSignal }) => Promise<unknown>;
    };
    expect(def.id).toBe("run-episode");
    expect(def.queue).toEqual({ concurrencyLimit: 2 });

    fake.state.runResult = { id: "e1", done: { style: "t", story: "t" }, agentCostUsd: 0.5, render: { path: "out.mp4" } };
    const signal = new AbortController().signal;
    const res = await def.run({ episodeId: "e1", until: "render", from: "style" }, { signal });
    expect(res).toEqual({ episodeId: "e1", done: ["style", "story"], agentCostUsd: 0.5, video: "out.mp4" });
    expect(fake.state.pipelines[0]!.runs).toEqual([["e1", { until: "render", from: "style", signal }]]);
    expect(fake.state.logs).toEqual(["▶ style", "  · bir ayrıntı", "▶ render"]);
    expect(fake.state.meta).toEqual([
      ["stage", "style"],
      ["stageIndex", 0],
      ["lastLog", "  · bir ayrıntı"],
      ["stage", "render"],
      ["stageIndex", real.light.STAGES.indexOf("render")],
    ]);

    fake.state.runResult = { id: "e2", done: {}, agentCostUsd: 0 };
    expect(await def.run({ episodeId: "e2" }, { signal })).toEqual({ episodeId: "e2", done: [], agentCostUsd: 0, video: undefined });
  });
});
