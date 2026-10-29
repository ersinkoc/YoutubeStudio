import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BudgetTier } from "@ys/core";
import {
  approve,
  EpisodePipeline,
  estimateWordTimings,
  selectCandidate,
  STAGES,
  type EpisodeState,
  type MotionMode,
  type Stage,
} from "@ys/pipeline";
import type { AssetStore } from "@ys/storage";

const run = promisify(execFile);

export interface EpisodeArgs {
  topic?: string;
  lang?: string;
  minutes?: string;
  tier?: string;
  budget?: string;
  clips?: string;
  style?: string;
  voice?: string;
  until?: string;
  from?: string;
  only?: string;
  motion?: string;
  manual?: boolean;
  noQa?: boolean;
  gate?: string;
  pick?: string;
  vertical?: boolean;
}

const parseStage = (s: string | undefined): Stage | undefined => {
  if (s === undefined) return undefined;
  if (!(STAGES as readonly string[]).includes(s)) throw new Error(`Geçersiz aşama: ${s} (${STAGES.join(", ")})`);
  return s as Stage;
};

export async function episodeCommand(
  pipeline: EpisodePipeline,
  sub: string | undefined,
  id: string | undefined,
  args: EpisodeArgs,
): Promise<void> {
  switch (sub) {
    case "new": {
      if (!args.topic) throw new Error("--topic gerekli");
      const state = await pipeline.create({
        topic: args.topic,
        lang: args.lang ?? "tr",
        targetSec: Math.round(Number(args.minutes ?? 3) * 60),
        tier: BudgetTier.parse(args.tier ?? "economy"),
        budgetUsd: Number(args.budget ?? 10),
        aiClipRatio: Number(args.clips ?? 0),
        motionMode: parseMotion(args.motion),
        styleHint: args.style,
        voiceId: args.voice,
        autoApprove: !args.manual,
        qa: !args.noQa,
        width: args.vertical ? 1080 : 1920,
        height: args.vertical ? 1920 : 1080,
        fps: 30,
      });
      console.log(state.id);
      return;
    }
    case "preview": {
      if (!id) throw new Error("bölüm kimliği gerekli");
      printSummary(await pipeline.previewConcept(id));
      return;
    }
    case "approve": {
      if (!id || (args.gate !== "script" && args.gate !== "concept")) throw new Error("Kullanım: episode approve <id> script|concept");
      const state = await pipeline.load(id);
      approve(state, args.gate);
      await pipeline.save(state);
      printSummary(state);
      return;
    }
    case "select": {
      const [entityId, index] = (args.pick ?? "").split("=");
      if (!id || !entityId || index === undefined) throw new Error("Kullanım: episode select <id> <varlık>=<sıra>  (örn. c1=2)");
      const state = await pipeline.load(id);
      selectCandidate(state, entityId, Number(index));
      await pipeline.save(state);
      printSummary(state);
      return;
    }
    case "run": {
      if (!id) throw new Error("bölüm kimliği gerekli");
      const state = await pipeline.run(id, {
        until: parseStage(args.until),
        from: parseStage(args.from),
        only: parseStage(args.only),
      });
      printSummary(state);
      return;
    }
    case "show": {
      if (!id) throw new Error("bölüm kimliği gerekli");
      printSummary(await pipeline.load(id));
      return;
    }
    default:
      throw new Error("Kullanım: episode new|run|show|preview|approve|select");
  }
}

function parseMotion(m: string | undefined): MotionMode | undefined {
  if (m === undefined) return undefined;
  if (m !== "animated" && m !== "mixed" && m !== "still") throw new Error("--motion animated|mixed|still");
  return m;
}

function printSummary(s: EpisodeState): void {
  console.log(`Bölüm:   ${s.id}`);
  console.log(`Konu:    ${s.input.topic} (${s.input.lang}, ${s.input.targetSec} sn, ${s.input.tier}, ${s.input.motionMode ?? "mixed"})`);
  if (s.story) console.log(`Başlık:  ${s.story.title}`);
  console.log(`Aşamalar: ${STAGES.map((st) => (s.done[st] ? `✓${st}` : `·${st}`)).join(" ")}`);
  if (s.waitingFor) console.log(`⏸ Onay bekleniyor: ${s.waitingFor}  →  pnpm ys episode approve ${s.id} ${s.waitingFor}`);
  if (s.cast) {
    for (const e of [...s.cast.characters, ...s.cast.locations]) {
      const n = s.concept?.candidates[e.id]?.length ?? 0;
      const sel = s.concept?.selected[e.id];
      const idx = sel ? s.concept!.candidates[e.id]!.findIndex((c) => c.key === sel.key) : -1;
      console.log(`  ${e.id} ${e.name}: ${n} aday${idx >= 0 ? `, seçili #${idx}` : ""}`);
    }
  }
  if (s.shots) console.log(`Çekim:   ${s.shots.length} (${Object.keys(s.keyframes ?? {}).length} keyframe, ${Object.keys(s.clips ?? {}).length} klip)`);
  console.log(`Ajan maliyeti: $${s.agentCostUsd.toFixed(4)}`);
  if (s.render) console.log(`Video:   ${s.render.path}`);
}

/**
 * API'ye para ödemeden Remotion hattını uçtan uca dener: FFmpeg ile test görselleri ve ses üretir,
 * sahte bir senaryo/çekim planı kurar, timeline + render aşamalarını gerçek olarak çalıştırır.
 */
export async function renderDemo(pipeline: EpisodePipeline, store: AssetStore): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "ys-demo-"));
  try {
    const scenes = [
      { id: "s1", text: "Bir zamanlar, sisli bir ormanın derinliklerinde küçük bir tilki yaşardı." },
      { id: "s2", text: "Her sabah güneş doğarken, ağaçların arasından yeni bir macera ararken yola çıkardı." },
    ];
    const sources = ["testsrc2", "mandelbrot", "life=s=320x180:mold=10:ratio=0.5:death_color=#203040"];

    const keyframes: EpisodeState["keyframes"] = {};
    for (const [i, src] of sources.entries()) {
      const out = join(tmp, `kf${i}.png`);
      await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `${src}`, "-frames:v", "1", "-vf", "scale=1920:1080", out]);
      const key = `demo/kf${i}.png`;
      await store.put(key, new Uint8Array(await readFile(out)), "image/png");
      keyframes[`shot${i}`] = { key, mimeType: "image/png" };
    }

    const voice: EpisodeState["voice"] = {};
    for (const [i, scene] of scenes.entries()) {
      const out = join(tmp, `v${i}.mp3`);
      const durationSec = 4 + i;
      await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${330 + i * 110}:duration=${durationSec}`, "-q:a", "4", out]);
      const key = `demo/voice-${scene.id}.mp3`;
      await store.put(key, new Uint8Array(await readFile(out)), "audio/mpeg");
      const durationMs = durationSec * 1000;
      voice[scene.id] = { key, mimeType: "audio/mpeg", durationMs, words: estimateWordTimings(scene.text, durationMs), estimatedTiming: true };
    }

    const state = await pipeline.create({
      topic: "render demo",
      lang: "tr",
      targetSec: 10,
      tier: "ultra",
      budgetUsd: 0,
      aiClipRatio: 0,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    const s1End = 4000;
    const total = s1End + 400 + 5000 + 400;
    Object.assign(state, {
      script: {
        scenes: scenes.map((s) => ({ id: s.id, beatId: "b1", narration: s.text, visualIntent: "", emotion: "calm", location: "forest" })),
      },
      voice,
      shots: [
        { id: "shot0", sceneId: "s1", kind: "still_motion", startMs: 0, endMs: 2200, description: "", imagePrompt: "", motionPrompt: "", camera: "push_in" },
        { id: "shot1", sceneId: "s1", kind: "still_motion", startMs: 2200, endMs: s1End + 400, description: "", imagePrompt: "", motionPrompt: "", camera: "pan_right" },
        { id: "shot2", sceneId: "s2", kind: "still_motion", startMs: s1End + 400, endMs: total, description: "", imagePrompt: "", motionPrompt: "", camera: "pull_out" },
      ],
      keyframes,
      clips: {},
    } satisfies Partial<EpisodeState>);
    for (const st of ["style", "story", "script", "voice", "shots", "keyframes", "clips"] as const) state.done[st] = "demo";
    await pipeline.save(state);

    printSummary(await pipeline.run(state.id));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
