import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, vi, type Mock } from "vitest";
import type { CastOut, ScriptOut } from "@ys/agents";
import { styleFromPack, stylePackOf, VectorShot } from "@ys/core";
import { InMemoryLedger, type GenerationRequest, type MediaGateway, type RunOptions } from "@ys/media-gateway";
import type { AssetStore } from "@ys/storage";
import { EpisodePipeline, newEpisodeState, type EpisodeInput, type EpisodeState, type PipelineDeps } from "../src/index.ts";

/** Testlerin açtığı geçici çalışma klasörleri dosya bitince silinir. */
const workDirs: string[] = [];
afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Bellekte depo; `failPut` ile belirli anahtarlara yazma hatası verilebilir. */
export class MemStore implements AssetStore {
  readonly map = new Map<string, Uint8Array>();
  failPut?: (key: string) => boolean;
  async put(key: string, bytes: Uint8Array): Promise<string> {
    if (this.failPut?.(key)) throw new Error(`yazılamadı: ${key}`);
    this.map.set(key, bytes);
    return `mem://${key}`;
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
  text(key: string): string | undefined {
    const b = this.map.get(key);
    return b ? new TextDecoder().decode(b) : undefined;
  }
  json<T = any>(key: string): T | undefined {
    const t = this.text(key);
    return t === undefined ? undefined : (JSON.parse(t) as T);
  }
  putText(key: string, text: string): void {
    this.map.set(key, new TextEncoder().encode(text));
  }
  putJsonSync(key: string, value: unknown): void {
    this.putText(key, JSON.stringify(value));
  }
}

export interface FakeGateway {
  generate: Mock<(req: GenerationRequest, run: RunOptions) => Promise<any>>;
  plan: Mock<(req: GenerationRequest, policy?: unknown) => any[]>;
  quota: Mock<(providerId: string) => Promise<any>>;
  requests: { req: GenerationRequest; run: RunOptions }[];
}

/** Sahte medya geçidi: her istek için depoya küçük bir dosya yazar. Para harcamaz, ağa çıkmaz. */
export function fakeGateway(store: MemStore): FakeGateway {
  const requests: FakeGateway["requests"] = [];
  let n = 0;
  const gw: FakeGateway = {
    requests,
    generate: vi.fn(async (req: GenerationRequest, run: RunOptions) => {
      requests.push({ req, run });
      const audio = req.capability.startsWith("tts");
      const video = req.capability === "i2v";
      const mimeType = audio ? "audio/mpeg" : video ? "video/mp4" : "image/png";
      const key = `assets/${req.capability}/${run.refId ?? "x"}-${n++}.${audio ? "mp3" : video ? "mp4" : "png"}`;
      await store.put(key, new TextEncoder().encode(`${req.capability}:${run.refId}`));
      return { files: [{ key, mimeType }], providerId: audio ? "tts:fake" : "img:fake", cacheHit: false };
    }),
    plan: vi.fn((_req: GenerationRequest, _policy?: unknown): any[] => [{ adapter: { id: "tts:fake" } }]),
    quota: vi.fn(async (_id: string): Promise<any> => undefined),
  };
  return gw;
}

export const baseInput: EpisodeInput = {
  topic: "Pony Express",
  lang: "tr",
  targetSec: 60,
  tier: "economy",
  aiClipRatio: 0,
  budgetUsd: 3,
  width: 1920,
  height: 1080,
  fps: 30,
};

export const STYLE = styleFromPack(stylePackOf("flat-explainer")!);

export const scene = (id: string, narration = "bir iki üç dört beş altı"): ScriptOut["scenes"][number] =>
  ({ id, beatId: "b1", narration, visualIntent: `intent ${id}`, emotion: "calm", location: "x" }) as ScriptOut["scenes"][number];

export const SCRIPT: ScriptOut = { title: "Başlık", scenes: [scene("s1"), scene("s2")] } as ScriptOut;

export const CAST: CastOut = {
  characters: [{ id: "c1", name: "Rider", kind: "person", role: "rider", visualDescription: "young rider", scenes: ["s1"] }],
  locations: [{ id: "l1", name: "Station", visualDescription: "relay station", scenes: ["s1"] }],
} as CastOut;

export const voiceOf = (id: string, durationMs = 2000) => ({
  key: `assets/voice/${id}.mp3`,
  mimeType: "audio/mpeg",
  durationMs,
  words: [
    { text: "bir", startMs: 0, endMs: 500 },
    { text: "iki", startMs: 500, endMs: 1000 },
    { text: "üç", startMs: 1000, endMs: 1500 },
  ],
  estimatedTiming: false,
  text: "bir iki üç dört beş altı",
});

export const vshot = (raw: unknown) => VectorShot.parse(raw);

export const CHARACTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800">' +
  ["leg-l", "leg-r", "body", "arm-l", "arm-r", "head"].map((id) => `<g id="${id}"><rect x="150" y="100" width="100" height="100" fill="#c33"/></g>`).join("") +
  "</svg>";
export const ROOM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect x="0" y="700" width="1920" height="380" fill="#888"/></svg>';
export const PROP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="10" fill="#a52"/></svg>';

export interface Harness {
  store: MemStore;
  gateway: FakeGateway;
  ledger: InMemoryLedger;
  logs: string[];
  workDir: string;
  pipeline: EpisodePipeline;
  /** Durumu kaydeder ve kimliğini döndürür. */
  seed(state: EpisodeState): Promise<string>;
  load(id: string): Promise<EpisodeState>;
}

export function harness(extra: Partial<PipelineDeps> = {}): Harness {
  const store = new MemStore();
  const gateway = fakeGateway(store);
  const ledger = new InMemoryLedger();
  const logs: string[] = [];
  const workDir = mkdtempSync(join(tmpdir(), "ys-pipe-"));
  workDirs.push(workDir);
  const pipeline = new EpisodePipeline({
    gateway: gateway as unknown as MediaGateway,
    store,
    ledger,
    workDir,
    log: (m) => logs.push(m),
    ...extra,
  });
  return {
    store,
    gateway,
    ledger,
    logs,
    workDir,
    pipeline,
    async seed(state) {
      await pipeline.save(state);
      return state.id;
    },
    load: (id) => pipeline.load(id),
  };
}

export function makeState(input: Partial<EpisodeInput> = {}, extra: Partial<EpisodeState> = {}): EpisodeState {
  return { ...newEpisodeState({ ...baseInput, ...input }), ...extra };
}

/** Sahte ajanın tipik sonucu. */
export const res = <T>(data: T) => ({ data, name: "fake", costUsd: 0.02, model: "claude-test", durationMs: 2000 });
