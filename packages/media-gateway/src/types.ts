import type { Capability, Quality, WordTiming } from "@ys/core";

export type RefRole =
  | "character"
  | "style"
  | "location"
  | "first_frame"
  | "last_frame"
  | "source_video"
  | "source_audio";

export interface RefInput {
  role: RefRole;
  bytes: Uint8Array;
  mimeType: string;
}

export type AspectRatio = "16:9" | "9:16" | "1:1";

/** Sağlayıcıdan bağımsız üretim isteği. Adapter'lar bunu kendi API şemalarına çevirir. */
export interface GenerationRequest {
  capability: Capability;
  quality: Quality;
  prompt?: string;
  negativePrompt?: string;
  refs?: RefInput[];
  durationSec?: number;
  aspectRatio?: AspectRatio;
  /** TTS metni. */
  text?: string;
  /** Sağlayıcıya özgü ses kimliği; TTS'te zorunlu olabilir. */
  voiceId?: string;
  language?: string;
  /** Video modellerinden native ses istenip istenmediği. Varsayılan: hayır (ses kendi hattımızdan gelir). */
  withAudio?: boolean;
  seed?: number;
  /** Adapter'a özel ek parametreler, doğrudan iletilir. */
  params?: Record<string, unknown>;
}

export interface OutputFile {
  bytes: Uint8Array;
  mimeType: string;
}

export interface GenerationResult {
  files: OutputFile[];
  words?: WordTiming[];
  providerMeta?: Record<string, unknown>;
}

export interface ProviderLimits {
  maxRefs?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  aspectRatios?: readonly AspectRatio[];
  requiresVoiceId?: boolean;
}

export type PriceRule =
  | { unit: "free" }
  | { unit: "per_output"; usd: number }
  /**
   * stepSec: faturalama adımı (Kling 5 → 6 sn'lik istek 10 sn faturalanır).
   * minSec: en az faturalanan süre.
   */
  | { unit: "per_second"; usd: number; stepSec?: number; minSec?: number }
  | { unit: "per_1k_chars"; usd: number }
  | { unit: "per_minute"; usd: number };

export interface GenerateContext {
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** Fiyatın nereden alındığı; stüdyonun fiyat kataloğunda gösterilir. */
export interface PriceSource {
  url: string;
  /** Kontrol tarihi (YYYY-AA-GG). */
  checked: string;
  note?: string;
}

/** Hesap kotası (ör. ElevenLabs aylık karakter). */
export interface Quota {
  unit: "chars" | "credits" | "usd";
  used: number;
  limit: number;
  resetsAt?: string;
  plan?: string;
}

export interface ProviderAdapter {
  /** "kaynak:model" biçiminde benzersiz kimlik, örn. "fal:kling-v3-pro-i2v". */
  readonly id: string;
  readonly local: boolean;
  readonly capabilities: readonly Capability[];
  readonly limits: ProviderLimits;
  /** 0–1 arası ön kalite tahmini; benchmark sonuçlarıyla zamanla güncellenecek. */
  readonly qualityPrior: number;
  readonly price: PriceRule;
  readonly priceSource?: PriceSource;
  generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult>;
  /** Kalan hesap kotası; işe başlamadan önce yetip yetmeyeceği kontrol edilir. */
  quota?(ctx: GenerateContext): Promise<Quota>;
}

/**
 * Sağlayıcı isteği içerik nedeniyle reddetti (güvenlik filtresi, gerçek kişi vb.). Sağlayıcı sağlıklıdır;
 * aynı sağlayıcının başka istekleri çalışmaya devam eder, bu yüzden sağlık sayacına yazılmaz.
 */
export class ContentRejectedError extends Error {}