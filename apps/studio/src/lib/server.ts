import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDb, DbCostLedger } from "@ys/db";
import {
  createProvidersFromEnv,
  InMemoryLedger,
  JsonlLedger,
  MediaGateway,
  measuredLatency,
  type CostEntry,
  type CostLedger,
  type ProviderAdapter,
  type Quota,
} from "@ys/media-gateway";
import { EpisodeRepo, liveLock, type EstimateContext } from "@ys/pipeline/light";
import { createStoreFromEnv, type AssetStore } from "@ys/storage";

/** Monorepo kökü: stüdyo apps/studio içinden çalışır, veriler kökteki .data altındadır. */
// Çalışma anında çözülen veri klasörü; derleyicinin tüm projeyi pakete izlemesini engeller.
export const ROOT = resolve(/*turbopackIgnore: true*/ process.env.YS_ROOT ?? join(process.cwd(), "..", ".."));

interface Studio {
  store: AssetStore;
  repo: EpisodeRepo;
  ledger: CostLedger;
  providers: ProviderAdapter[];
  skipped: string[];
  gateway: MediaGateway;
  jobs: Map<string, Job>;
  quotas: Map<string, { at: number; quota: Quota | undefined }>;
}

const g = globalThis as unknown as { __ys?: Studio };

function init(): Studio {
  if (g.__ys) return g.__ys;
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const store = createStoreFromEnv(process.env, join(ROOT, ".data", "assets"));
  // CLI ile aynı defter: LEDGER=db ise Postgres, değilse JSONL dosyası.
  const ledger: CostLedger =
    process.env.LEDGER === "db" && process.env.DATABASE_URL
      ? new DbCostLedger(createDb(process.env.DATABASE_URL))
      : new JsonlLedger(join(ROOT, ".data", "ledger.jsonl"));
  const { providers, skipped } = createProvidersFromEnv(process.env);
  // Stüdyonun gateway'i sadece kota sorgusu için; üretim CLI sürecinde yapılır.
  const gateway = new MediaGateway({ providers, store, ledger: new InMemoryLedger() });
  g.__ys = { store, repo: new EpisodeRepo(store), ledger, providers, skipped, gateway, jobs: new Map(), quotas: new Map() };
  return g.__ys;
}

export const store = () => init().store;
export const repo = () => init().repo;
export const catalog = () => ({ providers: init().providers, skipped: init().skipped });

export async function ledgerEntries(episodeId?: string): Promise<CostEntry[]> {
  return init().ledger.list(episodeId);
}

export async function episodeSpentUsd(episodeId: string): Promise<number> {
  return (await init().ledger.spent(episodeId)) / 1_000_000;
}

/** Tahmin motorunun girdisi: etkin sağlayıcılar ve defterden ölçülen gecikmeler. */
export async function estimateContext(): Promise<EstimateContext> {
  return { providers: init().providers, latency: measuredLatency(await ledgerEntries()) };
}

const QUOTA_TTL_MS = 60_000;

/** Sağlayıcı kotası; arayüz sık yenilendiği için 60 sn önbelleklenir. */
export async function quotaOf(providerId: string): Promise<Quota | undefined> {
  const { quotas, gateway } = init();
  const hit = quotas.get(providerId);
  if (hit && Date.now() - hit.at < QUOTA_TTL_MS) return hit.quota;
  const quota = await gateway.quota(providerId);
  quotas.set(providerId, { at: Date.now(), quota });
  return quota;
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
  // "exit": süreç bitince. "close" ise stdout'u devralan torun süreçler (Chrome) kapanana kadar gecikebiliyor ve iş
  // sonsuza dek "çalışıyor" görünüyordu (30 Eki).
  const finish = (code: number | null) => {
    if (job.status !== "running") return;
    job.status = code === 0 ? "done" : "error";
    job.endedAt = new Date().toISOString();
    delete job.child;
  };
  child.on("exit", finish);
  child.on("close", finish);
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

const ZOMBIE_GRACE_MS = 60_000;

/**
 * Bölümde iş sürüyor mu: Stüdyo'nun işi ya da durum dosyasına göre (CLI'dan başlayanlar). Stüdyo'nun işi durum dosyasının
 * son kaydından sonra bittiyse (iptal, çökme) dosyadaki "sürüyor" bayattır: süreç aşamayı kapatamadan öldü.
 */
export async function episodeBusy(episodeId: string, state: { heartbeatAt?: string }, fileStatus: string): Promise<boolean> {
  const job = init().jobs.get(episodeId);
  // Kesin bilgi: çalışma kilidi (CLI süreçleri dahil). Sahibi canlıysa "takıldı" görünse de iş sürüyor; ölmüşse
  // dosyadaki "sürüyor" bayattır (iptal, çökme).
  const locked = Boolean(await liveLock(init().store, episodeId));
  if (job?.status === "running") {
    if (locked || fileStatus === "running") return true;
    // Pipeline bitti (kilit bırakıldı, aşama kapandı) ama süreç kapanmadı (açık kalan tarayıcı vb.): ölü iş. Kapatılır ki
    // kullanıcı devam ettirebilsin. Yalnız bu iş başladıktan sonra pipeline gerçekten çalışıp en az ZOMBIE_GRACE_MS önce
    // durduysa: yeni başlayan süreç ilk saniyelerde kilidi henüz almamıştır, onu öldürmek "devam"ı bozuyordu (30 Eki).
    const heartbeat = state.heartbeatAt ? Date.parse(state.heartbeatAt) : NaN;
    const ranAfterStart = heartbeat > Date.parse(job.startedAt);
    if (!ranAfterStart || Date.now() - heartbeat < ZOMBIE_GRACE_MS) return true;
    job.child?.kill();
    job.status = "error";
    job.endedAt = new Date().toISOString();
    job.log.push("Süreç pipeline bittikten sonra kapanmadı; sonlandırıldı.");
    delete job.child;
    return false;
  }
  if (locked) return true;
  if (fileStatus !== "running") return false;
  return !(job?.endedAt && job.endedAt >= (state.heartbeatAt ?? ""));
}

export function getJob(episodeId: string): JobView | undefined {
  const job = init().jobs.get(episodeId);
  return job && view(job);
}

const view = ({ child: _child, ...rest }: Job): JobView => ({ ...rest, log: [...rest.log] });
