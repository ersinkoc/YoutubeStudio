import { usd, type Micros } from "@ys/core";
import type { GenerationRequest, PriceRule, ProviderAdapter } from "./types.ts";

const DEFAULT_VIDEO_SECONDS = 5;

/** Bir isteğin bu sağlayıcıdaki tahmini maliyeti. Gerçek faturayla Faz 1'de karşılaştırılacak. */
export function estimateCost(price: PriceRule, req: GenerationRequest): Micros {
  switch (price.unit) {
    case "free":
      return 0;
    case "per_output":
      return usd(price.usd);
    case "per_second":
      return usd(price.usd * (req.durationSec ?? DEFAULT_VIDEO_SECONDS));
    case "per_1k_chars":
      return usd(price.usd * ((req.text?.length ?? 0) / 1000));
    case "per_minute":
      return usd(price.usd * ((req.durationSec ?? 60) / 60));
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
