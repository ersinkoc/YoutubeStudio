import { msg, type Capability, type Msg, type Text } from "@ys/core";
import { billing, rankProviders, type GenerationRequest, type ProviderAdapter } from "@ys/media-gateway";
import { gateBefore, isApproved, motionModeOf, STAGES, type EpisodeState, type MotionMode, type Stage } from "./state.ts";
import { clipSeconds } from "./timing.ts";

/*
 * Bölüm maliyet ve süre tahmini. Para harcamaz, ağır bağımlılık yüklemez (stüdyo sunucusu çağırır).
 * - Maliyet: router'ın o adımda gerçekten seçeceği sağlayıcının fiyatı, fatura yuvarlaması dahil.
 * - Süre: defterden ölçülen sağlayıcı gecikmesi; ölçüm yoksa aşağıdaki varsayılanlar.
 * Bölüm ilerledikçe varsayımlar gerçek sayılarla değişir (karakter sayısı, çekim sayısı ve süreleri).
 */

/*
 * Satır metinleri (etiket, birim, dayanak, uyarı) çevrilebilir mesajdır: Stüdyo seçili dilde gösterir.
 */
export const STAGE_LABELS: Record<Stage, Msg> = Object.fromEntries(
  STAGES.map((s) => [s, msg(`cost.stage.${s}` as const)]),
) as Record<Stage, Msg>;

/** Dayanak parçalarını "a; b" olarak birleştirir (boş parçalar atlanır). */
const joinText = (first: Text, ...rest: (Text | false)[]): Text =>
  rest.reduce<Text>((a, b) => (b ? msg("cost.join", { a, b }) : a), first);

/** Ölçüm yokken çağrı başı süre (ms). 29 Eki çalıştırmalarından. Tahminde fiyatlanan her yetenek burada. */
const DEFAULT_LATENCY_MS = {
  t2i: 12_000,
  i2i_multiref: 15_000,
  i2v: 140_000,
  tts: 10_000,
  tts_timestamps: 8_000,
} satisfies Partial<Record<Capability, number>>;

/** Tahminin fiyatladığı istek: süresi bilinen yeteneklerden biri. */
type PricedRequest = GenerationRequest & { capability: keyof typeof DEFAULT_LATENCY_MS };

/** Ajan aşamaları: sabit + dakika başı (gerçek ölçümler: 3 dk senaryo $0.14/~50 sn, stil $0.014/12 sn). */
const AGENT_MODEL: Partial<Record<Stage, { usd: number; usdPerMin: number; sec: number; secPerMin: number }>> = {
  style: { usd: 0.015, usdPerMin: 0, sec: 12, secPerMin: 0 },
  story: { usd: 0.06, usdPerMin: 0.004, sec: 40, secPerMin: 3 },
  // Yazar + senaryo doktoru, iki Opus geçişi. 30 Eki ölçümü: 1 dk $0.36/140 sn, 10 dk $1.08/376 sn.
  script: { usd: 0.28, usdPerMin: 0.08, sec: 114, secPerMin: 26 },
  cast: { usd: 0.02, usdPerMin: 0.002, sec: 20, secPerMin: 2 },
  shots: { usd: 0.04, usdPerMin: 0.015, sec: 20, secPerMin: 8 },
};

/**
 * Kare denetimi (Haiku, 1 kare + en fazla 3 referans görsel). 30 Eki ölçümü (10 dk bölüm, 101 kare):
 * kontrol başı ~$0.001 ve ~3 sn; karelerin %49'u yeniden çizildi (çoğu "yazı" ve "konu eksik").
 */
const QA = { usd: 0.0012, ms: 3_000, redrawRate: 0.45 };

/**
 * Vektör modu (yalnız Claude). İlk ölçüm (30 Eki, 1 dk): nesne ~$0.017; render ~1,9× video süresi; sahne başı ~2 nesne.
 * Sahneleme kuralları + Opus karakterlerden sonra ikinci ölçüm (30 Eki, 1 dk, 3 sahne, 5 varlık): varlık ~$0.07 / 62 sn,
 * sahne yönetmeni ~$0.14/sahne (10 dk bölümde ~$0.04); ikisinin arası alındı. Üçüncü ölçüm (30 Eki, Pony Express, referans
 * görselli): karakter ilk çizimi (Opus) $0.10–0.21, ort. ~$0.15; mekân (Sonnet) ~$0.04; kapı denetimi çizim başı ~$0.002.
 */
const VECTOR = { characterUsd: 0.15, backgroundUsd: 0.04, assetSec: 30, sceneUsd: 0.1, sceneSec: 36, propUsd: 0.017, propSec: 12, propsPerScene: 2, renderX: 1.9, reviseRate: 0.4 };

/**
 * Kalite kapısı (30 Eki): her SVG kullanılmadan önce iki ucuz görsel çağrıyla (kör tahmin + kapı, Haiku) denetlenir;
 * geçemeyen kusurlarla yeniden çizilir (en çok 3 çizim). 30 Eki ölçümü (Pony Express, 11 varlık): denetim çizim başı
 * ~$0.002; 11 varlıkta 18 çizim (~0,6 ek çizim/varlık, kapı ayarı öncesi; sonra düşmesi beklenir).
 */
// planUsd: çizimden önce plan (Sonnet, referans görselleriyle). Henüz ölçülmedi: kapı çağrısının görsel girdisinden tahmin.
// readyMadeUsd: nesne için Commons'taki hazır SVG adaylarının denetimi (en çok 2 × kapı + boy ajanı). Bulunursa çizim
// parası hiç harcanmaz; bulunma oranı ölçülmediği için tasarruf düşülmez (tahmin üstten).
const GATE = { checkUsd: 0.002, extraDraws: 0.6, planUsd: 0.015, readyMadeUsd: 0.005 };
/**
 * Yan görünüş (input.sideViews): yürüyen karakter başına bir tasarımcı çizimi + kapı, kapıdan dönerse düzeltme.
 * 31 Eki defter ölçümü: vector-designer:character ~$0.128, redraw ~$0.183, kör tahmin + kapı ~$0.028.
 */
const SIDE_VIEW = { drawUsd: 0.13, redrawUsd: 0.18, checkUsd: 0.028, sec: 40 };

const withReality = (drawUsd: number) => GATE.planUsd + drawUsd * (1 + GATE.extraDraws) + GATE.checkUsd * (1 + GATE.extraDraws);

/** Render sonrası inceleme. Henüz ölçülmedi: kare denetiminin (Haiku, ~$0.001/görsel) 6 karelik grubundan tahmin. */
const REVIEW = { perBatch: 6, batchUsd: 0.006, batchSec: 8, stillSec: 0.8 };

/** Aynı anda kaç görsel/klip üretiliyor (pipeline concurrency). */
const PARALLEL = 3;
const CHARS_PER_WORD = 6.5;
const WPM_DEFAULT: Record<string, number> = { tr: 115, de: 125, fi: 110, en: 150, es: 155, pt: 150, fr: 150 };

export interface EstimateRow {
  stage: Stage;
  label: Text;
  providerId?: string;
  /** Model sütununda sağlayıcının yanında gösterilen açıklama ("SVG", "taslak denetimi"); sağlayıcı yoksa tek başına. */
  via?: Text;
  quantity: number;
  /** Birim; mesajsa `.one` eki tekil biçimdir (Stüdyo miktar 1 iken onu kullanır). */
  unit: Text;
  costUsd: number;
  seconds: number;
  done: boolean;
  /** Tahminin dayanağı: "ölçüm (n=12)" veya "varsayılan". */
  basis: Text;
}

export interface EpisodeEstimate {
  mode: MotionMode;
  videoSec: number;
  shots: number;
  rows: EstimateRow[];
  totalUsd: number;
  totalSeconds: number;
  remainingUsd: number;
  remainingSeconds: number;
  /** Uyarılar: sağlayıcı yok, bütçe yetmiyor… */
  warnings: Text[];
}

export interface EstimateContext {
  providers: readonly ProviderAdapter[];
  /** measuredLatency() çıktısı. */
  latency: Record<string, { avgMs: number; n: number }>;
}

export function estimateEpisode(state: EpisodeState, ctx: EstimateContext, modeOverride?: MotionMode): EpisodeEstimate {
  const input = { ...state.input, motionMode: modeOverride ?? motionModeOf(state.input) };
  const mode = input.motionMode;
  const policy = { tier: input.tier };
  const warnings: Text[] = [];
  // Aynı uyarı birden çok satırdan gelebilir (ör. her klip için "sağlayıcı yok"): anahtar + parametreyle tekilleştirilir.
  const warned = new Set<string>();
  const warn = (w: Msg) => {
    const id = JSON.stringify(w);
    if (!warned.has(id)) warnings.push(w);
    warned.add(id);
  };
  const quality = input.tier === "premium" ? "hero" : "standard";
  const aspectRatio = input.width === input.height ? "1:1" : input.width > input.height ? "16:9" : "9:16";

  const voiceMs = state.voice ? Object.values(state.voice).reduce((n, v) => n + v.durationMs, 0) : 0;
  const videoSec = voiceMs > 0 ? voiceMs / 1000 : input.targetSec;
  const minutes = videoSec / 60;
  const avgShotSec = mode === "animated" ? 4.5 : 5.5;
  const shotList = state.shots;
  const shotCount = shotList?.length ?? Math.max(1, Math.round(videoSec / avgShotSec));

  /** Bir isteği router'dan geçirip tek çağrının maliyet ve süresini verir. */
  const price = (req: PricedRequest) => {
    const top = rankProviders(ctx.providers, req, policy)[0];
    if (!top) {
      warn(msg("cost.noProvider", { capability: req.capability }));
      return { providerId: undefined, usd: 0, ms: DEFAULT_LATENCY_MS[req.capability], basis: msg("cost.basis.noProvider"), units: 0 };
    }
    const bill = billing(top.adapter.price, req);
    const measured = ctx.latency[top.adapter.id];
    return {
      providerId: top.adapter.id,
      usd: bill.micros / 1_000_000,
      ms: measured?.avgMs ?? DEFAULT_LATENCY_MS[req.capability],
      basis: measured ? msg("cost.basis.measured", { n: measured.n }) : msg("cost.basis.default"),
      units: bill.units,
    };
  };

  const rows: EstimateRow[] = [];
  const add = (row: Omit<EstimateRow, "label" | "done">) =>
    rows.push({ ...row, label: STAGE_LABELS[row.stage], done: Boolean(state.done[row.stage]) });

  // --- ajanlar
  const vector = mode === "vector";
  for (const stage of vector ? (["style", "story", "script", "cast"] as const) : (["style", "story", "script", "cast", "shots"] as const)) {
    const m = AGENT_MODEL[stage]!;
    add({
      stage,
      providerId: "claude",
      quantity: 1,
      unit: msg("unit.call"),
      costUsd: m.usd + m.usdPerMin * minutes,
      seconds: m.sec + m.secPerMin * minutes,
      basis: msg("cost.basis.agents"),
    });
  }

  // --- konsept: karakter başı 3, mekân başı 2 aday + 3 deneme karesi
  const chars = state.cast?.characters.length ?? 2;
  const locs = state.cast?.locations.length ?? 3;
  const conceptImages = chars * 3 + locs * 2 + 3;
  const ci = price({ capability: "t2i", quality, aspectRatio });
  const castNote = !state.cast && msg("cost.basis.castGuess", { characters: chars, locations: locs });
  if (vector) {
    const assets = chars + locs;
    add({
      stage: "concept",
      providerId: "claude",
      via: msg("cost.via.svg"),
      quantity: assets,
      unit: msg("unit.asset"),
      // Karakterin ilk çizimi Opus, düzeltmeleri Sonnet; mekânlar Sonnet.
      costUsd:
        chars * (GATE.planUsd + VECTOR.characterUsd + GATE.extraDraws * VECTOR.backgroundUsd * 2 + GATE.checkUsd * (1 + GATE.extraDraws)) +
        locs * withReality(VECTOR.backgroundUsd),
      seconds: (Math.ceil(assets / PARALLEL) * VECTOR.assetSec),
      basis: joinText(
        msg("cost.basis.vectorConcept", { character: VECTOR.characterUsd, location: VECTOR.backgroundUsd }),
        castNote,
        msg("cost.basis.gate", { pct: Math.round(GATE.extraDraws * 100) }),
      ),
    });
  } else {
    add({
      stage: "concept",
      providerId: ci.providerId,
      quantity: conceptImages,
      unit: msg("unit.image"),
      costUsd: ci.usd * conceptImages,
      seconds: (Math.ceil(conceptImages / PARALLEL) * ci.ms) / 1000,
      basis: joinText(ci.basis, castNote),
    });
  }

  // --- ses
  const lang = input.lang.split("-")[0]!;
  const narrationChars =
    state.script?.scenes.reduce((n, s) => n + s.narration.length, 0) ??
    Math.round(minutes * (WPM_DEFAULT[lang] ?? 140) * CHARS_PER_WORD);
  const scenes = state.script?.scenes.length ?? Math.max(1, Math.round(videoSec / 30));
  const vReq: PricedRequest = {
    capability: "tts_timestamps",
    quality: "standard",
    text: "x".repeat(narrationChars),
    voiceId: input.voiceId,
    language: input.lang,
  };
  const ttsReq = rankProviders(ctx.providers, vReq, policy).length ? vReq : { ...vReq, capability: "tts" as const };
  const v = price(ttsReq);
  add({
    stage: "voice",
    providerId: v.providerId,
    quantity: narrationChars,
    unit: msg("unit.chars"),
    costUsd: v.usd,
    // Sahneler sırayla seslendirilir; ölçüm sahne başına.
    seconds: (scenes * v.ms) / 1000,
    basis: state.script ? v.basis : joinText(v.basis, msg("cost.basis.textGuess")),
  });

  if (vector) {
    add({
      stage: "shots",
      providerId: "claude",
      quantity: scenes,
      unit: msg("unit.scene"),
      costUsd: scenes * VECTOR.sceneUsd,
      seconds: Math.ceil(scenes / PARALLEL) * VECTOR.sceneSec,
      basis: msg("cost.basis.scenes", { usd: VECTOR.sceneUsd }),
    });
    const props = Math.round(scenes * VECTOR.propsPerScene);
    add({
      stage: "keyframes",
      providerId: "claude",
      via: msg("cost.via.svg"),
      quantity: props,
      unit: msg("unit.object"),
      costUsd: props * (withReality(VECTOR.propUsd) + GATE.readyMadeUsd),
      seconds: Math.ceil(props / PARALLEL) * VECTOR.propSec,
      basis: msg("cost.basis.props"),
    });
    if (input.sideViews) {
      // Kaç karakterin yürüyeceği çekim planından önce bilinmez: üst sınır olarak bütün karakterler.
      const walkers = state.sideViews ? Object.keys(state.sideViews).length : chars;
      add({
        stage: "keyframes",
        providerId: "claude",
        via: msg("cost.via.svg"),
        quantity: walkers,
        unit: msg("unit.asset"),
        costUsd: walkers * (SIDE_VIEW.drawUsd + SIDE_VIEW.checkUsd + GATE.extraDraws * (SIDE_VIEW.redrawUsd + SIDE_VIEW.checkUsd)),
        seconds: Math.ceil(walkers / PARALLEL) * SIDE_VIEW.sec,
        basis: msg("cost.basis.sideViews", { usd: SIDE_VIEW.drawUsd }),
      });
    }
    // Render öncesi taslak denetimi: her çekime bir kare + ucuz eleştiri, sorunlu sahneler bir kez yeniden planlanır.
    const draftBatches = Math.ceil(shotCount / REVIEW.perBatch);
    const replans = Math.ceil(scenes * VECTOR.reviseRate);
    add({
      stage: "keyframes",
      providerId: "claude",
      via: msg("cost.via.draftReview"),
      quantity: shotCount,
      unit: msg("unit.frame"),
      costUsd: draftBatches * REVIEW.batchUsd + replans * VECTOR.sceneUsd,
      seconds: shotCount * REVIEW.stillSec + Math.ceil(draftBatches / PARALLEL) * REVIEW.batchSec + Math.ceil(replans / PARALLEL) * VECTOR.sceneSec,
      basis: msg("cost.basis.draft", { pct: Math.round(VECTOR.reviseRate * 100) }),
    });
  }

  // --- kareler (referanslı)
  const kf = price({
    capability: "i2i_multiref",
    quality,
    aspectRatio,
    refs: [{ role: "character", bytes: new Uint8Array(), mimeType: "image/png" }],
  });
  // Kare denetimi: her kareye bir görsel model çağrısı, reddedilenler bir kez yeniden çizilir.
  const qaOn = state.input.qa !== false;
  const draws = shotCount * (qaOn ? 1 + QA.redrawRate : 1);
  const checks = qaOn ? draws : 0;
  if (!vector) add({
    stage: "keyframes",
    providerId: kf.providerId,
    quantity: Math.round(draws),
    unit: msg("unit.image"),
    costUsd: kf.usd * draws + QA.usd * checks,
    seconds: (Math.ceil(shotCount / PARALLEL) * (kf.ms * (draws / Math.max(1, shotCount)) + (qaOn ? QA.ms : 0))) / 1000,
    basis: joinText(
      kf.basis,
      !shotList && msg("cost.basis.shotGuess"),
      qaOn && msg("cost.basis.qa", { pct: Math.round(QA.redrawRate * 100), usd: QA.usd }),
    ),
  });

  // --- animasyon: çekim süresine göre 5/10 sn klip, sağlayıcının fatura adımıyla
  const clipShots =
    mode === "animated"
      ? (shotList ?? []).map((s) => (s.endMs - s.startMs) / 1000)
      : (shotList ?? []).filter((s) => s.kind === "ai_clip").map((s) => (s.endMs - s.startMs) / 1000);
  const clipCount = shotList
    ? clipShots.length
    : mode === "animated"
      ? shotCount
      : mode === "mixed"
        ? Math.round(shotCount * input.aiClipRatio)
        : 0;
  const durations = shotList ? clipShots : Array.from({ length: clipCount }, () => avgShotSec);
  let clipUsd = 0;
  let clipMs = 0;
  let billedSec = 0;
  let clipProvider: string | undefined;
  let clipBasis: Text = "—";
  for (const sec of durations) {
    const c = price({ capability: "i2v", quality: "standard", aspectRatio, durationSec: clipSeconds(sec) });
    clipUsd += c.usd;
    clipMs = c.ms;
    billedSec += c.units;
    clipProvider = c.providerId;
    clipBasis = c.basis;
  }
  add({
    stage: "clips",
    providerId: clipProvider,
    quantity: billedSec,
    unit: msg("unit.billedSec"),
    costUsd: clipUsd,
    seconds: (Math.ceil(clipCount / PARALLEL) * clipMs) / 1000,
    basis: clipCount === 0 ? msg("cost.basis.noClips") : joinText(clipBasis, msg("cost.basis.clips", { n: clipCount })),
  });

  // --- kurgu ve render (yerel, ücretsiz): 29 Eki ölçümü 4 dk video ≈ 258 sn render + ses normalizasyonu
  add({ stage: "timeline", via: msg("cost.via.local"), quantity: 1, unit: msg("unit.none"), costUsd: 0, seconds: 1, basis: msg("cost.basis.local") });
  add({
    stage: "render",
    via: msg("cost.via.remotion"),
    quantity: Math.round(videoSec),
    unit: msg("unit.videoSec"),
    costUsd: 0,
    seconds: 30 + videoSec * (vector ? VECTOR.renderX : 1.1),
    basis: vector ? msg("cost.basis.renderVector", { x: VECTOR.renderX }) : msg("cost.basis.render"),
  });

  // --- inceleme: çekim başına bir kare (yerel), 6 karelik gruplar halinde ucuz görsel model
  const batches = Math.ceil(shotCount / REVIEW.perBatch);
  add({
    stage: "review",
    providerId: "claude",
    via: msg("cost.via.vision"),
    quantity: shotCount,
    unit: msg("unit.frame"),
    costUsd: batches * REVIEW.batchUsd,
    seconds: shotCount * REVIEW.stillSec + Math.ceil(batches / PARALLEL) * REVIEW.batchSec,
    basis: msg("cost.basis.review", { n: REVIEW.perBatch, usd: REVIEW.batchUsd }),
  });

  rows.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  const sum = (rs: EstimateRow[], f: (r: EstimateRow) => number) => rs.reduce((n, r) => n + f(r), 0);
  const remaining = rows.filter((r) => !r.done);
  const totalUsd = sum(rows, (r) => r.costUsd);
  if (totalUsd > input.budgetUsd) warn(msg("cost.overBudget", { total: totalUsd.toFixed(2), cap: input.budgetUsd }));

  return {
    mode,
    videoSec,
    shots: shotCount,
    rows,
    totalUsd,
    totalSeconds: sum(rows, (r) => r.seconds),
    remainingUsd: sum(remaining, (r) => r.costUsd),
    remainingSeconds: sum(remaining, (r) => r.seconds),
    warnings,
  };
}

// ---------------- canlı ilerleme ----------------

export interface Progress {
  stage: Stage;
  label: Text;
  done: number;
  total: number;
  /** Kalan süre tahmini (sn); aşama içindeki gerçek hızdan. */
  etaSec?: number;
}

/** Çalışan aşamanın ilerlemesi: kaç parça bitti, gerçek hıza göre ne kadar kaldı. */
export function progressOf(state: EpisodeState, now = Date.now()): Progress | undefined {
  const running = STAGES.find((s) => !state.done[s] && state.stats?.[s] && !state.stats[s]!.endedAt);
  if (!running) return undefined;
  const counts: Partial<Record<Stage, [number, number]>> = {
    // Vektör modunda varlık başına tek çizim (seçilince bitmiş sayılır); görsel modda karakter 3, mekân 2 aday.
    concept:
      motionModeOf(state.input) === "vector"
        ? [Object.keys(state.concept?.selected ?? {}).length, (state.cast?.characters.length ?? 0) + (state.cast?.locations.length ?? 0)]
        : [
            Object.values(state.concept?.candidates ?? {}).reduce((n, l) => n + l.length, 0),
            (state.cast?.characters.length ?? 0) * 3 + (state.cast?.locations.length ?? 0) * 2,
          ],
    voice: [Object.keys(state.voice ?? {}).length, state.script?.scenes.length ?? 0],
    keyframes: motionModeOf(state.input) === "vector"
      ? [
          Object.values(state.vectorProps ?? {}).filter((p) => p.key).length,
          Object.keys(state.vectorProps ?? {}).length,
        ]
      : [Object.keys(state.keyframes ?? {}).length, state.shots?.length ?? 0],
    review: [Object.keys(state.stills ?? {}).length, state.shots?.length ?? 0],
    render: [state.renderPct ?? 0, 100],
    clips: [
      Object.keys(state.clips ?? {}).length,
      (state.shots ?? []).filter((s) => s.kind === "ai_clip").length,
    ],
  };
  const [done, total] = counts[running] ?? [0, 0];
  const startedAt = Date.parse(state.stats![running]!.startedAt);
  const elapsed = (now - startedAt) / 1000;
  const etaSec = done > 0 && total > done ? (elapsed / done) * (total - done) : undefined;
  return { stage: running, label: STAGE_LABELS[running], done, total, etaSec };
}

// ---------------- bölüm durumu ----------------

/** Çalışan aşama bu kadar süre durum kaydı yapmazsa süreç düşmüş (kapatılmış/çökmüş) sayılır. */
export const STALL_AFTER_MS = 15 * 60_000;

export type RunStatus = "running" | "stalled" | "waiting" | "error" | "done" | "idle";

/**
 * Bölümün tek bakışta durumu. CLI'dan başlatılmış işler de görünsün diye iş kaydına değil, pipeline'ın
 * durum dosyasına (aşama zamanları, son kayıt zamanı) bakar.
 */
export function runStatusOf(state: EpisodeState, now = Date.now()): { status: RunStatus; stage?: Stage } {
  const running = STAGES.find((s) => !state.done[s] && state.stats?.[s] && !state.stats[s]!.endedAt);
  if (running) {
    const last = Date.parse(state.heartbeatAt ?? state.stats![running]!.startedAt);
    return { status: now - last > STALL_AFTER_MS ? "stalled" : "running", stage: running };
  }
  if (state.lastError) return { status: "error", stage: state.lastError.stage };
  // İnceleme aşaması sonradan eklendi; videosu olan eski bölümler de bitmiş sayılır.
  // Sonradan geçersizleştirilmiş (render'ı yeniden açılmış) bölüm bitmiş sayılmaz.
  if ((state.render && state.done.render) || STAGES.every((s) => state.done[s])) return { status: "done" };
  const next = STAGES.find((s) => !state.done[s])!;
  // "--until script" gibi kısmi çalıştırmalar kapıya varmadan durur; bekleme yine de sıradaki aşamanın kapısından anlaşılır.
  const gate = gateBefore(next);
  if (gate && !isApproved(state, gate)) return { status: "waiting", stage: next };
  return { status: "idle", stage: next };
}
