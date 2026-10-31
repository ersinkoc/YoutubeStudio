import { errorText, LocalizedError, msg, type Capability, type Msg, type Quality, type Text, type WordTiming } from "@ys/core";

/** Düz metni (sağlayıcının kendi hata metni, eski çağrılar) çevrilebilir mesaja sarar. */
export const asMsg = (text: Text): Msg => (typeof text === "string" ? msg("gw.text", { text }) : text);

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
   * stepSec: faturalama adımı (Kling 2.x 5 → 6 sn'lik istek 10 sn faturalanır; Kling 3 1 sn).
   * minSec: en az faturalanan süre.
   */
  | {
      unit: "per_second";
      usd: number;
      stepSec?: number;
      minSec?: number;
      /** Native ses istendiğinde (withAudio) saniye fiyatı; yoksa ses fiyatı değiştirmez. */
      withAudioUsd?: number;
    }
  | { unit: "per_1k_chars"; usd: number }
  /** defaultSec: süre verilmezse tahminde kullanılacak süre (varsayılan 60). */
  | { unit: "per_minute"; usd: number; defaultSec?: number };

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
  note?: Text;
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
export class ContentRejectedError extends LocalizedError {
  /**
   * true: üretim yapıldı ve sağlayıcı ücretlendirdi, ama çıktı filtreye takıldı (ör. fal `has_nsfw_concepts` → siyah
   * görsel). Gateway tahmini deftere yazar (tavan doğru kalsın) ama yine başka sağlayıcıya geçer.
   */
  readonly billed: boolean;

  constructor(message: Text, opts: { billed?: boolean } = {}) {
    super(asMsg(message));
    this.billed = opts.billed ?? false;
  }
}

/**
 * Yerel olumsuz prompt desteği olmayan modeller için: kaçınılacakları prompt'un sonuna "Avoid: …" olarak ekler.
 * Aksi hâlde negativePrompt sessizce düşüyordu.
 */
export function promptWithAvoid(prompt: string | undefined, negative: string | undefined): string | undefined {
  const avoid = negative?.trim();
  if (!avoid) return prompt;
  return prompt ? `${prompt}\n\nAvoid: ${avoid}` : `Avoid: ${avoid}`;
}

/**
 * İş sağlayıcıya kabul edildikten sonra başarısız oldu (bekleme süresi doldu, indirme hatası, iptal). Sağlayıcı
 * çoğunlukla ücretlendirmiştir: gateway tahmini deftere yazar ve başka sağlayıcıya geçip ikinci kez ödetmez.
 */
export class SubmittedJobError extends LocalizedError {
  constructor(
    message: Text,
    readonly jobId?: string,
  ) {
    super(asMsg(message));
  }
}

/** Gönderimden sonraki adımları sarar: içerik reddi olduğu gibi, diğer hatalar SubmittedJobError olur. */
export async function afterSubmit<T>(jobId: string | undefined, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ContentRejectedError || e instanceof SubmittedJobError) throw e;
    throw new SubmittedJobError(msg("gw.submitted", { job: jobId ?? "?", error: errorText(e) }), jobId);
  }
}