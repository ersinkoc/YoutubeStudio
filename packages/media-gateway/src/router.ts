import type { BudgetTier, Micros, Quality } from "@ys/core";
import { estimateCost, supports } from "./pricing.ts";
import type { GenerationRequest, ProviderAdapter } from "./types.ts";

export interface RoutePolicy {
  tier: BudgetTier;
  /** Yerel (ComfyUI) sağlayıcılar kullanılsın mı. Varsayılan: evet. */
  useLocal?: boolean;
  maxCostMicros?: Micros;
  allow?: string[];
  deny?: string[];
}

export interface RankedProvider {
  adapter: ProviderAdapter;
  estimateMicros: Micros;
  score: number;
}

/**
 * Seviye yükseldikçe kalite, maliyete göre daha ağır basar.
 * ultra: neredeyse sadece fiyat; premium: neredeyse sadece kalite.
 */
const QUALITY_EXPONENT: Record<BudgetTier, number> = {
  ultra: 0.5,
  economy: 1,
  standard: 2,
  premium: 4,
};

/** Çekim kalitesine göre kabul edilen en düşük sağlayıcı kalitesi. */
const MIN_QUALITY: Record<Quality, number> = {
  draft: 0,
  standard: 0.5,
  hero: 0.75,
};

/** Seviyenin kendi kalite tabanı; premium bölümde ucuz model hiç aday olmaz. */
const TIER_MIN_QUALITY: Record<BudgetTier, number> = {
  ultra: 0,
  economy: 0,
  standard: 0.6,
  premium: 0.8,
};

/** Bedava (yerel) sağlayıcıların skoru sonsuza gitmesin diye. */
const COST_FLOOR_USD = 0.001;

/** Art arda hata veren sağlayıcıyı bir süre devre dışı bırakır. */
export class HealthTracker {
  private readonly failures = new Map<string, { count: number; lastAt: number }>();

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  recordSuccess(id: string): void {
    this.failures.delete(id);
  }

  recordFailure(id: string): void {
    const f = this.failures.get(id);
    this.failures.set(id, { count: (f?.count ?? 0) + 1, lastAt: this.now() });
  }

  isAvailable(id: string): boolean {
    const f = this.failures.get(id);
    if (!f || f.count < this.threshold) return true;
    if (this.now() - f.lastAt > this.cooldownMs) {
      this.failures.delete(id);
      return true;
    }
    return false;
  }
}

export function rankProviders(
  adapters: readonly ProviderAdapter[],
  req: GenerationRequest,
  policy: RoutePolicy,
  health?: HealthTracker,
): RankedProvider[] {
  const exponent = QUALITY_EXPONENT[policy.tier];
  const minQuality = Math.max(MIN_QUALITY[req.quality], TIER_MIN_QUALITY[policy.tier]);

  return adapters
    .filter((a) => supports(a, req))
    .filter((a) => policy.useLocal !== false || !a.local)
    .filter((a) => !policy.allow || policy.allow.includes(a.id))
    .filter((a) => !policy.deny?.includes(a.id))
    .filter((a) => a.qualityPrior >= minQuality)
    .filter((a) => health?.isAvailable(a.id) ?? true)
    .map((adapter) => {
      const estimateMicros = estimateCost(adapter.price, req);
      const costUsd = Math.max(estimateMicros / 1_000_000, COST_FLOOR_USD);
      return { adapter, estimateMicros, score: adapter.qualityPrior ** exponent / costUsd };
    })
    .filter((r) => policy.maxCostMicros === undefined || r.estimateMicros <= policy.maxCostMicros)
    .sort((a, b) => b.score - a.score);
}
