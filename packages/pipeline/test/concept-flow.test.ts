import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QueryFn } from "@ys/agents";
import { styleFromPack, stylePackOf, VectorAssetMeta } from "@ys/core";
import { InMemoryLedger, MediaGateway } from "@ys/media-gateway";
import { FsAssetStore, getJson, type AssetStore } from "@ys/storage";
import { acceptAsset, EpisodePipeline, newEpisodeState, rejectAsset, type EpisodeInput, type EpisodeState } from "../src/index.ts";

/**
 * Konsept aşaması uçtan uca, sahte Claude ile (para harcamaz): plan → çizim → kör tahmin → kapı → kütüphane; ret, insan
 * kararı ve yeniden çizim akışları. Sahte ajan, istenen JSON şemasının alanlarından hangi ajan olduğunu anlar.
 */
const CHARACTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800">' +
  ["leg-l", "leg-r", "body", "arm-l", "arm-r", "head"].map((id) => `<g id="${id}"><rect x="150" y="100" width="100" height="100" fill="#c33"/></g>`).join("") +
  "</svg>";
const ROOM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect x="0" y="700" width="1920" height="380" fill="#888"/></svg>';

interface Calls {
  designer: string[];
  planner: number;
  gate: number;
}

function fakeClaude(score: () => number, calls: Calls): QueryFn {
  return ((params: { prompt: unknown; options?: { outputFormat?: { schema?: { properties?: Record<string, unknown> } }; systemPrompt?: string } }) => {
    const props = Object.keys(params.options?.outputFormat?.schema?.properties ?? {});
    const prompt = typeof params.prompt === "string" ? params.prompt : "(görselli istek)";
    let out: unknown;
    if (props.includes("svg")) {
      calls.designer.push(prompt);
      const background = /^Location:/.test(prompt);
      out = background ? { svg: ROOM_SVG, realHeight: 3, grounded: true, floorY: 700 } : { svg: CHARACTER_SVG, realHeight: 1.7, grounded: true };
    } else if (props.includes("cues")) {
      calls.planner++;
      out = { subject: "a young rider standing", moved: [], pose: "front", silhouette: "", parts: [], cues: ["hat", "bag"], avoid: [] };
    } else if (props.includes("confidence")) {
      out = { guess: "a person", confidence: 8 };
    } else if (props.includes("recognizable")) {
      calls.gate++;
      out = { recognizable: score(), fidelity: null, defects: ["arms too short"] };
    } else throw new Error(`bilinmeyen ajan: ${props.join(",")}`);
    return (async function* () {
      yield { type: "result", subtype: "success", duration_ms: 10, total_cost_usd: 0.001, structured_output: out };
    })();
  }) as unknown as QueryFn;
}

const input: EpisodeInput = {
  topic: "Pony Express",
  lang: "tr",
  targetSec: 60,
  tier: "economy",
  aiClipRatio: 0,
  budgetUsd: 3,
  width: 1920,
  height: 1080,
  fps: 30,
  motionMode: "vector",
};

async function setup(score: () => number) {
  const store: AssetStore = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-concept-")));
  const calls: Calls = { designer: [], planner: 0, gate: 0 };
  const pipeline = new EpisodePipeline({
    gateway: new MediaGateway({ providers: [], store, ledger: new InMemoryLedger() }),
    store,
    ledger: new InMemoryLedger(),
    workDir: mkdtempSync(join(tmpdir(), "ys-work-")),
    agentDeps: { queryFn: fakeClaude(score, calls) },
  });
  const state: EpisodeState = {
    ...newEpisodeState(input),
    style: styleFromPack(stylePackOf("flat-explainer")!),
    script: { title: "t", scenes: [] } as never,
    cast: {
      characters: [{ id: "c1", name: "Rider", kind: "person", role: "rider", visualDescription: "young rider", scenes: [] }],
      locations: [{ id: "l1", name: "Station", visualDescription: "relay station", scenes: [] }] as never,
    },
    done: { style: "x", story: "x", script: "x", cast: "x" },
    approvals: { script: "x" },
  };
  await pipeline.save(state);
  return { store, calls, pipeline, id: state.id };
}

describe("konsept akışı (sahte Claude)", () => {
  it("geçen çizim seçilir, kütüphaneye kimliği ve planıyla yazılır", async () => {
    const { store, calls, pipeline, id } = await setup(() => 9);
    const state = await pipeline.run(id, { until: "concept" });
    expect(Object.keys(state.concept!.selected).sort()).toEqual(["c1", "l1"]);
    const key = state.concept!.selected.c1!.key;
    const meta = VectorAssetMeta.parse(await getJson(store, `${key}.json`));
    expect(meta.check).toMatchObject({ passed: true, entityId: "c1", plan: { subject: "a young rider standing" } });
    expect(meta.identity).toMatchObject({ name: "Rider", pack: "flat-explainer" });
    expect(calls.designer).toHaveLength(2);
    expect(calls.planner).toBe(2);
  });

  it("kapıyı geçemeyen karakter 3 denemeden sonra reddedilir; Stüdyo bölümü çökmez, seçim yapılmaz", async () => {
    const { calls, pipeline, id } = await setup(() => 3);
    const state = await pipeline.run(id, { until: "concept" });
    expect(state.concept!.selected.c1).toBeUndefined();
    const check = Object.values(state.assetChecks!).find((c) => c.entityId === "c1")!;
    expect(check).toMatchObject({ passed: false, attempts: 3 });
    expect(check.rejectedKey).toMatch(/\.rejected\.svg$/);
    // Yeniden çizimler kapının kusurlarını düzeltme olarak alır.
    expect(calls.designer.filter((p) => p.startsWith("Character")).at(-1)).toContain("arms too short");
  });

  it("insan notla reddedince yeni anahtara çizilir, not her denemede kalır, eski çizim yerinde kalır", async () => {
    let score = 9;
    const { store, calls, pipeline, id } = await setup(() => score);
    let state = await pipeline.run(id, { until: "concept" });
    const first = state.concept!.selected.c1!.key;
    const firstSvg = new TextDecoder().decode((await store.get(first))!);

    await rejectAsset(store, state, first, "hat must be flat-brimmed");
    await pipeline.save(state);
    calls.designer.length = 0;
    score = 3;
    state = await pipeline.run(id, { until: "concept" });
    const redraws = calls.designer.filter((p) => p.startsWith("Character"));
    expect(redraws).toHaveLength(3);
    for (const p of redraws) expect(p).toContain("Human reviewer: hat must be flat-brimmed");
    const second = Object.entries(state.assetChecks!).find(([k, c]) => c.entityId === "c1" && k !== first)!;
    expect(second[0]).not.toBe(first);
    expect(new TextDecoder().decode((await store.get(first))!)).toBe(firstSvg);

    // İnsan reddedileni kabul eder: yeni anahtara yazılır ve seçilir.
    await acceptAsset(store, state, second[0]);
    expect(state.concept!.selected.c1?.key).toBe(second[0]);
  });
});
