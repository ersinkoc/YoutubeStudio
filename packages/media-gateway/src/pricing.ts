import { usd, type Micros } from "@ys/core";
import type { GenerationRequest, PriceRule, ProviderAdapter } from "./types.ts";

const DEFAULT_VIDEO_SECONDS = 5;

export interface Billing {
  /** Faturalanan miktar (görsel adedi, saniye, karakter…). */
  units: number;
  unitLabel: "görsel" | "sn" | "karakter" | "dk" | "—";
  micros: Micros;
}

/** Sağlayıcının faturalama kuralına göre (yuvarlama dahil) faturalanacak miktar ve tutar. */
export function billing(price: PriceRule, req: GenerationRequest): Billing {
  switch (price.unit) {
    case "free":
      return { units: 0, unitLabel: "—", micros: 0 };
    case "per_output":
      return { units: 1, unitLabel: "görsel", micros: usd(price.usd) };
    case "per_second": {
      const requested = req.durationSec ?? DEFAULT_VIDEO_SECONDS;
      const step = price.stepSec ?? 1;
      const billed = Math.max(price.minSec ?? 0, Math.ceil(requested / step - 1e-9) * step);
      return { units: billed, unitLabel: "sn", micros: usd(price.usd * billed) };
    }
    case "per_1k_chars": {
      const chars = req.text?.length ?? 0;
      return { units: chars, unitLabel: "karakter", micros: usd((price.usd * chars) / 1000) };
    }
    case "per_minute": {
      const sec = req.durationSec ?? 60;
      return { units: sec / 60, unitLabel: "dk", micros: usd((price.usd * sec) / 60) };
    }
  }
}

/** Bir isteğin bu sağlayıcıdaki tahmini maliyeti (faturalama yuvarlaması dahil). */
export function estimateCost(price: PriceRule, req: GenerationRequest): Micros {
  return billing(price, req).micros;
}

/** Fiyat kuralını insan okunur hâle getirir: "$0.05/sn (5 sn adımlarla)". */
export function describePrice(price: PriceRule): string {
  switch (price.unit) {
    case "free":
      return "ücretsiz (yerel)";
    case "per_output":
      return `$${price.usd}/görsel`;
    case "per_second":
      return `$${price.usd}/sn${price.stepSec && price.stepSec > 1 ? ` (${price.stepSec} sn adımlarla)` : ""}${price.minSec ? `, en az ${price.minSec} sn` : ""}`;
    case "per_1k_chars":
      return `$${price.usd}/1000 karakter`;
    case "per_minute":
      return `$${price.usd}/dk`;
  }
}

export function supports(adapter: ProviderAdapter, req: GenerationRequest): boolean {
  if (!adapter.capabilities.includes(req.capability)) return false;
  const { limits } = adapter;
  const refCount = req.refs?.length ?? 0;
  if (limits.maxRefs !== undefined && refCount > limits.maxRefs) return false;
  if (req.durationSec !== undefined) {
    if (limits.minDurationSec !== undefined && req.durationSec < limits.minDurationSec) return false;
    if (limits.maxDurationSec !== undefined && req.durationSec > limits.maxDurationSec) return false;
  }
  if (req.aspectRatio && limits.aspectRatios && !limits.aspectRatios.includes(req.aspectRatio)) return false;
  if (limits.requiresVoiceId && !req.voiceId) return false;
  return true;
}
