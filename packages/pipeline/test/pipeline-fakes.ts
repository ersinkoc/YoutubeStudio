import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi, type Mock } from "vitest";

// Sahteler gevşek tiplidir: testler her çağrıda farklı biçimde veri döndürebilsin.
type Loose = Mock<(...args: any[]) => any>;
const loose = (impl: (...args: any[]) => any): Loose => vi.fn(impl);

/**
 * pipeline.ts testlerinin sahteleri. Bu dosya kaynak koda (../src) dokunmaz: vi.mock fabrikaları bunu içe aktarır,
 * kaynağı içe aktarsaydı sahte modül kurulurken döngüye girerdi. Hiçbir sahte ağa, Claude'a ya da Remotion'a gitmez.
 */

type AnyFn = (...args: never[]) => unknown;

/** Sahte ajanlar: ad → işleyici (dönen değer ajanın `data`sı; fırlatırsa çağrı başarısız). */
export const handlers = new Map<string, AnyFn>();
export const agentCalls: { name: string; args: unknown[] }[] = [];

export const AGENT_NAMES = [
  "artDirector",
  "castingDirector",
  "director",
  "frameInspector",
  "screenwriter",
  "sceneCritic",
  "stylePicker",
  "scriptDoctor",
  "storyArchitect",
  "vectorDesigner",
  "propPhysics",
  "assetGate",
  "assetPlanner",
  "assetGuess",
  "vectorDirector",
  "lessonCurator",
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export function onAgent(name: AgentName, fn: (...args: any[]) => unknown): void {
  handlers.set(name, fn as AnyFn);
}

export const callsOf = (name: AgentName) => agentCalls.filter((c) => c.name === name);

export function mockAgents(orig: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...orig };
  for (const name of AGENT_NAMES) {
    out[name] = vi.fn(async (...args: unknown[]) => {
      agentCalls.push({ name, args });
      const h = handlers.get(name);
      if (!h) throw new Error(`sahte ajan tanımsız: ${name}`);
      const data = await (h as (...a: unknown[]) => unknown)(...args);
      return { data, name, costUsd: 0.01, model: "claude-test", durationMs: 1500 };
    });
  }
  return out;
}

/** Remotion sahtesi: kareler gerçek (küçük) dosya olarak yazılır, çünkü pipeline onları diskten okur. */
export const render = {
  stills: loose(async (opts: { frames: Record<string, number>; outDir: string; onWait?: (pid: number) => void }) => {
    opts.onWait?.(4242);
    const out: Record<string, string> = {};
    await mkdir(opts.outDir, { recursive: true });
    for (const name of Object.keys(opts.frames)) {
      const file = join(opts.outDir, `${name}.jpg`);
      await writeFile(file, `jpeg:${name}`);
      out[name] = file;
    }
    return out;
  }),
  episode: loose(async (opts: { outputPath: string }) => opts.outputPath),
};

export const media = {
  probe: loose(async () => 2000),
  normalize: loose(async (_input: string, output: string) => {
    await writeFile(output, "normalized");
  }),
};

export const refs = {
  find: loose(async () => ({ images: [] as unknown[], sources: [] as { title: string; url: string }[], keys: [] as string[] })),
  vectors: loose(async () => [] as { svg: string; source: { title: string; url: string; license?: string } }[]),
  rasterize: loose(async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" })),
};

export const geo = {
  map: loose(async () => ({ svg: '<svg viewBox="0 0 1920 1080"><rect width="10" height="10"/></svg>', width: 1920, height: 1080, meta: { exact: true } })),
  flag: loose(async () => ({ svg: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#e30a17"/></svg>', width: 30, height: 20, meta: { exact: true } })),
};

/** Her testten önce: işleyiciler, çağrı kayıtları ve sahtelerin varsayılan davranışı sıfırlanır. */
export function resetFakes(): void {
  handlers.clear();
  agentCalls.length = 0;
  for (const group of [render, media, refs, geo]) for (const fn of Object.values(group)) fn.mockReset();
}
