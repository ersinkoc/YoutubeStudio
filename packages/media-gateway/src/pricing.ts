import { msg, usd, type Micros, type Msg } from "@ys/core";
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
      const rate = req.withAudio && price.withAudioUsd !== undefined ? price.withAudioUsd : price.usd;
      return { units: billed, unitLabel: "sn", micros: usd(rate * billed) };
    }
    case "per_1k_chars": {
      const chars = req.text?.length ?? 0;
      return { units: chars, unitLabel: "karakter", micros: usd((price.usd * chars) / 1000) };
    }
    case "per_minute": {
      const sec = req.durationSec ?? price.defaultSec ?? 60;
      return { units: sec / 60, unitLabel: "dk", micros: usd((price.usd * sec) / 60) };
    }
  }
}

/** Defterdeki birim etiketleri (Türkçe saklanır, eski kayıtlarla uyumlu) ve arayüzdeki çevrilebilir karşılıkları. */
const UNIT_TEXT: Record<string, Msg> = {
  görsel: msg("unit.image"),
  sn: msg("unit.sec"),
  karakter: msg("unit.chars"),
  dk: msg("unit.min"),
  "—": msg("unit.none"),
};

/** Defter birim etiketini seçili dilde gösterilecek metne çevirir; tanınmayan etiket olduğu gibi kalır. */
export const unitText = (label: string): Msg | string => UNIT_TEXT[label] ?? label;

/** Bir isteğin bu sağlayıcıdaki tahmini maliyeti (faturalama yuvarlaması dahil). */
export function estimateCost(price: PriceRule, req: GenerationRequest): Micros {
  return billing(price, req).micros;
}

/** Fiyat kuralını insan okunur hâle getirir: "$0.05/sn (5 sn adımlarla)" (seçili dilde biçimlenir). */
export function describePrice(price: PriceRule): Msg {
  switch (price.unit) {
    case "free":
      return msg("price.free");
    case "per_output":
      return msg("price.perOutput", { usd: price.usd });
    case "per_second":
      return msg("price.perSecond", {
        usd: price.usd,
        step: price.stepSec && price.stepSec > 1 ? msg("price.step", { n: price.stepSec }) : "",
        min: price.minSec ? msg("price.minSec", { n: price.minSec }) : "",
        audio: price.withAudioUsd !== undefined ? msg("price.withAudio", { usd: price.withAudioUsd }) : "",
      });
    case "per_1k_chars":
      return msg("price.per1k", { usd: price.usd });
    case "per_minute":
      return msg("price.perMinute", { usd: price.usd });
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
