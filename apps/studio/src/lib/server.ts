import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { JsonlLedger } from "@ys/media-gateway";
import { EpisodeRepo } from "@ys/pipeline/light";
import { createStoreFromEnv, type AssetStore } from "@ys/storage";

/** Monorepo kökü: stüdyo apps/studio içinden çalışır, veriler kökteki .data altındadır. */
// Çalışma anında çözülen veri klasörü; derleyicinin tüm projeyi pakete izlemesini engeller.
export const ROOT = resolve(/*turbopackIgnore: true*/ process.env.YS_ROOT ?? join(process.cwd(), "..", ".."));

const g = globalThis as unknown as { __ys?: { store: AssetStore; repo: EpisodeRepo; ledger: JsonlLedger; jobs: Map<string, Job> } };

function init() {
  if (g.__ys) return g.__ys;
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const store = createStoreFromEnv(process.env, join(ROOT, ".data", "assets"));
  g.__ys = { store, repo: new EpisodeRepo(store), ledger: new JsonlLedger(join(ROOT, ".data", "ledger.jsonl")), jobs: new Map() };
  return g.__ys;
}

export const store = () => init().store;
export const repo = () => init().repo;

export async function episodeSpentUsd(episodeId: string): Promise<number> {
  return (await init().ledger.spent(episodeId)) / 1_000_000;
}

// ---------------- arka plan işleri ----------------

export interface Job {
  episodeId: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: string;
  endedAt?: string;
  log: string[];
  child?: ChildProcess;
}

export type JobView = Omit<Job, "child">;

const MAX_LOG = 400;

/**
 * Ağır işi (ajanlar, görsel/video üretimi, render) ayrı bir CLI sürecinde çalıştırır.
 * Stüdyo sunucusu hafif kalır; aynı komut ileride Trigger.dev task'ına taşınabilir.
 */
export function startJob(episodeId: string, label: string, args: string[]): JobView {
  const { jobs } = init();
  const current = jobs.get(episodeId);
  if (current?.status === "running") throw new Error(`Zaten çalışan bir iş var: ${current.label}`);

  const tsx = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, join(ROOT, "apps", "cli", "src", "index.ts"), ...args], {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
  });
  const job: Job = { episodeId, label, status: "running", startedAt: new Date().toISOString(), log: [], child };
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      job.log.push(line);
      if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    }
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "error";
    job.endedAt = new Date().toISOString();
    delete job.child;
  });
  jobs.set(episodeId, job);
  return view(job);
}

export function cancelJob(episodeId: string): void {
  const job = init().jobs.get(episodeId);
  if (job?.status === "running") {
    job.child?.kill();
    job.log.push("İptal edildi.");
  }
}

export function getJob(episodeId: string): JobView | undefined {
  const job = init().jobs.get(episodeId);
  return job && view(job);
}

const view = ({ child: _child, ...rest }: Job): JobView => ({ ...rest, log: [...rest.log] });
