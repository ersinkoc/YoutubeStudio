import type { LineStyle } from "@ys/core";
import type { EpisodeState, MotionMode } from "./state.ts";

/**
 * Seriler: bölümler seri adıyla gruplanır. Aynı serinin bölümleri aynı stil paketini kullanır (ilk bölümde seçilen
 * paket sonrakilerde de geçerli, "auto" yeniden seçmez) ve kütüphanede o serinin karakterleri önce önerilir.
 */
export const SERIES_MAX = 80;

export const seriesOf = (s: Pick<EpisodeState, "input">): string | undefined => s.input.series?.trim() || undefined;

/** Seri adı karşılaştırması: büyük/küçük harf ve fazladan boşluk farkı ayrı seri yapmaz. */
export const sameSeries = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr") === b.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr"));

export function cleanSeries(name: string | undefined): string | undefined {
  return name?.trim().replace(/\s+/g, " ").slice(0, SERIES_MAX) || undefined;
}

/** Yeni bölüm formunda seri seçilince doldurulan ayarlar: serinin son bölümünden. */
export interface SeriesDefaults {
  lang: string;
  minutes: number;
  tier: string;
  motionMode?: MotionMode;
  /** Çözümlenmiş paket (son bölümün gerçekten kullandığı); yoksa girdi. */
  stylePack?: string;
  lineStyle?: LineStyle;
  voiceId?: string;
  budgetUsd: number;
}

export interface SeriesSummary {
  name: string;
  episodes: number;
  videos: number;
  lastAt: string;
  defaults: SeriesDefaults;
}

/** Bölümlerden seri özetleri (en son bölümü olan seri önce). */
export function summarizeSeries(states: readonly EpisodeState[]): SeriesSummary[] {
  const map = new Map<string, { summary: SeriesSummary; latest: EpisodeState }>();
  for (const s of states) {
    const name = seriesOf(s);
    if (!name) continue;
    const key = [...map.keys()].find((k) => sameSeries(k, name)) ?? name;
    const entry = map.get(key);
    if (!entry) {
      map.set(key, { summary: { name, episodes: 1, videos: s.render ? 1 : 0, lastAt: s.createdAt, defaults: defaultsOf(s) }, latest: s });
      continue;
    }
    entry.summary.episodes++;
    if (s.render) entry.summary.videos++;
    if (s.createdAt > entry.latest.createdAt) {
      entry.latest = s;
      entry.summary.lastAt = s.createdAt;
      entry.summary.defaults = defaultsOf(s);
    }
  }
  return [...map.values()].map((e) => e.summary).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function defaultsOf(s: EpisodeState): SeriesDefaults {
  const { input } = s;
  return {
    lang: input.lang,
    minutes: input.targetSec / 60,
    tier: input.tier,
    motionMode: input.motionMode,
    stylePack: s.style?.pack ?? input.stylePack,
    lineStyle: input.lineStyle,
    voiceId: input.voiceId,
    budgetUsd: input.budgetUsd,
  };
}

/** Serinin daha önce kullandığı stil paketi (en yeni bölümden); seri tutarlı görünsün diye "auto" bunu kullanır. */
export function seriesStylePack(states: readonly EpisodeState[], current: EpisodeState): string | undefined {
  const name = seriesOf(current);
  if (!name) return undefined;
  return states
    .filter((s) => s.id !== current.id && sameSeries(seriesOf(s), name) && s.style?.pack)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.style?.pack;
}

/** Serinin bölüm kimlikleri (kütüphanede serinin karakterlerini öne almak için). */
export function seriesEpisodeIds(states: readonly EpisodeState[], current: EpisodeState): Set<string> {
  const name = seriesOf(current);
  return new Set(name ? states.filter((s) => s.id !== current.id && sameSeries(seriesOf(s), name)).map((s) => s.id) : []);
}
