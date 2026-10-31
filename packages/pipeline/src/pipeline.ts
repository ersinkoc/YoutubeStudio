import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  artDirector,
  castingDirector,
  director,
  frameInspector,
  screenwriter,
  sceneCritic,
  stylePicker,
  scriptDoctor,
  storyArchitect,
  vectorDesigner,
  AgentError,
  propPhysics,
  assetGate,
  assetPlanner,
  gateDescription,
  assetGuess,
  type AgentImage,
  type VectorAssetOut,
  vectorDirector,
  type VectorAssetBrief,
  type AgentDeps,
  type AgentResult,
  type EpisodeBrief,
  type ScriptOut,
  type ShotPlanOut,
  type CastOut,
} from "@ys/agents";
import { createHash } from "node:crypto";
import {
  AssetPlan,
  betterGate,
  STYLE_CUSTOM,
  STYLE_PACKS,
  styleFromPack,
  stylePackOf,
  gatePasses,
  DRAFT_REVIEW,
  QUALITY_GATE,
  resolveLayout,
  RIG,
  sanitizeSvg,
  stripBackdrop,
  svgSize,
  usd,
  VectorAssetMeta,
  type AssetCheck,
  type GateScores,
  type LineStyle,
  type ModelSettings,
  type Timeline,
  type VectorAsset,
} from "@ys/core";
import type {
  AspectRatio,
  CostLedger,
  GenerationRequest,
  MediaGateway,
  RefInput,
  RunOptions,
} from "@ys/media-gateway";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import { renderEpisode, renderStills } from "@ys/video/render";
import { readFile } from "node:fs/promises";
import { curateLessons } from "./curate.ts";
import { loadModelSettings } from "./settings.ts";
import { acquireLock } from "./lock.ts";
import { listLibraryCharacters, noteCharacterUse, type LibraryCharacter } from "./library.ts";
import { lineStyleOf } from "./state.ts";
import { seriesEpisodeIds, seriesOf, seriesStylePack } from "./series.ts";
import { EpisodeRepo } from "./actions.ts";
import { loadLessons, mergeLessons, saveLessons, topLessons, type LessonBook } from "./lessons.ts";
import { invalidateFrom, missingSelections, newEpisodeState } from "./actions.ts";
import { mapLimit, normalizeClip, probeDurationMs } from "./media.ts";
import { anonymizeNames, castAliases } from "./names.ts";
import { generateFlag, generateMap } from "./geo.ts";
import { findReferences, findVectorSources, rasterizeSvg, searchQuery, type References } from "./reference.ts";
import { frameRank, judgeFrame, QA_MAX_BYTES, redrawPrompt } from "./qa.ts";
import {
  ACTIVITY_LIMIT,
  STAGES,
  gateBefore,
  isApproved,
  motionModeOf,
  type ActivityEntry,
  type AssetRef,
  type EpisodeInput,
  type FrameQa,
  type PlannedShotState,
  type EpisodeState,
  type SceneVoice,
  type Stage,
} from "./state.ts";
import { buildTimeline, clipSeconds, estimateWordTimings, resolveShotTimes } from "./timing.ts";
import type { EpisodeReview } from "./state.ts";

/** Günlük satırının önemi: aşama başlangıcı, uyarı (atlanan/başarısız alt adım) ya da bilgi. */
const WARN = /atlandı|başarısız|çizilemedi|geçersiz|yapılamadı|kullanılamadı|hata/i;
export const levelOf = (message: string): ActivityEntry["level"] =>
  message.startsWith("▶") ? "stage" : WARN.test(message) ? "warn" : "info";

/**
 * Vektör varlık tasarım sürümü (kütüphane anahtarının parçası). 30 Eki: karakterler iskelet v2; arka planlar
 * mobilyasız oda kabuğu + zemin çizgisi (shell2: orta bant boş, raf kalabalığı yok); nesneler gerçek boy ve yüzey bilgisiyle.
 */
/** Tasarım isteği: gerçek bir özneyse internetten referans görsel aranacak sorgu. */
type AssetBrief = VectorAssetBrief & { reference?: string; /** Kadro ya da nesne kimliği. */ id?: string };

/** Harita/bayrak üreticisinin sürümü (kütüphane anahtarının parçası). */
const GEO_VERSION = "geo1";

const ASSET_VERSION: Record<VectorAssetBrief["kind"], string> = { character: "rig2", background: "shell2", prop: "meta1" };

interface GateResult {
  scores: GateScores;
  /** Adı bilmeyen denetçinin tahmini. */
  guess: string;
  defects: string[];
}

/** Tasarımcı çıktısından yerleşim bilgisi (boy, yüzey, zemin çizgisi). */
function metaOf(out: VectorAssetOut, kind: AssetBrief["kind"]): VectorAssetMeta {
  return { realHeight: out.realHeight, grounded: out.grounded, surface: out.surface, floorY: kind === "background" ? out.floorY : undefined };
}

/** Kalite kapısını geçemeyen SVG: kullanılmaz (nesne çekimden düşer, karakter/mekân konsepti durdurur). */
export class AssetRejectedError extends Error {}

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
  /** Henüz duruma yazılmamış günlük satırları; bir sonraki save() ile kalıcı olur. */
  private pending: ActivityEntry[] = [];
  private currentStage?: Stage;
  /** Kayıtlar sıraya konur: paralel alt adımlar eski durumu yenisinin üstüne yazmasın. */
  private saving: Promise<void> = Promise.resolve();

  /** Kullanıcının model seçimi; her çalıştırmanın başında depodan okunur (Stüdyo'da değişince sonraki çalıştırmada geçerli). */
  private models: ModelSettings = {};
  private get agentDeps(): AgentDeps {
    return { ...this.deps.agentDeps, models: { ...this.deps.agentDeps?.models, ...this.models } };
  }

  constructor(private readonly deps: PipelineDeps) {
    this.log = (message) => {
      deps.log?.(message);
      this.pending.push({ at: new Date().toISOString(), stage: this.currentStage, level: levelOf(message), msg: message.trim() });
    };
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
    if (this.pending.length) {
      state.activity = [...(state.activity ?? []), ...this.pending.splice(0)].slice(-ACTIVITY_LIMIT);
    }
    state.heartbeatAt = new Date().toISOString();
    const write = this.saving.then(async () => {
      await putJson(this.deps.store, this.stateKey(state.id), state);
    });
    this.saving = write.catch(() => {});
    await write;
  }

  async run(id: string, opts: RunEpisodeOptions = {}): Promise<EpisodeState> {
    const release = await acquireLock(this.deps.store, id);
    try {
      return await this.runLocked(id, opts);
    } finally {
      await release().catch(() => {});
    }
  }

  private async runLocked(id: string, opts: RunEpisodeOptions): Promise<EpisodeState> {
    const state = await this.load(id);
    this.models = await loadModelSettings(this.deps.store);
    const chosen = Object.entries(this.models);
    if (chosen.length) this.log(`  model seçimi: ${chosen.map(([role, model]) => `${role} → ${model}`).join(", ")}`);
    if (opts.only) {
      this.currentStage = opts.only;
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
        this.log(`⏸ onay bekleniyor: ${gate}`);
        await this.save(state);
        return state;
      }
      this.currentStage = stage;
      this.log(`▶ ${stage}`);
      await this.runStage(state, stage, opts);
    }
    return state;
  }

  /** Aşamayı çalıştırır; süresini ve (varsa) hatasını kalıcı olarak bölüm durumuna yazar. */
  private async runStage(state: EpisodeState, stage: Stage, opts: RunEpisodeOptions): Promise<void> {
    const started = Date.now();
    this.currentStage = stage;
    state.stats = { ...state.stats, [stage]: { startedAt: new Date(started).toISOString() } };
    delete state.lastError;
    delete state.renderPct;
    await this.save(state);
    const finish = () => {
      state.stats![stage] = { ...state.stats![stage]!, endedAt: new Date().toISOString(), durationMs: Date.now() - started };
    };
    try {
      await this.stages[stage](state, opts);
    } catch (e) {
      finish();
      state.lastError = { stage, message: e instanceof Error ? e.message : String(e), at: new Date().toISOString() };
      this.pending.push({ at: state.lastError.at, stage, level: "error", msg: state.lastError.message });
      await this.save(state);
      throw e;
    }
    finish();
    state.done[stage] = new Date().toISOString();
    this.pending.push({ at: state.done[stage]!, stage, level: "stage", msg: `✓ ${stage} (${((Date.now() - started) / 1000).toFixed(0)} sn)` });
    await this.save(state);
    this.currentStage = undefined;
  }

  // ---------------- yardımcılar ----------------

  private brief(state: EpisodeState): EpisodeBrief {
    const { topic, lang, targetSec, styleHint } = state.input;
    return { topic, lang, targetSec, styleHint };
  }

  private async agent<T>(state: EpisodeState, stage: Stage, call: Promise<AgentResult<T>>): Promise<T> {
    let res: AgentResult<T>;
    try {
      res = await call;
    } catch (e) {
      // Başarısız çağrı da ödendi (tur sınırı, şemaya uymayan çıktı): maliyeti görünmezse Claude harcaması eksik kalır.
      if (e instanceof AgentError && e.costUsd > 0) {
        state.agentCostUsd += e.costUsd;
        this.log(`  ajan ${e.agent ?? "?"} başarısız · $${e.costUsd.toFixed(3)}`);
        await this.deps.ledger.record({
          at: new Date().toISOString(),
          episodeId: state.id,
          stage,
          // Ajan adı defterde: günlüğün son 400 satırı dışında da ajan başına maliyet görülebilsin.
          refId: e.agent,
          providerId: `claude:${e.model ?? "?"}`,
          capability: "llm",
          estimateMicros: usd(e.costUsd),
          cacheHit: false,
          requestHash: `${stage}:${state.id}`,
          error: e.message.slice(0, 300),
        });
      }
      throw e;
    }
    state.agentCostUsd += res.costUsd;
    this.log(`  ajan ${res.name} · ${res.model.replace(/^claude-/, "")} · $${res.costUsd.toFixed(3)} · ${(res.durationMs / 1000).toFixed(0)} sn`);
    // Uzun aşamalarda (senaryo, sahne planı) her ajan çağrısı Stüdyo'da anında görünsün.
    await this.save(state);
    await this.deps.ledger.record({
      at: new Date().toISOString(),
      episodeId: state.id,
      stage,
      refId: res.name,
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
    const aliases = castAliases(state.cast?.characters ?? []);
    const entries: { ref: AssetRef; label: string; role: RefInput["role"] }[] = [];
    for (const id of characterIds.slice(0, 3)) {
      const c = state.cast?.characters.find((x) => x.id === id);
      const ref = selected[id];
      if (c && ref) entries.push({ ref, role: "character", label: `${aliases.get(id)} (character: keep face, hair, body and clothing exactly as in the reference)` });
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
          this.agentDeps,
        ),
      );
      return judgeFrame(out, attempt);
    } catch (e) {
      this.log(`  ${shot.id}: kare kontrolü yapılamadı (${e instanceof Error ? e.message : String(e)})`);
      return { score: 0, issues: [], attempts: attempt, passed: true, skipped: "denetim hatası" };
    }
  }

  // ---------------- vektör modu ----------------

  /** Kütüphane anahtarı: aynı tarif, stil ve çizgi stili için SVG bir kez çizilir, bölümler arasında yeniden kullanılır. */
  private libraryKey(state: EpisodeState, brief: AssetBrief & { lineStyle: LineStyle }): string {
    const style = state.style!;
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          brief.kind,
          brief.name,
          brief.description,
          brief.variation ?? 0,
          style.artStyle,
          style.palette,
          // Tasarım kuralları değişince (iskelet, oda kabuğu, fizik bilgisi) varlık yeniden çizilir.
          ASSET_VERSION[brief.kind],
          brief.lineStyle,
          // Referanstan çizilenler ayrı anahtar alır; referanssız eski varlıkların anahtarı değişmez.
          ...(brief.reference ? [`ref:${brief.reference.trim().toLowerCase()}`] : []),
        ]),
      )
      .digest("hex")
      .slice(0, 32);
    return `library/vector/${brief.kind}/${hash}.svg`;
  }

  /**
   * Kalite kapısı: çizim PNG'ye çevrilir, önce adı bilmeyen denetçi ne olduğunu söyler, sonra amaçlanan özneyle (ve
   * varsa gerçek referanslarla) puanlanır. Denetim yapılamazsa hata fırlatılır: denetlenmemiş çizim kullanılmaz.
   */
  private async gateCheck(
    state: EpisodeState,
    stage: Stage,
    brief: AssetBrief,
    svg: string,
    references: AgentImage[] | undefined,
    plan?: AssetPlan,
  ): Promise<GateResult> {
    const drawing = await rasterizeSvg(svg);
    const guess = await this.agent(state, stage, assetGuess(drawing, this.agentDeps));
    const gate = await this.agent(
      state,
      stage,
      assetGate(
        {
          kind: brief.kind,
          name: brief.name,
          description: gateDescription(brief.description, plan),
          guess,
          drawing,
          references,
          style: state.style && { artStyle: state.style.artStyle, palette: state.style.palette },
        },
        this.agentDeps,
      ),
    );
    return {
      // Referanslar konuyu göstermiyorsa denetçi sadakat vermez (null): yalnız tanınırlıkla karar verilir.
      scores: {
        recognizable: gate.recognizable,
        fidelity: references && gate.fidelity !== null && state.input.realism !== false ? gate.fidelity : undefined,
      },
      guess: guess.guess,
      defects: gate.defects,
    };
  }

  /**
   * SVG varlığı: kütüphaneden ya da Claude'a çizdirerek, ama her durumda kalite kapısından geçirerek. Gerçek bir
   * özneyse (ve her nesne için) önce internetten referans görsel aranır, tasarımcı ona bakarak çizer. Kapıyı geçemeyen
   * çizim kusur listesiyle yeniden çizilir (en çok QUALITY_GATE.maxDraws); hiçbiri geçemezse AssetRejectedError:
   * çizim kullanılmaz, Stüdyo'da reddedilen olarak görünür.
   */
  private async designAsset(state: EpisodeState, stage: Stage, rawBrief: AssetBrief): Promise<AssetRef> {
    const brief = { ...rawBrief, lineStyle: lineStyleOf(state) };
    // Karakter kimliği meta'ya yazılır: kütüphaneden başka bölümlerde tekrar kullanılabilsin.
    const identity =
      brief.kind === "character"
        ? {
            name: brief.name,
            description: brief.description,
            reference: brief.reference,
            pack: state.style?.pack,
            artStyle: state.style!.artStyle,
            lineStyle: brief.lineStyle,
            episodes: [],
          }
        : undefined;
    // İnsanın reddettiği çizim yerinde ezilmez (başka bölümler onu kullanıyor olabilir): yeniden çizim, reddin
    // zamanından türeyen yeni bir anahtara gider. Aynı bölümde tekrar reddedilirse zincir sürer, notlar birikir.
    const baseKey = this.libraryKey(state, brief);
    const decisionOf = async (k: string) =>
      VectorAssetMeta.safeParse((await getJson(this.deps.store, `${k}.json`)) ?? {}).data?.check?.override ?? state.assetChecks?.[k]?.override;
    let key = baseKey;
    let human = await decisionOf(key);
    const humanNotes: string[] = [];
    for (let i = 0; i < 20 && human?.decision === "rejected"; i++) {
      if (human.note) humanNotes.push(`- Human reviewer: ${human.note}`);
      key = `${baseKey.slice(0, baseKey.lastIndexOf("/") + 1)}${createHash("sha256").update(`${key}|${human.at}`).digest("hex").slice(0, 32)}.svg`;
      human = await decisionOf(key);
    }
    const humanFix = humanNotes.length ? humanNotes.join("\n") : undefined;
    const ref = { key, mimeType: "image/svg+xml" };
    const query = brief.reference ?? (brief.kind === "prop" ? searchQuery(brief.description) : undefined);
    let refs: References | undefined;
    const loadRefs = async () => {
      if (!refs && query) {
        refs = await findReferences(query, { store: this.deps.store, log: this.log });
        this.log(
          refs.images.length
            ? `  ${brief.name}: referans "${query}" → ${refs.sources.map((s) => s.title).join(" | ")}`
            : `  ${brief.name}: referans "${query}" için görsel bulunamadı, tarifle çiziliyor`,
        );
      }
      return refs?.images.length ? refs.images : undefined;
    };
    // Çizim planı varlık başına bir kez hazırlanır ve kütüphanede durur: yeniden çizimler ve devamlar aynı planı kullanır.
    const planKey = baseKey.replace(/\.svg$/, ".plan.json");
    let plan = (await getJson<AssetPlan>(this.deps.store, planKey)) ?? undefined;
    const makePlan = async (references: AgentImage[] | undefined) => {
      if (plan) return plan;
      try {
        const out = await this.agent(state, stage, assetPlanner({ ...brief, references }, state.style!, this.agentDeps));
        plan = AssetPlan.parse(out);
        await putJson(this.deps.store, planKey, plan);
        this.log(`  ${brief.name}: çizim planı → ${plan.subject}${plan.moved.length ? ` (bu çizime girmeyen: ${plan.moved.join("; ")})` : ""}`);
      } catch (e) {
        // Plan yardımcıdır: hazırlanamazsa tarifle çizilir.
        this.log(`  ${brief.name}: çizim planı hazırlanamadı, tarifle çiziliyor (${e instanceof Error ? e.message : String(e)})`);
      }
      return plan;
    };
    const record = (check: AssetCheck) => ((state.assetChecks ??= {})[key] = check);
    const checkOf = (r: GateResult, attempts: number): AssetCheck => ({
      kind: brief.kind,
      name: brief.name,
      guess: r.guess,
      recognizable: r.scores.recognizable,
      fidelity: r.scores.fidelity,
      passed: gatePasses(brief.kind, r.scores),
      defects: r.defects,
      attempts,
      query: refs?.images.length ? query : undefined,
      sources: refs?.sources ?? [],
      refs: refs?.keys ?? [],
      plan,
      fidelitySkipped: refs?.images.length && state.input.realism === false ? true : undefined,
      entityId: brief.id,
    });
    const scoreText = (r: { scores: GateScores; guess: string }) =>
      `tanınırlık ${r.scores.recognizable}/10 ("${r.guess}")${r.scores.fidelity !== undefined ? `, gerçeğe sadakat ${r.scores.fidelity}/10` : ""}`;

    // Kütüphanedeki çizim de denetlenmeden kullanılmaz (kapıdan önce çizilmiş eski varlıklar ilk kullanımda denetlenir).
    const cached = await this.deps.store.get(key);
    const meta = cached ? VectorAssetMeta.parse((await getJson(this.deps.store, `${key}.json`)) ?? {}) : undefined;
    let fix = humanFix;
    // Sadakati atlanmış (gerçeklik kapalı bölümde geçmiş) kayıt, gerçeklik açık bölümde güvenilmez: yeniden denetlenir.
    const trusted =
      meta?.check?.passed && (meta.check.override?.decision === "accepted" || !(meta.check.fidelitySkipped && state.input.realism !== false));
    if (cached && meta) {
      if (trusted) {
        if (identity && !meta.identity) await putJson(this.deps.store, `${key}.json`, { ...meta, identity });
        // Başka bölümün kaydı: sahibi bu bölümün varlığıdır (insan kararı yanlış varlığa uygulanmasın).
        record({ ...meta.check!, entityId: brief.id });
        this.log(`  ${brief.name}: kütüphaneden (kapı ✓)`);
        return ref;
      }
      const res = await this.gateCheck(state, stage, brief, new TextDecoder().decode(cached), await loadRefs(), plan);
      const check = checkOf(res, 0);
      if (check.passed) {
        await putJson(this.deps.store, `${key}.json`, { ...meta, check, identity: meta.identity ?? identity });
        record(check);
        this.log(`  ${brief.name}: kütüphaneden, kapı ✓ (${scoreText(res)})`);
        return ref;
      }
      this.log(`  ${brief.name}: kütüphanedeki çizim kapıdan geçemedi (${scoreText(res)}), yeniden çiziliyor`);
    }

    // Daha önce reddedilen en iyi deneme, bugünkü kurala göre geçiyorsa (ör. gerçeklik denetimi kapatıldı) para
    // harcamadan kullanılır.
    const previous = state.assetChecks?.[key];
    if (previous?.rejectedKey) {
      const scores = { recognizable: previous.recognizable, fidelity: state.input.realism === false ? undefined : previous.fidelity };
      const svg = await this.deps.store.get(previous.rejectedKey);
      const rejectedMeta = await getJson<VectorAssetMeta>(this.deps.store, `${previous.rejectedKey}.json`);
      if (svg && rejectedMeta && gatePasses(brief.kind, scores)) {
        const check = { ...previous, passed: true, fidelity: scores.fidelity, fidelitySkipped: state.input.realism === false || undefined, entityId: brief.id };
        await this.deps.store.put(key, svg, ref.mimeType);
        await putJson(this.deps.store, `${key}.json`, { ...rejectedMeta, check });
        record(check);
        this.log(`  ${brief.name}: önceki deneme bugünkü kurala göre geçiyor (gerçeklik denetimi kapalı), yeniden çizilmeden kullanılıyor`);
        return ref;
      }
      // Bu bölümde zaten reddedildi: her devamda, çökme sonrası yeniden başlatmada ve taslak düzeltmede yeniden çizmek
      // hiç yakınsamıyordu (31 Eki üretim verisi: tekrar çizimlerin %16'sı geçti, büyük bölümlerde Claude harcamasının
      // ~%40'ı). Yeni çizim insan kararıyla gelir: Stüdyo'da reddetmek (notlu ya da notsuz) yeni anahtara taze çizim açar.
      this.log(`  ${brief.name}: bu bölümde kalite kapısından reddedilmişti (${scoreText({ scores, guess: previous.guess })}), yeniden çizilmiyor`);
      throw new AssetRejectedError(`${brief.name}: kalite kapısı geçilemedi (önceki deneme); Stüdyo'da kabul et ya da yeniden çizdir`);
    }

    const references = await loadRefs();
    // Nesneler için önce Commons'ta hazır, serbest lisanslı vektör çizim denenir; kapıdan geçen ilk aday kullanılır.
    // İnsan bu varlığın bir çizimini reddettiyse (not var) hazır çizim aranmaz: insan belli bir şey istiyor.
    if (brief.kind === "prop" && query && !humanFix) {
      const found = await this.readyMadeProp(state, stage, brief, query, references, key, checkOf, scoreText);
      if (found) return found;
    }
    await makePlan(references);
    let best: { svg: string; out: VectorAssetOut; res: GateResult } | undefined;
    let lastError: unknown;
    let draws = 0;
    // Yeniden çizim önceki denemenin üzerinden yapılır ve önceki izleyici tahminleri birikir: yalnız son kusur listesiyle
    // baştan çizen tasarımcı gidip geliyordu (renk mavi → kırmızı → mavi; 31 Eki üretim verisi).
    let lastDrawing: string | undefined;
    const seen: string[] = [];
    const recognized: number[] = [];
    for (let attempt = 1; attempt <= QUALITY_GATE.maxDraws; attempt++) {
      draws = attempt;
      const lessons = topLessons(await loadLessons(this.deps.store), "designer");
      let out: VectorAssetOut;
      try {
        out = await this.agent(state, stage, vectorDesigner({ ...brief, lessons, references, fix, plan, previous: lastDrawing }, state.style!, this.agentDeps));
      } catch (e) {
        // Tasarımcının kendi hatası (uzun SVG'de şema denemesi tükendi, tur sınırı) bir çizim hakkını yer; plan ve önceki
        // kapı çağrıları boşa gitmesin diye varlık hemen düşürülmez. Diğer hatalar (iptal vb.) yukarı çıkar.
        if (!(e instanceof AgentError)) throw e;
        lastError = e;
        this.log(`  ${brief.name}: deneme ${attempt} tasarımcı hatası (${e.message.split("\n")[0]})`);
        continue;
      }
      let svg: string;
      try {
        const clean = sanitizeSvg(out.svg);
        svg = brief.kind === "background" ? clean : stripBackdrop(clean, svgSize(clean));
        if (brief.kind === "character") {
          const missing = RIG.required.filter((id) => !svg.includes(`id="${id}"`));
          if (missing.length) throw new Error(`iskelet parçası eksik: ${missing.join(", ")}`);
        }
      } catch (e) {
        lastError = e;
        fix = [humanFix, `- The SVG was invalid: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join("\n");
        this.log(`  ${brief.name}: deneme ${attempt} geçersiz SVG (${e instanceof Error ? e.message : String(e)})`);
        continue;
      }
      const res = await this.gateCheck(state, stage, brief, svg, references, plan);
      const passed = gatePasses(brief.kind, res.scores);
      if (betterGate(brief.kind, res.scores, best?.res.scores)) best = { svg, out, res };
      this.log(`  ${brief.name}: deneme ${attempt}, ${scoreText(res)} ${passed ? "✓" : "✗"}`);
      if (passed) break;
      recognized.push(res.scores.recognizable);
      if (attempt < QUALITY_GATE.maxDraws && recognized.length >= 2 && recognized.slice(0, 2).every((s) => s <= QUALITY_GATE.hopelessAtMost)) {
        this.log(`  ${brief.name}: iki çizim de tanınmadı (≤${QUALITY_GATE.hopelessAtMost}/10), yeniden çizilmiyor; karar insanın`);
        break;
      }
      seen.push(res.guess);
      lastDrawing = svg;
      fix = [
        ...(humanFix ? [humanFix] : []),
        `- Viewers who did not know the name saw: ${seen.map((g) => `"${g}"`).join(", then ")}. It must read clearly as: ${plan?.subject ?? brief.name}.`,
        ...res.defects.map((d) => `- ${d}`),
      ].join("\n");
    }
    if (!best) throw lastError;

    const check = checkOf(best.res, draws);
    if (!check.passed) {
      // En iyi deneme yalnız Stüdyo'da gösterilmek için saklanır; üretimde kullanılmaz.
      const rejectedKey = key.replace(/\.svg$/, ".rejected.svg");
      await this.deps.store.put(rejectedKey, new TextEncoder().encode(best.svg), ref.mimeType);
      await putJson(this.deps.store, `${rejectedKey}.json`, { ...metaOf(best.out, brief.kind), identity });
      record({ ...check, rejectedKey });
      this.log(`  ✗ REDDEDİLDİ ${brief.name}: ${draws} denemede kalite kapısı geçilemedi (${scoreText(best.res)}): ${best.res.defects.join("; ")}`);
      throw new AssetRejectedError(`${brief.name}: kalite kapısı geçilemedi (${scoreText(best.res)})`);
    }

    await this.deps.store.put(key, new TextEncoder().encode(best.svg), ref.mimeType);
    // Fiziksel bilgi SVG'nin yanında: yerleşim çözücüsü boy, yüzey ve zemin çizgisini buradan alır.
    await putJson(this.deps.store, `${key}.json`, { ...metaOf(best.out, brief.kind), check, identity });
    record(check);
    this.log(`  ${brief.name}: çizildi (${(best.svg.length / 1024).toFixed(1)} KB, ${draws} deneme)`);
    return ref;
  }

  /**
   * Hazır SVG (Commons, kamu malı/CC0): temizlenir, arka planı atılır, kapıdan geçerse fiziksel bilgisiyle kütüphaneye
   * yazılır. Geçmezse undefined: tasarımcı çizer. Para: aday başına kapı (~$0.004) + bir kez boy ajanı (~$0.001).
   */
  private async readyMadeProp(
    state: EpisodeState,
    stage: Stage,
    brief: AssetBrief,
    query: string,
    references: AgentImage[] | undefined,
    key: string,
    checkOf: (r: GateResult, attempts: number) => AssetCheck,
    scoreText: (r: { scores: GateScores; guess: string }) => string,
  ): Promise<AssetRef | undefined> {
    let sources: Awaited<ReturnType<typeof findVectorSources>> = [];
    try {
      sources = await findVectorSources(query, { store: this.deps.store, log: this.log });
    } catch (e) {
      this.log(`  ${brief.name}: hazır SVG aranamadı (${e instanceof Error ? e.message : String(e)})`);
    }
    for (const candidate of sources) {
      let svg: string;
      try {
        svg = stripBackdrop(candidate.svg, svgSize(candidate.svg));
      } catch {
        continue;
      }
      const res = await this.gateCheck(state, stage, brief, svg, references);
      const passed = gatePasses(brief.kind, res.scores);
      this.log(`  ${brief.name}: hazır SVG "${candidate.source.title}" (${candidate.source.license}) → ${scoreText(res)} ${passed ? "✓" : "✗"}`);
      if (!passed) continue;
      const physics = await this.agent(state, stage, propPhysics(brief.name, brief.description, this.agentDeps));
      const base = checkOf(res, 0);
      const check: AssetCheck = { ...base, sources: [candidate.source, ...base.sources] };
      await this.deps.store.put(key, new TextEncoder().encode(svg), "image/svg+xml");
      await putJson(this.deps.store, `${key}.json`, {
        realHeight: physics.realHeight,
        grounded: physics.grounded,
        surface: physics.surface ?? undefined,
        check,
      });
      (state.assetChecks ??= {})[key] = check;
      return { key, mimeType: "image/svg+xml" };
    }
    return undefined;
  }

  /** Konsept: karakter ve mekânlar SVG olarak; her tur yeni bir çeşitleme ekler, eskiler seçilebilir kalır. */
  private async vectorConcept(state: EpisodeState, regenerate = false): Promise<void> {
    const cast = state.cast!;
    const previous = state.concept;
    // "Yeni adaylar üret" yeni tur açar; kalite kapısında durmuş bir konsepte devam ise yalnız eksikleri çizer.
    const resume = Boolean(previous) && !regenerate;
    const round = previous ? (previous.round ?? 0) + (resume ? 0 : 1) : 0;
    // Seçimler baştan korunur: aşama yarıda kalırsa kullanıcının seçimleri kaybolmasın.
    const concept: NonNullable<EpisodeState["concept"]> = { candidates: {}, selected: { ...previous?.selected }, round };
    for (const [id, list] of Object.entries(previous?.candidates ?? {})) concept.candidates[id] = [...list];
    state.concept = concept;

    const jobs: { id: string; brief: VectorAssetBrief }[] = [
      ...cast.characters.map((c) => ({
        id: c.id,
        brief: { kind: "character" as const, id: c.id, name: c.name, description: c.visualDescription, variation: round || undefined, reference: c.reference },
      })),
      ...cast.locations.map((l) => ({
        id: l.id,
        brief: { kind: "background" as const, id: l.id, name: l.name, description: l.visualDescription, variation: round || undefined, reference: l.reference },
      })),
    ];
    const rejected: string[] = [];
    // Casting'in kütüphaneden seçtiği karakterler çizilmez: onaylı çizim olduğu gibi kullanılır.
    const library = new Map((await this.libraryFor(state)).map((l) => [l.id, l]));
    for (const c of cast.characters) {
      const hit = c.reuse ? library.get(c.reuse) : undefined;
      if (!hit || concept.candidates[c.id]?.some((r) => r.key === hit.key)) continue;
      (concept.candidates[c.id] ??= []).push({ key: hit.key, mimeType: "image/svg+xml" });
      concept.selected[c.id] ??= { key: hit.key, mimeType: "image/svg+xml" };
      const check = VectorAssetMeta.parse(/* v8 ignore next -- kütüphane listesi yalnız metası olan karakterleri verir */ (await getJson(this.deps.store, `${hit.key}.json`)) ?? {}).check;
      if (check) (state.assetChecks ??= {})[hit.key] = { ...check, entityId: c.id };
      this.log(`  ♻ ${c.name}: kütüphaneden (${hit.episodes.length} bölümde kullanıldı), çizilmedi`);
    }
    const reusedIds = new Set(cast.characters.filter((c) => c.reuse && library.has(c.reuse)).map((c) => c.id));
    const pending = jobs.filter((j) => !(reusedIds.has(j.id) && !regenerate));
    // Devam: seçimi olmayan varlıklar çizilir (hiç çizilmemiş ya da insanın reddettiği seçili çizim).
    const todo = resume ? pending.filter((j) => !concept.selected[j.id]) : pending;
    if (resume) this.log(`  devam: ${todo.length} eksik varlık çizilecek, ${jobs.length - todo.length} hazır`);
    await mapLimit(todo, this.deps.concurrency ?? 3, async (job) => {
      try {
        const ref = await this.designAsset(state, "concept", job.brief);
        const list = (concept.candidates[job.id] ??= []);
        if (!list.some((r) => r.key === ref.key)) list.push(ref);
        // Yeni tur önceki seçimi değiştirmez; seçimsiz varlık yeni çizimi seçer (yarıda kalırsa devam onu çizmez).
        if (!regenerate || !concept.selected[job.id]) concept.selected[job.id] ??= ref;
      } catch (e) {
        if (!(e instanceof AssetRejectedError)) throw e;
        rejected.push(job.brief.name);
      }
      await this.save(state);
    });
    // Kapıyı geçemeyen karakter/mekânla üretim sürmez: Stüdyo'da reddedilen çizim ve kusurları görünür, karar insanın.
    // Stüdyo bölümünde konsept zaten insan onayı bekler; seçimi eksik varlık onayı engeller (kabul et ya da yeniden çiz).
    if (rejected.length && !state.input.autoApprove) {
      this.log(`  ⏸ kalite kapısı: ${rejected.join(", ")} reddedildi; Stüdyo'da kabul et ya da notla yeniden çizdir`);
    } else if (rejected.length) {
      throw new AssetRejectedError(
        `Kalite kapısı: ${rejected.join(", ")} kabul edilebilir çizilemedi. Konsept sekmesinde kusurları gör; "Yeni adaylar üret" ile yeniden çizdir.`,
      );
    }
    // Tek aday üretildiği için seçim beklenmez: önceki seçim korunur, yoksa en yeni çeşitleme seçilir.
    for (const [id, list] of Object.entries(concept.candidates)) {
      concept.selected[id] = previous?.selected[id] ?? list.at(-1)!;
    }
    // Seçilen karakterler kütüphanede bu bölümle anılır (Stüdyo'da "N bölümde").
    for (const c of cast.characters) {
      const sel = concept.selected[c.id];
      if (sel) await noteCharacterUse(this.deps.store, sel.key, state.id);
    }
  }

  /** Bu bölümün stilinde (stil + çizgi stili) kütüphanedeki karakterler. */
  private async libraryFor(state: EpisodeState): Promise<LibraryCharacter[]> {
    if (!state.style) return [];
    const list = await listLibraryCharacters(this.deps.store, {
      artStyle: state.style.artStyle,
      lineStyle: lineStyleOf(state),
      realism: state.input.realism !== false,
    });
    // Aynı serinin karakterleri önce (casting listesi 40 ile sınırlı).
    const series = seriesEpisodeIds(await new EpisodeRepo(this.deps.store).list(), state);
    if (!series.size) return list;
    const inSeries = (c: LibraryCharacter) => c.episodes.some((id) => series.has(id));
    return [...list.filter(inSeries), ...list.filter((c) => !inSeries(c))];
  }

  /** Çekim planı: sahne başına bir yönetmen çağrısı; çıktı kısa JSON, çizim ve hareket kodda. */
  /**
   * Bir sahneyi vektör yönetmenine planlatır ve çıktıyı doğrular: bilinmeyen varlıklar atılır, "on"/"heldBy"
   * indeksleri kalan katmanlara yeniden eşlenir (atılan katmana işaret edeni bırakır), yeni nesne/mekânlar kaydedilir.
   */
  private async planVectorScene(
    state: EpisodeState,
    scene: NonNullable<EpisodeState["script"]>["scenes"][number],
    durationSec: number,
    lessons: string[],
    feedback?: string,
  ): Promise<ShotPlanOut["scenes"][number]["shots"]> {
    const { style, cast } = state;
    const props = (state.vectorProps ??= {});
    const characters = new Set(cast!.characters.map((c) => c.id));
    const locations = new Set(cast!.locations.map((l) => l.id));
    // Kapının reddettiği nesneler sunulmaz: yönetmen onları yeniden kullanıp sahneyi boş katmanla bırakıyordu.
    const known = Object.fromEntries(Object.entries(props).filter(([, p]) => !p.rejected).map(([id, p]) => [id, p.description]));
    const out = await this.agent(
      state,
      "shots",
      vectorDirector(
        { scene, durationSec, cast: cast!, props: known, lang: state.input.lang, lessons, feedback, vertical: state.input.height > state.input.width },
        style!,
        this.agentDeps,
      ),
    );
    // Reddedilmiş kimlikle gelen yeni tarif onun yerini alır (yeni tarif yeni anahtara, taze çizime gider).
    for (const np of out.newProps) if (!props[np.id] || props[np.id]!.rejected) props[np.id] = { description: np.description, kind: "prop", flag: np.flag, reference: np.reference };
    for (const nb of out.newBackgrounds) props[nb.id] ??= { description: nb.description, kind: "background", map: nb.map, reference: nb.reference };
    const isBackground = (id: string) => locations.has(id) || props[id]?.kind === "background";
    const usable = new Set([...characters, ...Object.keys(props).filter((id) => !isBackground(id))]);
    let dropped = 0;
    const shots = out.shots.map((s) => {
      const keep = s.spec.layers.map((l) => usable.has(l.asset));
      const remap = new Map<number, number>();
      keep.forEach((k, idx) => k && remap.set(idx, remap.size));
      const ref = (idx: number | undefined) => (idx === undefined ? undefined : remap.get(idx));
      const layers = s.spec.layers.flatMap((l, idx) => (keep[idx] ? [{ ...l, on: ref(l.on), heldBy: ref(l.heldBy) }] : []));
      dropped += s.spec.layers.length - layers.length;
      const background = s.spec.background && isBackground(s.spec.background) ? s.spec.background : undefined;
      return {
        startWord: s.startWord,
        characterIds: layers.filter((l) => characters.has(l.asset)).map((l) => l.asset),
        locationId: background ?? "",
        kind: "still_motion" as const,
        description: s.description,
        imagePrompt: "",
        motionPrompt: "",
        camera: "static" as const,
        ambience: s.ambience,
        vector: { ...s.spec, layers, background },
      };
    });
    this.log(
      `  ${scene.id}${feedback ? " (düzeltme)" : ""}: ${out.shots.length} çekim, ${out.newProps.length} yeni nesne, ${out.newBackgrounds.length} yeni mekân${dropped ? `, ${dropped} bilinmeyen katman atıldı` : ""}`,
    );
    return shots;
  }

  /** Çekim planı: sahne başına bir yönetmen çağrısı; çıktı kısa JSON, çizim, fizik ve hareket kodda. */
  private async vectorShots(state: EpisodeState, durations: Record<string, number>): Promise<void> {
    const { script, style, cast, voice } = state;
    if (!script || !style || !cast || !voice) throw new Error("script/style/cast/voice yok");
    const lessons = topLessons(await loadLessons(this.deps.store), "director");
    const planned = new Map<string, ShotPlanOut["scenes"][number]["shots"]>();
    // Sahne planının girdileri: değişirse eski taslak kullanılmaz.
    const sigOf = (scene: (typeof script.scenes)[number], duration: number) =>
      createHash("sha256")
        .update(JSON.stringify([scene, duration, style, cast.characters.map((c) => c.id), cast.locations.map((l) => l.id), state.input.width, state.input.height]))
        .digest("hex")
        .slice(0, 16);
    const draft = (state.shotPlanDraft ??= {});
    await mapLimit(script.scenes, this.deps.concurrency ?? 3, async (scene) => {
      /* v8 ignore next -- süreler senaryonun bütün sahnelerinden kurulur */
      const duration = durations[scene.id] ?? 0;
      const sig = sigOf(scene, duration);
      const saved = draft[scene.id];
      if (saved?.sig === sig) {
        planned.set(scene.id, saved.shots);
        this.log(`  ${scene.id}: önceki çalıştırmanın planı kullanıldı`);
        return;
      }
      const shots = await this.planVectorScene(state, scene, duration, lessons);
      planned.set(scene.id, shots);
      draft[scene.id] = { sig, shots };
      await this.save(state);
    });
    delete state.shotPlanDraft;
    state.shotPlan = { scenes: script.scenes.map((s) => ({ sceneId: s.id, shots: /* v8 ignore next -- her sahne planlanır; planlanamazsa mapLimit zaten fırlatır */ planned.get(s.id) ?? [] })) };
    state.shots = resolveShotTimes(state.shotPlan, script.scenes.map((s) => s.id), voice);
    state.keyframes = {};
    state.qa = {};
    state.clips = {};
    this.log(`  ${state.shots.length} vektör çekim, ${Object.keys(state.vectorProps ?? {}).length} nesne/mekân`);
  }

  /**
   * Timeline'dan çekim kareleri çıkarır ve ucuz görsel modele denetletir. Render sonrası inceleme ile render
   * öncesi taslak kontrolü aynı yolu kullanır.
   */
  private async critiqueShots(
    state: EpisodeState,
    stage: Stage,
    timeline: Timeline,
    dir: string,
    known: string[],
  ): Promise<{ files: Record<string, string>; review: EpisodeReview }> {
    /* v8 ignore next -- iki çağıran da (taslak denetimi, inceleme) çekimleri önceden denetler */
    const shots = state.shots ?? [];
    const files = await this.renderShotStills(timeline, dir);

    // O anda duyulan anlatım ve kodun yaptığı yerleşim düzeltmeleri, karenin değerlendirilmesi için.
    const spoken = (startMs: number, endMs: number) =>
      timeline.captions
        .filter((w) => w.startMs >= startMs && w.startMs < endMs)
        .map((w) => w.text)
        .join(" ");
    const review: EpisodeReview = { at: new Date().toISOString(), shots: {}, lessons: [] };
    const batches: (typeof shots)[] = [];
    for (let i = 0; i < shots.length; i += 6) batches.push(shots.slice(i, i + 6));
    await mapLimit(batches, this.deps.concurrency ?? 3, async (batch) => {
      const items = await Promise.all(
        batch
          .filter((s) => files[s.id])
          .map(async (s) => ({
            shotId: s.id,
            image: { data: new Uint8Array(await readFile(files[s.id]!)), mimeType: "image/jpeg" },
            intent: `${s.description} | narration: "${spoken(s.startMs, s.endMs)}"`,
          })),
      );
      if (!items.length) return;
      try {
        const out = await this.agent(state, stage, sceneCritic(items, known, this.agentDeps));
        for (const s of out.shots) review.shots[s.shotId] = { score: s.score, issues: s.issues };
        review.lessons.push(...out.lessons);
      } catch (e) {
        // İnceleme videoyu bozmaz; başarısız grup atlanır.
        this.log(`  inceleme grubu atlandı: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return { files, review };
  }

  /** Çekim başına bir kare (yerel Remotion, ücretsiz). `only` verilirse yalnız o çekimler. */
  private async renderShotStills(timeline: Timeline, dir: string, only?: Set<string>): Promise<Record<string, string>> {
    // Çekimin %80'i: giriş ve daktilo animasyonları bitmiş olur (ortadan alınca yarım yazı kusur sanılıyordu).
    const frames = Object.fromEntries(
      timeline.visuals.filter((v) => !only || only.has(v.shotId)).map((v) => [v.shotId, v.fromFrame + Math.floor(v.durationInFrames * 0.8)]),
    );
    const outDir = join(dir, "stills");
    await mkdir(outDir, { recursive: true });
    return renderStills({
      timeline,
      publicDir: join(dir, "public"),
      frames,
      outDir,
      onWait: (pid) => this.log(`  başka bir render sürüyor (süreç ${pid}); kareler için sıra bekleniyor`),
    });
  }

  /**
   * Çekim önizlemelerini depoya yazar (Stüdyo Çekimler sekmesi). Anahtar içerik hash'li: aynı çekim yeniden
   * çizildiğinde tarayıcı eski kareyi önbellekten göstermez.
   */
  private async storeStills(state: EpisodeState, files: Record<string, string>): Promise<void> {
    state.stills ??= {};
    for (const [shotId, file] of Object.entries(files)) {
      const bytes = new Uint8Array(await readFile(file));
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      const key = `assets/stills/${state.id}/${shotId}-${hash}.jpg`;
      await this.deps.store.put(key, bytes, "image/jpeg");
      state.stills[shotId] = { key, mimeType: "image/jpeg" };
    }
  }

  /** Taslak klasörü: ses dosyaları kopyalanır ki kareler render'dan önce çıkarılabilsin. */
  private async draftDir(state: EpisodeState): Promise<string> {
    const dir = resolve(this.deps.workDir, state.id, "draft");
    for (const v of Object.values(state.voice ?? {})) {
      const target = join(dir, "public", ...v.key.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await this.bytes(v.key));
    }
    return dir;
  }

  /** Render beklemeden önizleme: taslak denetimi kapalıyken de Çekimler sekmesi boş kalmasın. */
  private async vectorPreviews(state: EpisodeState, only?: Set<string>): Promise<void> {
    try {
      const dir = await this.draftDir(state);
      const timeline = buildTimeline(state, (key) => key, await this.vectorAssets(state));
      await this.storeStills(state, await this.renderShotStills(timeline, dir, only));
      this.log(`  önizleme: ${/* v8 ignore next -- çekim yoksa buildTimeline daha önce fırlatır */ only?.size ?? state.shots?.length ?? 0} çekim karesi`);
    } catch (e) {
      // Önizleme yardımcıdır; çıkarılamazsa üretim sürer.
      this.log(`  önizleme kareleri çıkarılamadı (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  /**
   * Render öncesi "tekrar bak": taslak kareler çıkarılır, denetlenir; sorunlu sahneler eleştiriyle birlikte
   * yönetmene yeniden planlatılır (bir tur). Ses dosyaları taslak klasörüne kopyalanır, kareler ücretsizdir.
   */
  private async vectorRevise(state: EpisodeState): Promise<void> {
    const { script, voice } = state;
    if (!script || !voice || !state.shots) return;
    const dir = await this.draftDir(state);
    const assets = await this.vectorAssets(state);
    const timeline = buildTimeline(state, (key) => key, assets);
    const book = await loadLessons(this.deps.store);
    // Taslak denetimi bir kalite adımıdır: kareler çıkarılamazsa (tarayıcı açılamadı vb.) aşama durmaz, denetimsiz sürer.
    let critique: Awaited<ReturnType<typeof this.critiqueShots>>;
    try {
      critique = await this.critiqueShots(state, "keyframes", timeline, dir, book.lessons.map((l) => l.rule));
    } catch (e) {
      const reason = e instanceof Error ? e.message.split("\n")[0] : String(e);
      this.log(`  ⚠ taslak kareler çıkarılamadı, taslak denetimi atlandı: ${reason}`);
      return;
    }
    const { files, review } = critique;
    // Taslak kareler Çekimler sekmesinde hemen görünür (render beklenmez).
    state.stills = {};
    await this.storeStills(state, files);
    await this.save(state);

    // Kodun yaptığı fizik düzeltmeleri de yönetmene söylenir (bir dahaki planda kendisi doğru versin).
    const fixes = new Map<string, string[]>();
    for (const v of timeline.visuals) {
      if (!v.vector) continue;
      const notes = resolveLayout(v.vector, assets).flatMap((p) => p.fixes.map((f) => `layer ${p.index}: ${f}`));
      if (notes.length) fixes.set(v.shotId, notes);
    }

    // Yalnız izleyicinin hemen fark edeceği bozukluklar; "dağınık", "konu dışı" gibi yargılar tek başına yeniden plan
    // gerektirmez (yeniden plan da çoğu zaman aynı puanı alıyordu).
    const severe = new Set(["character_floating", "text_on_subtitles", "backdrop_box", "character_cut_off", "empty"]);
    const bad = (id: string) => {
      const r = review.shots[id];
      return r !== undefined && (r.score <= DRAFT_REVIEW.badAtMost || r.issues.some((i) => severe.has(i.type)));
    };
    const scores = Object.values(review.shots).map((s) => s.score);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const worst = (sceneId: string) =>
      Math.min(...state.shots!.filter((s) => s.sceneId === sceneId).map((s) => review.shots[s.id]?.score ?? 10));
    const limit = Math.max(1, Math.ceil(script.scenes.length * DRAFT_REVIEW.maxShare));
    const scenesToFix = script.scenes
      .filter((sc) => state.shots!.some((s) => s.sceneId === sc.id && bad(s.id)))
      .sort((a, b) => worst(a.id) - worst(b.id))
      .slice(0, limit);
    this.log(`  taslak: ${scores.length} kare, ortalama ${avg.toFixed(1)}/10; yeniden planlanacak sahne: ${scenesToFix.length}`);
    state.draftReview = { ...review, avg, revisedScenes: scenesToFix.map((s) => s.id) };
    if (!scenesToFix.length) return;

    const lessons = topLessons(book, "director");
    const durations = Object.fromEntries(script.scenes.map((s) => [s.id, (voice[s.id]?.durationMs ?? 0) / 1000]));
    await mapLimit(scenesToFix, this.deps.concurrency ?? 3, async (scene) => {
      const shots = state.shots!.filter((s) => s.sceneId === scene.id);
      const feedback = shots
        .map((s, n) => {
          const r = review.shots[s.id];
          const lines = [
            ...(r?.issues ?? []).map((i) => `${i.type}: ${i.detail}`),
            ...(fixes.get(s.id) ?? []).map((f) => `code had to fix: ${f}`),
          ];
          return lines.length ? `- shot ${n + 1} (score ${r?.score ?? "?"}): ${lines.join("; ")}` : "";
        })
        .filter(Boolean)
        .join("\n");
      const replanned = await this.planVectorScene(state, scene, /* v8 ignore next -- süreler senaryonun bütün sahnelerinden kurulur */ durations[scene.id] ?? 0, lessons, feedback);
      const entry = state.shotPlan!.scenes.find((s) => s.sceneId === scene.id);
      if (entry) entry.shots = replanned;
    });
    state.shots = resolveShotTimes(state.shotPlan!, script.scenes.map((s) => s.id), voice);
    // Düzeltilen planın yeni nesne/mekânları çizilir.
    await this.vectorPropsDraw(state);
    // Yeniden planlanan sahnelerin eski kareleri artık geçersiz: yeni planla yeniden çıkarılır.
    const revised = new Set(scenesToFix.map((s) => s.id));
    const redo = new Set(state.shots.filter((s) => revised.has(s.sceneId)).map((s) => s.id));
    const live = new Set(state.shots.map((s) => s.id));
    for (const id of Object.keys(/* v8 ignore next -- kareler yukarıda state.stills'e yazıldı */ state.stills ?? {})) if (redo.has(id) || !live.has(id)) delete state.stills![id];
    await this.vectorPreviews(state, redo);
  }
  /** Defter şişince benzer dersler birleştirilir; küratör başarısız olursa defter olduğu gibi kalır. */
  private async curate(state: EpisodeState, book: LessonBook): Promise<void> {
    try {
      await curateLessons(book, {
        deps: this.agentDeps,
        onCall: async (target, res, before) => {
          await this.agent(state, "review", Promise.resolve(res));
          this.log(`  dersler (${target}): ${before} → ${res.data.rules.length} kural`);
        },
      });
    } catch (e) {
      this.log(`  ders küratörü atlandı: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Kare aşamasının vektör karşılığı: yeni nesne/mekânları çizer, sonra (kare kontrolü açıksa) taslak kareleri
   * gözden geçirip sorunlu sahneleri yeniden planlatır.
   */
  private async vectorProps(state: EpisodeState): Promise<void> {
    await this.vectorPropsDraw(state);
    if (state.input.qa !== false) await this.vectorRevise(state);
    else {
      state.stills = {};
      await this.vectorPreviews(state);
    }
  }

  /** Çekimlerin istediği yeni nesne ve mekânları çizer (kütüphanedekiler ücretsiz). */
  private async vectorPropsDraw(state: EpisodeState): Promise<void> {
    const props = state.vectorProps ?? {};
    // Yalnız güncel çekimlerin kullandığı nesneler çizilir: atılan/yeniden planlanan sahnelerin nesnelerine para gitmez.
    /* v8 ignore next -- iki çağıran da (kare aşaması, taslak denetimi) çekim ister */
    const shots = state.shots ?? [];
    const used = new Set(
      shots.flatMap((s) => (s.vector ? [s.vector.background, ...s.vector.layers.map((l) => l.asset)].filter(Boolean) : [])),
    );
    const todo = Object.entries(props).filter(([id, p]) => !p.key && (!state.shots || used.has(id)));
    const failed: string[] = [];
    await mapLimit(todo, this.deps.concurrency ?? 3, async ([id, p]) => {
      try {
        p.key =
          p.map || p.flag
            ? await this.realWorldAsset(state, id, p)
            : (await this.designAsset(state, "keyframes", { kind: p.kind ?? "prop", id, name: id, description: p.description, reference: p.reference })).key;
        await this.save(state);
      } catch (e) {
        // Yalnız kesin sonuçlar nesneyi düşürür (kapı reddi, harita/bayrak verisi yok). Ağ ya da model hatası aşamayı
        // durdurur ki devam edince yeniden denensin; yoksa nesne sessizce videodan kaybolurdu.
        if (!(e instanceof AssetRejectedError) && !p.map && !p.flag) throw e;
        if (e instanceof AssetRejectedError) p.rejected = true;
        failed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    state.keyframes = {};
    // Çizilemeyen nesne çekimden düşer; video yine de çıkar.
    if (failed.length) this.log(`  ${failed.length} nesne çizilemedi, sahnelerden çıkarılacak:\n  ${failed.join("\n  ")}`);
  }

  /**
   * Harita ve bayrak: gerçek veriden kodla üretilir (model çağrısı yok, ücretsiz). Anahtar tariften türetilir;
   * aynı harita başka bölümde tekrar üretilmez.
   */
  private async realWorldAsset(state: EpisodeState, id: string, p: NonNullable<EpisodeState["vectorProps"]>[string]): Promise<string> {
    /* v8 ignore next -- tek çağıran kare aşamasıdır ve stil ister */
    const palette = state.style?.palette ?? [];
    const source = p.map ? { map: p.map, lang: state.input.lang, palette } : { flag: p.flag };
    const hash = createHash("sha256").update(JSON.stringify({ v: GEO_VERSION, ...source })).digest("hex").slice(0, 32);
    const key = `library/vector/geo/${hash}.svg`;
    if ((await this.deps.store.get(key)) && (await this.deps.store.get(`${key}.json`))) {
      this.log(`  ${id}: kütüphaneden (gerçek veri)`);
      return key;
    }
    const out = p.map ? await generateMap(p.map, state.input.lang, palette) : await generateFlag(p.flag!);
    const svg = sanitizeSvg(out.svg);
    // Önce meta: SVG var ama meta yoksa "exact" bilgisi kaybolur (deniz dikdörtgeni silinir, çizgi stili uygulanır).
    await putJson(this.deps.store, `${key}.json`, out.meta);
    await this.deps.store.put(key, new TextEncoder().encode(svg), "image/svg+xml");
    this.log(`  ${id}: ${p.map ? "harita" : "bayrak"} gerçek veriden üretildi (${(svg.length / 1024).toFixed(0)} KB)`);
    return key;
  }

  /** Timeline'a gömülecek SVG'ler: seçili karakter/mekân varlıkları ve çizilmiş nesneler. */
  private async vectorAssets(state: EpisodeState): Promise<Record<string, VectorAsset>> {
    const out: Record<string, VectorAsset> = {};
    const add = async (id: string, kind: VectorAsset["kind"], key: string) => {
      const clean = sanitizeSvg(new TextDecoder().decode(await this.bytes(key)));
      const size = svgSize(clean);
      const meta = VectorAssetMeta.parse((await getJson(this.deps.store, `${key}.json`)) ?? {});
      // Kütüphanedeki eski varlıklar da zeminsiz gömülsün (yeniden çizdirmeden).
      out[id] = { id, kind, svg: kind === "background" || meta.exact ? clean : stripBackdrop(clean, size), ...size, meta };
    };
    const selected = state.concept?.selected ?? {};
    for (const c of state.cast?.characters ?? []) if (selected[c.id]) await add(c.id, "character", selected[c.id]!.key);
    for (const l of state.cast?.locations ?? []) if (selected[l.id]) await add(l.id, "background", selected[l.id]!.key);
    for (const [id, p] of Object.entries(state.vectorProps ?? {})) if (p.key) await add(id, p.kind ?? "prop", p.key);
    return out;
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
        prompt: [style.promptPrefix, anonymizeNames(prompt, state.cast?.characters ?? []), text, FRAME_RULES].filter(Boolean).join(". "),
        negativePrompt: [...style.negativeRules, FRAME_NEGATIVE].join(", "),
        aspectRatio: this.aspect(state),
        refs,
        // Elle yeniden çizimde farklı seed: istek özeti değişir, önbellekteki eski kare dönmez.
        ...(refId && state.redraws?.[refId] ? { seed: state.redraws[refId] } : {}),
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
    if (motionModeOf(state.input) === "vector") throw new Error("Vektör modunda deneme karesi yok; varlıklar zaten önizleniyor");
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
      const choice = state.input.stylePack;
      if (choice === STYLE_CUSTOM) {
        state.style = await this.agent(state, "style", artDirector(this.brief(state), this.agentDeps));
        this.log(`  özel stil: ${state.style.artStyle}`);
        return;
      }
      let pack = stylePackOf(choice);
      // Serinin bölümleri aynı paketle çizilir: "auto" serinin önceki paketini kullanır, yeniden seçmez.
      const inherited = pack ? undefined : stylePackOf(seriesStylePack(await new EpisodeRepo(this.deps.store).list(), state));
      if (pack) this.log(`  stil paketi: ${pack.name.tr}`);
      else if (inherited) {
        pack = inherited;
        this.log(`  stil paketi (seri "${seriesOf(state)}"): ${pack.name.tr}`);
      } else {
        // "auto" (varsayılan): hazır paketlerden konuya uyanı ucuz bir ajan seçer.
        const pick = await this.agent(state, "style", stylePicker(this.brief(state), STYLE_PACKS, this.agentDeps));
        pack = stylePackOf(pick.packId) ?? STYLE_PACKS[0]!;
        this.log(`  stil paketi (otomatik): ${pack.name.tr}: ${pick.reason}`);
      }
      state.style = styleFromPack(pack);
    },

    story: async (state) => {
      state.story = await this.agent(state, "story", storyArchitect(this.brief(state), this.agentDeps));
      this.log(`  "${state.story.title}" — ${state.story.beats.length} beat`);
    },

    script: async (state) => {
      if (!state.story) throw new Error("story yok");
      const book = await loadLessons(this.deps.store);
      const brief = { ...this.brief(state), lessons: topLessons(book, "script") };
      // Doktor düşerse (pahalı) senarist devamda yeniden çağrılmasın: taslak aynı girdilerle kaydedilir.
      const sig = createHash("sha256").update(JSON.stringify([brief, state.story])).digest("hex").slice(0, 16);
      let draft: ScriptOut;
      if (state.scriptDraft?.sig === sig) {
        draft = state.scriptDraft.script;
        this.log("  taslak: önceki çalıştırmanın taslağı kullanıldı");
      } else {
        draft = await this.agent(state, "script", screenwriter(brief, state.story, this.agentDeps));
        state.scriptDraft = { sig, script: draft };
        await this.save(state);
      }
      const count = (s: typeof draft) => s.scenes.reduce((n, sc) => n + sc.narration.split(/\s+/).length, 0);
      this.log(`  taslak: ${draft.scenes.length} sahne, ${count(draft)} kelime`);
      // İkinci geçiş: senaryo doktoru açılışı, temposu ve doğruluğu düzeltir. Sahne kimlikleri değişmez.
      const doctored = await this.agent(state, "script", scriptDoctor(brief, state.story, draft, this.agentDeps));
      const ids = (s: typeof draft) => s.scenes.map((sc) => sc.id).join(",");
      state.script = ids(doctored.script) === ids(draft) ? doctored.script : draft;
      state.scriptNotes = doctored.notes;
      delete state.scriptDraft;
      mergeLessons(book, doctored.notes.map((rule) => ({ target: "script" as const, rule })), state.id);
      await this.curate(state, book);
      await saveLessons(this.deps.store, book);
      this.log(`  doktor: ${count(state.script)} kelime; ${doctored.notes.length} düzeltme${state.script === draft ? " (sahne yapısı değişti, taslak kullanıldı)" : ""}`);
    },

    cast: async (state) => {
      if (!state.script || !state.style) throw new Error("script/style yok");
      const vector = motionModeOf(state.input) === "vector";
      const oldCast = state.cast;
      // Aynı stil ve çizgi stilinde daha önce çizilmiş karakterler: aynı kişi geçiyorsa yeniden çizilmez.
      const library = vector ? (await this.libraryFor(state)).slice(0, 40) : [];
      state.cast = await this.agent(
        state,
        "cast",
        castingDirector(state.script, state.style, this.agentDeps, library.map(({ id, name, description }) => ({ id, name, description }))),
      );
      // Yeni kadro eski kimlikleri (c1, l2…) yeniden kullanır: adı ya da tarifi değişen varlığın eski konsepti ve
      // kadrodan türemiş nesnesi atılır (yoksa yeni c1'e eskisinin çizimi giderdi); değişmeyenler korunur (para gitmez).
      if (oldCast) {
        const all = (c: CastOut) => [...c.characters, ...c.locations];
        const fresh = new Map(all(state.cast).map((e) => [e.id, e]));
        const same = (id: string) => {
          const a = all(oldCast).find((e) => e.id === id);
          const b = fresh.get(id);
          return Boolean(a && b && a.name === b.name && a.visualDescription === b.visualDescription);
        };
        const concept = state.concept;
        let dropped = false;
        for (const id of Object.keys({ ...concept?.candidates, ...concept?.selected })) {
          if (same(id)) continue;
          delete concept!.candidates[id];
          delete concept!.selected[id];
          dropped = true;
        }
        if (dropped && state.approvals) delete state.approvals.concept;
        for (const [id, p] of Object.entries(state.vectorProps ?? {})) {
          if (!/^c\d+$/.test(id)) continue;
          const now = fresh.get(id) as CastOut["characters"][number] | undefined;
          if (!now || now.kind === "person" || now.visualDescription !== p.description) delete state.vectorProps![id];
        }
      }
      const reused = state.cast.characters.filter((c) => c.reuse && library.some((l) => l.id === c.reuse));
      if (reused.length) this.log(`  ♻ kütüphaneden tekrar kullanılacak: ${reused.map((c) => c.name).join(", ")}`);
      if (vector) {
        // Vektör karakteri insan iskeletli kukladır: at, köpek ya da çanta ona çizilirse iki ayaklı garip bir şey çıkar
        // (30 Eki Pony Express denemesi). İnsan olmayanlar iskeletsiz nesne olarak çizilir ve kalite kapısından geçer.
        const props = (state.vectorProps ??= {});
        const others = state.cast.characters.filter((c) => c.kind !== "person");
        for (const c of others) props[c.id] ??= { description: c.visualDescription, kind: "prop", reference: c.reference };
        state.cast.characters = state.cast.characters.filter((c) => c.kind === "person");
        if (others.length) this.log(`  insan olmayan ${others.length} oyuncu nesne olarak çizilecek: ${others.map((c) => c.name).join(", ")}`);
      }
      this.log(`  ${state.cast.characters.length} karakter, ${state.cast.locations.length} mekân`);
    },

    concept: async (state, opts) => {
      const { cast } = state;
      if (!cast) throw new Error("cast yok");
      if (motionModeOf(state.input) === "vector") return this.vectorConcept(state, opts.only === "concept");
      const previous = state.concept;
      // "Yeni adaylar üret" yeni tur açar: farklı seed → önbellek aynı görselleri döndürmez. Hata sonrası devam ise aynı
      // turu sürdürür: aynı seed'li istekler önbellekten bedava gelir, yalnız eksikler ödenir.
      const regenerate = opts.only === "concept";
      const round = previous ? (previous.round ?? 0) + (regenerate ? 1 : 0) : 0;
      state.concept = { candidates: {}, selected: {}, round };
      const concept = state.concept;
      if (regenerate) {
        // Önceki tur seçimi yeni turda da ilk aday olarak kalır (beğenilen görsel kaybolmasın).
        for (const [id, sel] of Object.entries(previous?.selected ?? {})) concept.candidates[id] = [sel];
      } else {
        for (const [id, list] of Object.entries(previous?.candidates ?? {})) concept.candidates[id] = [...list];
      }

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
        const list = (concept.candidates[job.id] ??= []);
        if (!list.some((r) => r.key === res.files[0]!.key)) list.push({ key: res.files[0]!.key, mimeType: res.files[0]!.mimeType });
        this.log(`  ${job.id} aday ✓ (${res.providerId}${res.cacheHit ? ", önbellek" : ""})`);
        await this.save(state);
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
      // Metni değişmiş sahnenin eski sesi kullanılmaz (senaryo düzenlendi ya da yeniden yazıldı).
      const todo = state.script.scenes.filter((s) => !voice[s.id] || (voice[s.id]!.text !== undefined && voice[s.id]!.text !== s.narration));
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
          text: scene.narration,
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
      if (motionMode === "vector") return this.vectorShots(state, durations);
      state.shotPlan = await this.agent(
        state,
        "shots",
        director(
          script,
          style,
          durations,
          { aiClipRatio: state.input.aiClipRatio, motionMode, cast: state.cast },
          this.agentDeps,
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
      if (motionModeOf(state.input) === "vector") return this.vectorProps(state);
      state.keyframes ??= {};
      const keyframes = state.keyframes;
      const todo = shots.filter((s) => !keyframes[s.id]);

      const qaOn = state.input.qa !== false;
      const redraws = this.deps.qaRedraws ?? 1;
      state.qa ??= {};
      const qa = state.qa;

      const failed: string[] = [];
      await mapLimit(todo, this.deps.concurrency ?? 3, async (shot) => {
        let prompt = shot.imagePrompt;
        let best: { ref: AssetRef; qa?: FrameQa } | undefined;
        let attempts = 0;
        for (let attempt = 1; attempt <= 1 + (qaOn ? redraws : 0); attempt++) {
          let res: Awaited<ReturnType<typeof this.keyframe>>;
          try {
            res = await this.keyframe(state, "keyframes", prompt, shot.characterIds, shot.locationId, opts.signal, shot.id);
          } catch (e) {
            if (opts.signal?.aborted) throw e;
            const message = e instanceof Error ? e.message : String(e);
            // Yeniden çizim başarısızsa eldeki kare kullanılır; ilk çizim başarısızsa diğer çekimler sürer.
            this.log(`  ${shot.id} ${best ? "yeniden çizilemedi, ilk kare kullanılıyor" : "çizilemedi"}: ${message}`);
            if (!best) failed.push(`${shot.id}: ${message}`);
            break;
          }
          attempts = attempt;
          const ref = { key: res.files[0]!.key, mimeType: res.files[0]!.mimeType };
          const review = qaOn ? await this.inspect(state, shot, ref, attempt) : undefined;
          if (!best || frameRank(review) > frameRank(best.qa)) best = { ref, qa: review };
          this.log(
            `  ${shot.id} ${review ? (review.passed ? "✓" : "✗") : "✓"} (${res.providerId}${res.cacheHit ? ", önbellek" : ""}${review && !review.skipped ? `, kontrol ${review.score}/10` : ""}${review?.issues.length ? `: ${review.issues.map((i) => i.type).join(", ")}` : ""})`,
          );
          if (!review || review.passed) break;
          prompt = redrawPrompt(shot.imagePrompt, review);
        }
        if (!best) return;
        keyframes[shot.id] = best.ref;
        if (best.qa) qa[shot.id] = { ...best.qa, attempts };
        await this.save(state);
      });
      if (failed.length) {
        throw new Error(`${failed.length} kare çizilemedi (diğerleri kaydedildi, devam edince yalnız bunlar denenir):\n${failed.join("\n")}`);
      }
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
        const clipSec = clipSeconds(shotSec);
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
      const vector = motionModeOf(state.input) === "vector" ? await this.vectorAssets(state) : {};
      state.timeline = buildTimeline(state, (key) => key, vector);
      const sec = state.timeline.durationInFrames / state.timeline.fps;
      this.log(`  ${(sec / 60).toFixed(1)} dk, ${state.timeline.visuals.length} görsel`);
    },

    render: async (state) => {
      const timeline = state.timeline;
      if (!timeline) throw new Error("timeline yok");
      const dir = resolve(this.deps.workDir, state.id);
      const publicDir = join(dir, "public");

      // Depodaki (yerel veya S3) varlıkları render klasörüne indir; klipleri render formatına çevir.
      const files = timeline.visuals.filter((v) => v.assetUrl);
      const clipKeys = new Set(files.filter((v) => v.kind !== "still_motion").map((v) => v.assetUrl));
      const keys = new Set([...files.map((v) => v.assetUrl), ...timeline.audio.map((a) => a.assetUrl)]);
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
          if (pct === lastPct) return;
          this.log(`  render %${(lastPct = pct)}`);
          state.renderPct = pct;
          // İlerleme Stüdyo'da görünsün; kayıt hatası render'ı durdurmaz.
          void this.save(state).catch(() => {});
        },
        onWait: (pid) => this.log(`  başka bir render sürüyor (süreç ${pid}); sıra bekleniyor`),
        onRetry: (reason) => {
          lastPct = -1;
          this.log(`⚠ render geçici bir hatayla düştü (${reason}); baştan bir kez daha deneniyor`);
        },
      });
      state.render = { path: outputPath, at: new Date().toISOString() };
      this.log(`  ✓ ${outputPath}`);
    },

    review: async (state) => {
      const { timeline, shots } = state;
      if (!timeline || !shots) throw new Error("timeline/shots yok");
      const dir = resolve(this.deps.workDir, state.id);
      const book = await loadLessons(this.deps.store);
      // Render klasörünün public/ dizini hazır; kareler yereldir.
      const { files, review } = await this.critiqueShots(state, "review", timeline, dir, book.lessons.map((l) => l.rule));
      state.stills = {};
      await this.storeStills(state, files);
      state.review = review;
      mergeLessons(book, review.lessons, state.id);
      await this.curate(state, book);
      await saveLessons(this.deps.store, book);

      const scores = Object.values(review.shots).map((s) => s.score);
      const byType = new Map<string, number>();
      for (const s of Object.values(review.shots)) for (const i of s.issues) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      this.log(`  ${scores.length} kare, ortalama ${avg.toFixed(1)}/10; sorunlar: ${[...byType].map(([k, n]) => `${k}×${n}`).join(", ") || "yok"}`);
      for (const l of review.lessons) this.log(`  ders (${l.target}): ${l.rule}`);
    },
  };
}
