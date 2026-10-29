import type { Capability } from "@ys/core";
import { billing, rankProviders, type GenerationRequest, type ProviderAdapter } from "@ys/media-gateway";
import { motionModeOf, STAGES, type EpisodeState, type MotionMode, type Stage } from "./state.ts";

/*
 * Bölüm maliyet ve süre tahmini. Para harcamaz, ağır bağımlılık yüklemez (stüdyo sunucusu çağırır).
 * - Maliyet: router'ın o adımda gerçekten seçeceği sağlayıcının fiyatı, fatura yuvarlaması dahil.
 * - Süre: defterden ölçülen sağlayıcı gecikmesi; ölçüm yoksa aşağıdaki varsayılanlar.
 * Bölüm ilerledikçe varsayımlar gerçek sayılarla değişir (karakter sayısı, çekim sayısı ve süreleri).
 */

export const STAGE_LABELS: Record<Stage, string> = {
  style: "Stil",
  story: "Hikâye",
  script: "Senaryo",
  cast: "Casting",
  concept: "Konsept görselleri",
  voice: "Seslendirme",
  shots: "Çekim planı",
  keyframes: "Kareler",
  clips: "Animasyon",
  timeline: "Kurgu",
  render: "Render",
};

/** Ölçüm yokken çağrı başı süre (ms). 29 Eki çalıştırmalarından. */
const DEFAULT_LATENCY_MS: Partial<Record<Capability, number>> = {
  t2i: 12_000,
  i2i_multiref: 15_000,
  i2v: 140_000,
  tts: 10_000,
  tts_timestamps: 8_000,
};

/** Ajan aşamaları: sabit + dakika başı (gerçek ölçümler: 3 dk senaryo $0.14/~50 sn, stil $0.014/12 sn). */
const AGENT_MODEL: Partial<Record<Stage, { usd: number; usdPerMin: number; sec: number; secPerMin: number }>> = {
  style: { usd: 0.015, usdPerMin: 0, sec: 12, secPerMin: 0 },
  story: { usd: 0.06, usdPerMin: 0.004, sec: 40, secPerMin: 3 },
  script: { usd: 0.08, usdPerMin: 0.02, sec: 30, secPerMin: 6 },
  cast: { usd: 0.02, usdPerMin: 0.002, sec: 20, secPerMin: 2 },
  shots: { usd: 0.04, usdPerMin: 0.015, sec: 20, secPerMin: 8 },
};

/** Aynı anda kaç görsel/klip üretiliyor (pipeline concurrency). */
const PARALLEL = 3;
const CHARS_PER_WORD = 6.5;
const WPM_DEFAULT: Record<string, number> = { tr: 115, de: 125, fi: 110, en: 150, es: 155, pt: 150, fr: 150 };

export interface EstimateRow {
  stage: Stage;
  label: string;
  providerId?: string;
  quantity: number;
  unit: string;
  costUsd: number;
  seconds: number;
  done: boolean;
  /** Tahminin dayanağı: "ölçüm (n=12)" veya "varsayılan". */
  basis: string;
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
  warnings: string[];
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
  const warnings: string[] = [];
  const quality = input.tier === "premium" ? "hero" : "standard";
  const aspectRatio = input.width === input.height ? "1:1" : input.width > input.height ? "16:9" : "9:16";

  const voiceMs = state.voice ? Object.values(state.voice).reduce((n, v) => n + v.durationMs, 0) : 0;
  const videoSec = voiceMs > 0 ? voiceMs / 1000 : input.targetSec;
  const minutes = videoSec / 60;
  const avgShotSec = mode === "animated" ? 4.5 : 5.5;
  const shotList = state.shots;
  const shotCount = shotList?.length ?? Math.max(1, Math.round(videoSec / avgShotSec));

  /** Bir isteği router'dan geçirip tek çağrının maliyet ve süresini verir. */
  const price = (req: GenerationRequest) => {
    const top = rankProviders(ctx.providers, req, policy)[0];
    if (!top) {
      warnings.push(`"${req.capability}" için uygun sağlayıcı yok (anahtar eksik olabilir)`);
      return { providerId: undefined, usd: 0, ms: DEFAULT_LATENCY_MS[req.capability] ?? 10_000, basis: "sağlayıcı yok", units: 0, unit: "" };
    }
    const bill = billing(top.adapter.price, req);
    const measured = ctx.latency[top.adapter.id];
    return {
      providerId: top.adapter.id,
      usd: bill.micros / 1_000_000,
      ms: measured?.avgMs ?? DEFAULT_LATENCY_MS[req.capability] ?? 10_000,
      basis: measured ? `ölçüm (n=${measured.n})` : "varsayılan",
      units: bill.units,
      unit: bill.unitLabel,
    };
  };

  const rows: EstimateRow[] = [];
  const add = (row: Omit<EstimateRow, "label" | "done">) =>
    rows.push({ ...row, label: STAGE_LABELS[row.stage], done: Boolean(state.done[row.stage]) });

  // --- ajanlar
  for (const stage of ["style", "story", "script", "cast", "shots"] as const) {
    const m = AGENT_MODEL[stage]!;
    add({
      stage,
      providerId: "claude",
      quantity: 1,
      unit: "çağrı",
      costUsd: m.usd + m.usdPerMin * minutes,
      seconds: m.sec + m.secPerMin * minutes,
      basis: "ölçüm (29 Eki)",
    });
  }

  // --- konsept: karakter başı 3, mekân başı 2 aday + 3 deneme karesi
  const chars = state.cast?.characters.length ?? 2;
  const locs = state.cast?.locations.length ?? 3;
  const conceptImages = chars * 3 + locs * 2 + 3;
  const ci = price({ capability: "t2i", quality, aspectRatio });
  add({
    stage: "concept",
    providerId: ci.providerId,
    quantity: conceptImages,
    unit: "görsel",
    costUsd: ci.usd * conceptImages,
    seconds: (Math.ceil(conceptImages / PARALLEL) * ci.ms) / 1000,
    basis: state.cast ? ci.basis : `${ci.basis}; kadro tahmini (${chars} karakter, ${locs} mekân)`,
  });

  // --- ses
  const lang = input.lang.split("-")[0]!;
  const narrationChars =
    state.script?.scenes.reduce((n, s) => n + s.narration.length, 0) ??
    Math.round(minutes * (WPM_DEFAULT[lang] ?? 140) * CHARS_PER_WORD);
  const scenes = state.script?.scenes.length ?? Math.max(1, Math.round(videoSec / 30));
  const vReq: GenerationRequest = {
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
    unit: "karakter",
    costUsd: v.usd,
    // Sahneler sırayla seslendirilir; ölçüm sahne başına.
    seconds: (scenes * v.ms) / 1000,
    basis: state.script ? v.basis : `${v.basis}; metin tahmini`,
  });

  // --- kareler (referanslı)
  const kf = price({
    capability: "i2i_multiref",
    quality,
    aspectRatio,
    refs: [{ role: "character", bytes: new Uint8Array(), mimeType: "image/png" }],
  });
  add({
    stage: "keyframes",
    providerId: kf.providerId,
    quantity: shotCount,
    unit: "görsel",
    costUsd: kf.usd * shotCount,
    seconds: (Math.ceil(shotCount / PARALLEL) * kf.ms) / 1000,
    basis: shotList ? kf.basis : `${kf.basis}; çekim sayısı tahmini`,
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
  let clipBasis = "—";
  for (const sec of durations) {
    const c = price({ capability: "i2v", quality: "standard", aspectRatio, durationSec: sec <= 5.5 ? 5 : 10 });
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
    unit: "sn (faturalanan)",
    costUsd: clipUsd,
    seconds: (Math.ceil(clipCount / PARALLEL) * clipMs) / 1000,
    basis: clipCount === 0 ? "hareket modu: animasyon yok" : `${clipBasis}; ${clipCount} klip`,
  });

  // --- kurgu ve render (yerel, ücretsiz): 29 Eki ölçümü 4 dk video ≈ 258 sn render + ses normalizasyonu
  add({ stage: "timeline", providerId: "yerel", quantity: 1, unit: "—", costUsd: 0, seconds: 1, basis: "yerel" });
  add({
    stage: "render",
    providerId: "yerel (Remotion)",
    quantity: Math.round(videoSec),
    unit: "sn video",
    costUsd: 0,
    seconds: 30 + videoSec * 1.1,
    basis: "ölçüm (29 Eki): ~1,1× video süresi",
  });

  rows.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  const sum = (rs: EstimateRow[], f: (r: EstimateRow) => number) => rs.reduce((n, r) => n + f(r), 0);
  const remaining = rows.filter((r) => !r.done);
  const totalUsd = sum(rows, (r) => r.costUsd);
  if (totalUsd > input.budgetUsd) warnings.push(`Tahmini toplam ($${totalUsd.toFixed(2)}) bütçe tavanını ($${input.budgetUsd}) aşıyor`);

  return {
    mode,
    videoSec,
    shots: shotCount,
    rows,
    totalUsd,
    totalSeconds: sum(rows, (r) => r.seconds),
    remainingUsd: sum(remaining, (r) => r.costUsd),
    remainingSeconds: sum(remaining, (r) => r.seconds),
    warnings: [...new Set(warnings)],
  };
}

// ---------------- canlı ilerleme ----------------

export interface Progress {
  stage: Stage;
  label: string;
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
    concept: [
      Object.values(state.concept?.candidates ?? {}).reduce((n, l) => n + l.length, 0),
      (state.cast?.characters.length ?? 0) * 3 + (state.cast?.locations.length ?? 0) * 2,
    ],
    voice: [Object.keys(state.voice ?? {}).length, state.script?.scenes.length ?? 0],
    keyframes: [Object.keys(state.keyframes ?? {}).length, state.shots?.length ?? 0],
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
