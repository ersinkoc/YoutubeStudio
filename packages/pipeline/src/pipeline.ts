import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  artDirector,
  castingDirector,
  director,
  frameInspector,
  screenwriter,
  storyArchitect,
  type AgentDeps,
  type AgentResult,
  type EpisodeBrief,
} from "@ys/agents";
import { usd } from "@ys/core";
import type {
  AspectRatio,
  CostLedger,
  GenerationRequest,
  MediaGateway,
  RefInput,
  RunOptions,
} from "@ys/media-gateway";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import { renderEpisode } from "@ys/video/render";
import { invalidateFrom, missingSelections, newEpisodeState } from "./actions.ts";
import { mapLimit, normalizeClip, probeDurationMs } from "./media.ts";
import { frameRank, judgeFrame, QA_MAX_BYTES, redrawPrompt } from "./qa.ts";
import {
  STAGES,
  gateBefore,
  isApproved,
  motionModeOf,
  type AssetRef,
  type EpisodeInput,
  type FrameQa,
  type PlannedShotState,
  type EpisodeState,
  type SceneVoice,
  type Stage,
} from "./state.ts";
import { buildTimeline, estimateWordTimings, resolveShotTimes } from "./timing.ts";

/** Sağlayıcı kotası işi bitirmeye yetmiyor; para harcanmadan önce durulur. */
export class QuotaError extends Error {}

export interface PipelineDeps {
  gateway: MediaGateway;
  store: AssetStore;
  ledger: CostLedger;
  /** Render için yerel çalışma klasörü (varlıklar buraya indirilir). */
  workDir: string;
  agentDeps?: AgentDeps;
  log?: (message: string) => void;
  /** Aynı anda kaç görsel/klip üretilsin. */
  concurrency?: number;
  /** Kare denetimden geçmezse en fazla kaç kez yeniden çizilsin (varsayılan 1). */
  qaRedraws?: number;
}

export interface RunEpisodeOptions {
  /** Bu aşamaya kadar (dahil) çalış. */
  until?: Stage;
  /** Bu aşamadan itibaren yeniden çalıştır (önceki çıktıları sil). */
  from?: Stage;
  /** Sadece bu aşamayı yeniden çalıştır; diğer aşamalara dokunma (ör. stili yenile, senaryoyu koru). */
  only?: Stage;
  signal?: AbortSignal;
}

const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg" };

/**
 * Her keyframe'e eklenen kompozisyon kuralları. Tarihî/minyatür stillerde modeller kenarlıklı
 * sayfa veya çok panelli düzen üretebiliyor (gerçek denemede bulundu); video karesi tek ve tam olmalı.
 */
export const FRAME_RULES =
  "Single full-bleed cinematic frame filling the entire canvas edge to edge, one moment from one camera angle. No borders, no frames, no panels, no comic layout, no collage, no inset images, no split screen, no diptych, no page or paper margins. No text, no letters, no signs with writing, no watermark.";
const FRAME_NEGATIVE =
  "border, frame, panel, comic layout, collage, inset, split screen, diptych, page margin, text, letters, writing, watermark";

export class EpisodePipeline {
  private readonly log: (message: string) => void;

  constructor(private readonly deps: PipelineDeps) {
    this.log = deps.log ?? (() => {});
  }

  private stateKey = (id: string) => `episodes/${id}/state.json`;

  async create(input: EpisodeInput): Promise<EpisodeState> {
    const state = newEpisodeState(input);
    await this.save(state);
    return state;
  }

  async load(id: string): Promise<EpisodeState> {
    const state = await getJson<EpisodeState>(this.deps.store, this.stateKey(id));
    if (!state) throw new Error(`Bölüm bulunamadı: ${id}`);
    return state;
  }

  async save(state: EpisodeState): Promise<void> {
    await putJson(this.deps.store, this.stateKey(state.id), state);
  }

  async run(id: string, opts: RunEpisodeOptions = {}): Promise<EpisodeState> {
    const state = await this.load(id);
    if (opts.only) {
      this.log(`▶ ${opts.only} (sadece)`);
      await this.runStage(state, opts.only, opts);
      return state;
    }
    if (opts.from) {
      invalidateFrom(state, opts.from);
      await this.save(state);
    }
    const last = opts.until ? STAGES.indexOf(opts.until) : STAGES.length - 1;

    for (const stage of STAGES.slice(0, last + 1)) {
      if (state.done[stage]) continue;
      opts.signal?.throwIfAborted();
      const gate = gateBefore(stage);
      if (gate && !isApproved(state, gate)) {
        state.waitingFor = gate;
        await this.save(state);
        this.log(`⏸ onay bekleniyor: ${gate}`);
        return state;
      }
      this.log(`▶ ${stage}`);
      await this.runStage(state, stage, opts);
    }
    return state;
  }

  /** Aşamayı çalıştırır; süresini ve (varsa) hatasını kalıcı olarak bölüm durumuna yazar. */
  private async runStage(state: EpisodeState, stage: Stage, opts: RunEpisodeOptions): Promise<void> {
    const started = Date.now();
    state.stats = { ...state.stats, [stage]: { startedAt: new Date(started).toISOString() } };
    delete state.lastError;
    await this.save(state);
    const finish = () => {
      state.stats![stage] = { ...state.stats![stage]!, endedAt: new Date().toISOString(), durationMs: Date.now() - started };
    };
    try {
      await this.stages[stage](state, opts);
    } catch (e) {
      finish();
      state.lastError = { stage, message: e instanceof Error ? e.message : String(e), at: new Date().toISOString() };
      await this.save(state);
      throw e;
    }
    finish();
    state.done[stage] = new Date().toISOString();
    await this.save(state);
  }

  // ---------------- yardımcılar ----------------

  private brief(state: EpisodeState): EpisodeBrief {
    const { topic, lang, targetSec, styleHint } = state.input;
    return { topic, lang, targetSec, styleHint };
  }

  private async agent<T>(state: EpisodeState, stage: Stage, call: Promise<AgentResult<T>>): Promise<T> {
    const res = await call;
    state.agentCostUsd += res.costUsd;
    await this.deps.ledger.record({
      at: new Date().toISOString(),
      episodeId: state.id,
      stage,
      providerId: `claude:${res.model}`,
      capability: "llm",
      estimateMicros: usd(res.costUsd),
      cacheHit: false,
      requestHash: `${stage}:${state.id}`,
      durationMs: res.durationMs,
    });
    return res.data;
  }

  private runOptions(state: EpisodeState, stage: Stage, signal?: AbortSignal, refId?: string): RunOptions {
    return {
      policy: { tier: state.input.tier },
      episodeId: state.id,
      stage,
      refId,
      budgetCapMicros: usd(state.input.budgetUsd),
      signal,
    };
  }

  private aspect(state: EpisodeState): AspectRatio {
    const { width, height } = state.input;
    return width === height ? "1:1" : width > height ? "16:9" : "9:16";
  }

  private async bytes(key: string): Promise<Uint8Array> {
    const b = await this.deps.store.get(key);
    if (!b) throw new Error(`Depoda yok: ${key}`);
    return b;
  }

  /**
   * Seçilen karakter/mekân görsellerini referans olarak hazırlar ve prompt'a sıralarını yazar.
   * Tutarlılığın asıl kaynağı budur: her kare aynı referanslardan çizilir.
   */
  private async references(
    state: EpisodeState,
    characterIds: string[] = [],
    locationId?: string,
  ): Promise<{ refs: RefInput[]; text: string }> {
    const selected = state.concept?.selected ?? {};
    const entries: { ref: AssetRef; label: string; role: RefInput["role"] }[] = [];
    for (const id of characterIds.slice(0, 3)) {
      const c = state.cast?.characters.find((x) => x.id === id);
      const ref = selected[id];
      if (c && ref) entries.push({ ref, role: "character", label: `${c.name} (character: keep face, hair, body and clothing exactly as in the reference)` });
    }
    const loc = locationId ? state.cast?.locations.find((x) => x.id === locationId) : undefined;
    const locRef = locationId ? selected[locationId] : undefined;
    if (loc && locRef) entries.push({ ref: locRef, role: "location", label: `${loc.name} (location: keep architecture, materials and props)` });

    const refs = await Promise.all(
      entries.map(async (e) => ({ role: e.role, bytes: await this.bytes(e.ref.key), mimeType: e.ref.mimeType })),
    );
    const text = entries.length
      ? `Reference images in order: ${entries.map((e, i) => `[${i + 1}] ${e.label}`).join("; ")}. Match the references' art style exactly.`
      : "";
    return { refs, text };
  }

  /**
   * Kareyi görsel modelle denetler. Denetim başarısız olursa (ajan hatası, büyük dosya) kare kabul edilir;
   * kalite kontrolü üretimi durdurmamalı.
   */
  private async inspect(state: EpisodeState, shot: PlannedShotState, frame: AssetRef, attempt: number): Promise<FrameQa> {
    const bytes = await this.bytes(frame.key);
    if (bytes.length > QA_MAX_BYTES) {
      return { score: 0, issues: [], attempts: attempt, passed: true, skipped: "görsel çok büyük" };
    }
    const selected = state.concept?.selected ?? {};
    const cast = (shot.characterIds ?? [])
      .map((id) => state.cast?.characters.find((c) => c.id === id))
      .filter((c) => c !== undefined);
    const refs = await Promise.all(
      cast
        .filter((c) => selected[c.id])
        .map(async (c) => ({ label: c.name, image: { data: await this.bytes(selected[c.id]!.key), mimeType: selected[c.id]!.mimeType } })),
    );
    try {
      const out = await this.agent(
        state,
        "keyframes",
        frameInspector(
          {
            frame: { data: bytes, mimeType: frame.mimeType },
            refs,
            description: shot.description,
            imagePrompt: shot.imagePrompt,
            characters: cast.map((c) => c.name),
          },
          this.deps.agentDeps,
        ),
      );
      return judgeFrame(out, attempt);
    } catch (e) {
      this.log(`  ${shot.id}: kare kontrolü yapılamadı (${e instanceof Error ? e.message : String(e)})`);
      return { score: 0, issues: [], attempts: attempt, passed: true, skipped: "denetim hatası" };
    }
  }

  private async keyframe(
    state: EpisodeState,
    stage: Stage,
    prompt: string,
    characterIds: string[] | undefined,
    locationId: string | undefined,
    signal?: AbortSignal,
    refId?: string,
  ) {
    const style = state.style;
    if (!style) throw new Error("style yok");
    const { refs, text } = await this.references(state, characterIds, locationId);
    return this.deps.gateway.generate(
      {
        capability: refs.length ? "i2i_multiref" : "t2i",
        quality: state.input.tier === "premium" ? "hero" : "standard",
        prompt: [style.promptPrefix, prompt, text, FRAME_RULES].filter(Boolean).join(". "),
        negativePrompt: [...style.negativeRules, FRAME_NEGATIVE].join(", "),
        aspectRatio: this.aspect(state),
        refs,
      },
      this.runOptions(state, stage, signal, refId),
    );
  }

  /**
   * Seçilen referanslarla ilk sahnelerden deneme kareleri üretir ("konsept tamam" kararından önce).
   * Bir aşama değildir; konsept onaylanmadan istenildiği kadar tekrarlanabilir.
   */
  async previewConcept(id: string, count = 3, signal?: AbortSignal): Promise<EpisodeState> {
    const state = await this.load(id);
    const { script, cast, concept } = state;
    if (!script || !cast || !concept) throw new Error("Önce casting ve konsept aşamaları çalışmalı");
    const missing = missingSelections(state);
    if (missing.length) throw new Error(`Seçim yapılmamış: ${missing.join(", ")}`);

    const scenes = script.scenes.slice(0, count);
    const previews = await mapLimit(scenes, this.deps.concurrency ?? 3, async (scene) => {
      const characterIds = cast.characters.filter((c) => c.scenes.includes(scene.id)).map((c) => c.id);
      const locationId = cast.locations.find((l) => l.scenes.includes(scene.id))?.id;
      // visualIntent sahnenin tüm anlarını anlatır; olduğu gibi verilince model kolaj/panel çiziyordu
      // (29 Eki stüdyo denemesi). Deneme karesi tek bir anı göstermeli.
      const moment = `One single moment only — the opening moment of this scene, one camera angle, no collage, no insets: ${scene.visualIntent}`;
      const res = await this.keyframe(state, "concept", moment, characterIds, locationId, signal, scene.id);
      this.log(`  deneme ${scene.id} ✓ (${res.providerId})`);
      return { key: res.files[0]!.key, mimeType: res.files[0]!.mimeType, caption: scene.narration.slice(0, 120) };
    });
    concept.previews = previews;
    await this.save(state);
    return state;
  }

  // ---------------- aşamalar ----------------

  private readonly stages: Record<Stage, (state: EpisodeState, opts: RunEpisodeOptions) => Promise<void>> = {
    style: async (state) => {
      state.style = await this.agent(state, "style", artDirector(this.brief(state), this.deps.agentDeps));
    },

    story: async (state) => {
      state.story = await this.agent(state, "story", storyArchitect(this.brief(state), this.deps.agentDeps));
      this.log(`  "${state.story.title}" — ${state.story.beats.length} beat`);
    },

    script: async (state) => {
      if (!state.story) throw new Error("story yok");
      state.script = await this.agent(state, "script", screenwriter(this.brief(state), state.story, this.deps.agentDeps));
      const words = state.script.scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
      this.log(`  ${state.script.scenes.length} sahne, ${words} kelime`);
    },

    cast: async (state) => {
      if (!state.script || !state.style) throw new Error("script/style yok");
      state.cast = await this.agent(state, "cast", castingDirector(state.script, state.style, this.deps.agentDeps));
      this.log(`  ${state.cast.characters.length} karakter, ${state.cast.locations.length} mekân`);
    },

    concept: async (state, opts) => {
      const { cast } = state;
      if (!cast) throw new Error("cast yok");
      const previous = state.concept;
      // Her yeniden üretim yeni bir tur: farklı seed → önbellek aynı görselleri döndürmez.
      const round = previous ? (previous.round ?? 0) + 1 : 0;
      state.concept = { candidates: {}, selected: {}, round };
      const concept = state.concept;
      // Önceki tur seçimi yeni turda da ilk aday olarak kalır (beğenilen görsel kaybolmasın).
      for (const [id, sel] of Object.entries(previous?.selected ?? {})) concept.candidates[id] = [sel];

      const jobs = [
        ...cast.characters.flatMap((c) =>
          [1, 2, 3].map((n) => ({
            id: c.id,
            seed: round * 10 + n,
            prompt: `Character design reference of ${c.name}: ${c.visualDescription}. Full body, three-quarter view, neutral pose and expression, exactly one person, simple uncluttered background in the style's palette`,
          })),
        ),
        ...cast.locations.flatMap((l) =>
          [1, 2].map((n) => ({
            id: l.id,
            seed: round * 10 + n,
            prompt: `Establishing wide view of ${l.name}: ${l.visualDescription}. No people`,
          })),
        ),
      ];

      await mapLimit(jobs, this.deps.concurrency ?? 3, async (job) => {
        const style = state.style!;
        const res = await this.deps.gateway.generate(
          {
            capability: "t2i",
            quality: state.input.tier === "premium" ? "hero" : "standard",
            prompt: `${style.promptPrefix}. ${job.prompt}. ${FRAME_RULES}`,
            negativePrompt: [...style.negativeRules, FRAME_NEGATIVE].join(", "),
            aspectRatio: this.aspect(state),
            seed: job.seed,
          },
          this.runOptions(state, "concept", opts.signal, job.id),
        );
        (concept.candidates[job.id] ??= []).push({ key: res.files[0]!.key, mimeType: res.files[0]!.mimeType });
        this.log(`  ${job.id} aday ✓ (${res.providerId})`);
      });

      // Önceki seçim korunur; otomatik onayda seçimsiz varlık için ilk aday seçilir.
      for (const [id, list] of Object.entries(concept.candidates)) {
        const kept = previous?.selected[id];
        if (kept) concept.selected[id] = kept;
        else if (state.input.autoApprove && list[0]) concept.selected[id] = list[0];
      }
    },

    voice: async (state, opts) => {
      if (!state.script) throw new Error("script yok");
      state.voice ??= {};
      const voice = state.voice;
      const { gateway } = this.deps;
      const todo = state.script.scenes.filter((s) => !voice[s.id]);
      if (todo.length === 0) return;

      const requestFor = (text: string): GenerationRequest => {
        const base: GenerationRequest = {
          capability: "tts_timestamps",
          quality: "standard",
          text,
          voiceId: state.input.voiceId,
          language: state.input.lang,
        };
        // Zamanlamalı TTS (ElevenLabs) seçilemiyorsa düz TTS + tahmini zamanlama.
        const policy = this.runOptions(state, "voice").policy;
        return gateway.plan(base, policy).length > 0 ? base : { ...base, capability: "tts" };
      };

      // Bölüm tek bir sesle anlatılır: ilk sahneyi üreten sağlayıcıya sabitlenir.
      // Ortada başka sağlayıcıya düşmek anlatıcının sesini değiştirirdi.
      const sample = requestFor(todo[0]!.narration);
      const provider =
        state.voiceProviderId ?? gateway.plan(sample, this.runOptions(state, "voice").policy)[0]?.adapter.id;
      if (!provider) throw new Error("Seslendirme için uygun sağlayıcı yok");

      // Kota ön kontrolü: para harcamadan, yarıda kalmadan önce.
      const chars = todo.reduce((n, s) => n + s.narration.length, 0);
      const quota = await gateway.quota(provider);
      if (quota && quota.unit === "chars" && quota.limit - quota.used < chars) {
        const reset = quota.resetsAt ? `, yenilenme ${new Date(quota.resetsAt).toLocaleDateString("tr-TR")}` : "";
        throw new QuotaError(
          `${provider} kotası yetmiyor: ${chars.toLocaleString("tr-TR")} karakter gerekli, ${(quota.limit - quota.used).toLocaleString("tr-TR")} kaldı (${quota.plan ?? "plan"}${reset}). Sesi değiştir veya planı yükselt.`,
        );
      }

      for (const scene of todo) {
        const run = this.runOptions(state, "voice", opts.signal, scene.id);
        run.policy = { ...run.policy, allow: [provider] };
        const res = await gateway.generate(requestFor(scene.narration), run);
        state.voiceProviderId = res.providerId;
        const file = res.files[0]!;
        const bytes = await this.bytes(file.key);
        const durationMs = await probeDurationMs(bytes, EXT[file.mimeType] ?? "bin");
        const sceneVoice: SceneVoice = {
          key: file.key,
          mimeType: file.mimeType,
          durationMs,
          words: res.words ?? estimateWordTimings(scene.narration, durationMs),
          estimatedTiming: !res.words,
        };
        voice[scene.id] = sceneVoice;
        await this.save(state);
        this.log(`  ${scene.id}: ${(durationMs / 1000).toFixed(1)} sn (${res.providerId})`);
      }
    },

    shots: async (state) => {
      const { script, voice, style } = state;
      if (!script || !voice || !style) throw new Error("script/voice/style yok");
      const durations = Object.fromEntries(script.scenes.map((s) => [s.id, (voice[s.id]?.durationMs ?? 0) / 1000]));
      const motionMode = motionModeOf(state.input);
      state.shotPlan = await this.agent(
        state,
        "shots",
        director(
          script,
          style,
          durations,
          { aiClipRatio: state.input.aiClipRatio, motionMode, cast: state.cast },
          this.deps.agentDeps,
        ),
      );
      state.shots = resolveShotTimes(
        state.shotPlan,
        script.scenes.map((s) => s.id),
        voice,
      );
      // Tek tip hareket: ajan karıştırsa bile mod kesin uygulanır (stil/animasyon karışması göze batıyor).
      if (motionMode !== "mixed") {
        for (const s of state.shots) s.kind = motionMode === "animated" ? "ai_clip" : "still_motion";
      }
      state.keyframes = {};
      state.qa = {};
      state.clips = {};
      this.log(`  ${state.shots.length} çekim (${state.shots.filter((s) => s.kind === "ai_clip").length} AI klip)`);
    },

    keyframes: async (state, opts) => {
      const { shots, style } = state;
      if (!shots || !style) throw new Error("shots/style yok");
      state.keyframes ??= {};
      const keyframes = state.keyframes;
      const todo = shots.filter((s) => !keyframes[s.id]);

      const qaOn = state.input.qa !== false;
      const redraws = this.deps.qaRedraws ?? 1;
      state.qa ??= {};
      const qa = state.qa;

      await mapLimit(todo, this.deps.concurrency ?? 3, async (shot) => {
        let prompt = shot.imagePrompt;
        let best: { ref: AssetRef; qa?: FrameQa } | undefined;
        let attempts = 0;
        for (let attempt = 1; attempt <= 1 + (qaOn ? redraws : 0); attempt++) {
          attempts = attempt;
          const res = await this.keyframe(state, "keyframes", prompt, shot.characterIds, shot.locationId, opts.signal, shot.id);
          const ref = { key: res.files[0]!.key, mimeType: res.files[0]!.mimeType };
          const review = qaOn ? await this.inspect(state, shot, ref, attempt) : undefined;
          if (!best || frameRank(review) > frameRank(best.qa)) best = { ref, qa: review };
          this.log(
            `  ${shot.id} ${review ? (review.passed ? "✓" : "✗") : "✓"} (${res.providerId}${res.cacheHit ? ", önbellek" : ""}${review && !review.skipped ? `, kontrol ${review.score}/10` : ""}${review?.issues.length ? `: ${review.issues.map((i) => i.type).join(", ")}` : ""})`,
          );
          if (!review || review.passed) break;
          prompt = redrawPrompt(shot.imagePrompt, review);
        }
        keyframes[shot.id] = best!.ref;
        if (best!.qa) qa[shot.id] = { ...best!.qa, attempts };
        await this.save(state);
      });
    },

    clips: async (state, opts) => {
      const { shots, keyframes } = state;
      if (!shots || !keyframes) throw new Error("shots/keyframes yok");
      state.clips ??= {};
      const clips = state.clips;
      const todo = shots.filter((s) => s.kind === "ai_clip" && !clips[s.id] && keyframes[s.id]);
      if (todo.length === 0) return;

      await mapLimit(todo, this.deps.concurrency ?? 3, async (shot) => {
        const kf = keyframes[shot.id]!;
        const shotSec = (shot.endMs - shot.startMs) / 1000;
        const clipSec = shotSec <= 5.5 ? 5 : 10;
        try {
          const res = await this.deps.gateway.generate(
            {
              capability: "i2v",
              quality: "standard",
              // Klip modeli kareyi yeniden yorumlayabiliyor; stil ve kadro sabit kalsın.
              prompt: `${shot.motionPrompt}. Keep the exact art style, colors and character designs of the first frame; no new characters, no text.`,
              refs: [{ role: "first_frame", bytes: await this.bytes(kf.key), mimeType: kf.mimeType }],
              durationSec: clipSec,
              aspectRatio: this.aspect(state),
            },
            this.runOptions(state, "clips", opts.signal, shot.id),
          );
          clips[shot.id] = { key: res.files[0]!.key, mimeType: res.files[0]!.mimeType, durationSec: clipSec };
          await this.save(state);
          this.log(`  ${shot.id} klip ✓ (${res.providerId})`);
        } catch (e) {
          // Klip üretilemezse çekim hareketlendirilmiş resim olarak kalır; bölüm durmaz.
          this.log(`  ${shot.id} klip atlandı: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },

    timeline: async (state) => {
      state.timeline = buildTimeline(state, (key) => key);
      const sec = state.timeline.durationInFrames / state.timeline.fps;
      this.log(`  ${(sec / 60).toFixed(1)} dk, ${state.timeline.visuals.length} görsel`);
    },

    render: async (state) => {
      const timeline = state.timeline;
      if (!timeline) throw new Error("timeline yok");
      const dir = resolve(this.deps.workDir, state.id);
      const publicDir = join(dir, "public");

      // Depodaki (yerel veya S3) varlıkları render klasörüne indir; klipleri render formatına çevir.
      const clipKeys = new Set(timeline.visuals.filter((v) => v.kind !== "still_motion").map((v) => v.assetUrl));
      const keys = new Set([...timeline.visuals.map((v) => v.assetUrl), ...timeline.audio.map((a) => a.assetUrl)]);
      for (const key of keys) {
        const target = join(publicDir, ...key.split("/"));
        await mkdir(dirname(target), { recursive: true });
        if (!clipKeys.has(key)) {
          await writeFile(target, await this.bytes(key));
          continue;
        }
        const raw = `${target}.src`;
        await writeFile(raw, await this.bytes(key));
        await normalizeClip(raw, target, timeline.width, timeline.height, timeline.fps);
        await rm(raw, { force: true });
      }

      const outputPath = join(dir, `${state.id}.mp4`);
      let lastPct = -1;
      await renderEpisode({
        timeline,
        publicDir,
        outputPath,
        onProgress: (p) => {
          const pct = Math.floor(p * 10) * 10;
          if (pct !== lastPct) this.log(`  render %${(lastPct = pct)}`);
        },
      });
      state.render = { path: outputPath, at: new Date().toISOString() };
      this.log(`  ✓ ${outputPath}`);
    },
  };
}
