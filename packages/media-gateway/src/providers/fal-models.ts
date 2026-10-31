import { msg } from "@ys/core";
import { toDataUri } from "../http.ts";
import { ContentRejectedError, promptWithAvoid, type AspectRatio, type GenerationRequest, type RefInput } from "../types.ts";
import type { FalModelSpec } from "./fal.ts";

/*
 * fal model kataloğu. Fiyatlar fal model sayfalarından alınmıştır (priceSource; docs/PROJE_PLANI.md §1, §18);
 * fatura ile karşılaştırılıp güncellenecek.
 * Yeni model eklemek: fal model sayfasındaki "API" sekmesinden endpoint ve girdi alanlarını
 * doğrula, buraya bir spec ekle, `verified: true` yap.
 */

/**
 * ~1 MP özel boyutlar. Hazır "landscape_16_9" 1024×576 üretiyor; 1080p'de bulanık kalıyordu
 * (gerçek denemede bulundu). fal megapiksel başına ücretlendirdiği için maliyet aynı.
 */
const FAL_IMAGE_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1344, height: 768 },
  "9:16": { width: 768, height: 1344 },
  "1:1": { width: 1024, height: 1024 },
};

const ref = (req: GenerationRequest, ...roles: RefInput["role"][]): RefInput | undefined =>
  req.refs?.find((r) => roles.includes(r.role));

const refUri = (r: RefInput | undefined): string | undefined => (r ? toDataUri(r.bytes, r.mimeType) : undefined);

/**
 * FLUX/Kontext çıktısı `has_nsfw_concepts` (görsel başına bool) döndürür; işaretli görsel siyah gelir
 * (https://fal.ai/models/fal-ai/flux/dev/api). İşaretliler atılır; hiç görsel kalmazsa içerik reddidir.
 * fal üretimi yine de ücretlendirdiği için hata `billed` işaretlidir (gateway tahmini deftere yazar).
 */
const imageUrls = (res: Record<string, unknown>): string[] => {
  const images = (res.images as { url: string }[] | undefined) ?? [];
  const flags = (res.has_nsfw_concepts as boolean[] | undefined) ?? [];
  const clean = images.filter((_, i) => flags[i] !== true);
  if (images.length > 0 && clean.length === 0) {
    throw new ContentRejectedError(msg("gw.fal.nsfw", { n: images.length }), { billed: true });
  }
  return clean.map((i) => i.url);
};

const videoUrl = (res: Record<string, unknown>): string[] => {
  const v = res.video as { url: string } | undefined;
  return v ? [v.url] : [];
};

/** Tam saniyeye yukarı yuvarlar ve [min, max] aralığına sıkıştırır; fal bu alanları metin olarak ister. */
const wholeSeconds = (sec: number, min: number, max: number): string =>
  String(Math.min(max, Math.max(min, Math.ceil(sec - 1e-9))));

/**
 * Kling 3 girdisi (standart ve pro aynı şema): `start_image_url` zorunlu, `end_image_url` isteğe bağlı,
 * süre "3".."15" (metin, 1 sn adım). `generate_audio` fal'da varsayılan true: ses kendi hattımızdan geldiği için
 * açıkça false gönderilir. Kaynak: https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api (31 Eki 2026).
 */
const kling3Input = (req: GenerationRequest): Record<string, unknown> => ({
  prompt: req.prompt,
  start_image_url: refUri(ref(req, "first_frame", "character")),
  end_image_url: refUri(ref(req, "last_frame")),
  duration: wholeSeconds(req.durationSec ?? 5, 3, 15),
  negative_prompt: req.negativePrompt,
  generate_audio: req.withAudio ?? false,
});

/** Tam saniye (tamsayı) olarak [min, max] aralığına; PixVerse/Vidu süreyi sayı ister. */
const intSeconds = (sec: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.ceil(sec - 1e-9)));

/**
 * Seedream 4.5 özel boyutu: kenarlar 1920–4096 ya da toplam piksel 2560×1440–4096×4096 olmalı
 * (https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api, 31 Eki 2026).
 */
const SEEDREAM_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 2560, height: 1440 },
  "9:16": { width: 1440, height: 2560 },
  "1:1": { width: 2048, height: 2048 },
};

export const FAL_MODELS: FalModelSpec[] = [
  {
    id: "fal:flux-dev",
    endpoint: "fal-ai/flux/dev",
    capabilities: ["t2i"],
    limits: { maxRefs: 0 },
    // 29 Eki denemesi: stil önekine Nano Banana 2'den belirgin şekilde daha az sadık.
    // 0.55 ile standart seviyenin tabanının (0.6) altında kalır: ekonomide FLUX, standartta NB2.
    qualityPrior: 0.55,
    price: { unit: "per_output", usd: 0.025 },
    priceSource: { url: "https://fal.ai/models/fal-ai/flux/dev", checked: "2026-09-11", note: msg("price.note.perMegapixel") },
    verified: true,
    // negative_prompt alanı yok (https://fal.ai/models/fal-ai/flux/dev/api): prompt'a "Avoid:" olarak eklenir.
    buildInput: (req) => ({
      prompt: promptWithAvoid(req.prompt, req.negativePrompt),
      image_size: FAL_IMAGE_SIZE[req.aspectRatio ?? "16:9"],
      seed: req.seed,
      num_images: 1,
    }),
    outputUrls: imageUrls,
  },
  {
    id: "fal:flux-kontext-pro",
    endpoint: "fal-ai/flux-pro/kontext",
    capabilities: ["i2i_multiref"],
    limits: { maxRefs: 1 },
    // Tek görseli düzenleyen bir model; referanstan yeni sahne kurmakta Nano Banana'nın gerisinde.
    // Standart tabanın (0.6) altında: karakterli keyframe'lerde NB2 seçilsin, ekonomide Kontext kalabilir.
    qualityPrior: 0.58,
    price: { unit: "per_output", usd: 0.04 },
    priceSource: { url: "https://fal.ai/models/fal-ai/flux-pro/kontext", checked: "2026-09-11" },
    verified: true,
    // negative_prompt alanı yok (https://fal.ai/models/fal-ai/flux-pro/kontext/api): prompt'a "Avoid:" olarak eklenir.
    buildInput: (req) => ({
      prompt: promptWithAvoid(req.prompt, req.negativePrompt),
      image_url: refUri(req.refs?.[0]),
      aspect_ratio: req.aspectRatio ?? "16:9",
      seed: req.seed,
    }),
    outputUrls: imageUrls,
  },
  {
    // Seedream 4.5 (ByteDance). Olumsuz prompt alanı yok: prompt'a "Avoid:" olarak eklenir. Çıktıda NSFW bayrağı yok.
    // Kalite tahmini denenmeden: Nano Banana'nın (0.8) gerisinde, FLUX'un önünde; görsel sağlayıcıları için yedek.
    id: "fal:seedream-4.5",
    endpoint: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    capabilities: ["t2i"],
    limits: { maxRefs: 0 },
    qualityPrior: 0.72,
    price: { unit: "per_output", usd: 0.04 },
    priceSource: { url: "https://fal.ai/pricing", checked: "2026-10-31" },
    verified: true,
    buildInput: (req) => ({
      prompt: promptWithAvoid(req.prompt, req.negativePrompt),
      image_size: SEEDREAM_SIZE[req.aspectRatio ?? "16:9"],
      seed: req.seed,
      num_images: 1,
    }),
    outputUrls: imageUrls,
  },
  {
    // Seedream 4.5 düzenleme: en çok 10 referans görsel (https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api).
    id: "fal:seedream-4.5-edit",
    endpoint: "fal-ai/bytedance/seedream/v4.5/edit",
    capabilities: ["i2i_multiref"],
    limits: { maxRefs: 10 },
    qualityPrior: 0.72,
    price: { unit: "per_output", usd: 0.04 },
    priceSource: { url: "https://fal.ai/pricing", checked: "2026-10-31" },
    verified: true,
    buildInput: (req) => ({
      prompt: promptWithAvoid(req.prompt, req.negativePrompt),
      image_urls: req.refs?.filter((r) => r.mimeType.startsWith("image/")).map((r) => refUri(r)),
      image_size: SEEDREAM_SIZE[req.aspectRatio ?? "16:9"],
      seed: req.seed,
      num_images: 1,
    }),
    outputUrls: imageUrls,
  },
  {
    // MiniMax H3 Max Turbo: ilk ve/veya son kare, süre ondalıklı saniye, 768P. Olumsuz prompt alanı yok.
    // Şema: https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api (31 Eki 2026). Ses üretim parametresi yok.
    // Kalite tahmini denenmeden 0.58: standart seviyenin tabanının (0.6) altında, yalnız ekonomide seçilir.
    id: "fal:minimax-h3-turbo-i2v",
    endpoint: "minimax/h3-max-turbo/image-to-video",
    capabilities: ["i2v", "first_last_frame"],
    // Üst süre sınırı sayfada yazmıyor; MiniMax video modelleri 10 sn'ye kadar üretiyor (varsayım).
    limits: { maxRefs: 2, minDurationSec: 1, maxDurationSec: 10 },
    qualityPrior: 0.58,
    // 16 Kas 2026'dan standart fiyat (768P); o tarihe dek %30–35 kampanya. Tahmin üst sınırdan yapılır.
    price: { unit: "per_second", usd: 0.04 },
    priceSource: {
      url: "https://fal.ai/models/minimax/h3-max-turbo/image-to-video",
      checked: "2026-10-31",
      note: msg("price.note.minimaxTurbo"),
    },
    verified: true,
    buildInput: (req) => ({
      prompt: promptWithAvoid(req.prompt, req.negativePrompt),
      image_url: refUri(ref(req, "first_frame", "character")),
      end_image_url: refUri(ref(req, "last_frame")),
      duration: Math.min(10, Math.max(1, req.durationSec ?? 5)),
      resolution: "768P",
      prompt_expansion_mode: "balanced",
      seed: req.seed,
    }),
    outputUrls: videoUrl,
  },
  {
    // PixVerse V6: yalnız ilk kare, süre 1–15 tamsayı, 720p. Ses generate_audio_switch ile (fiyatı artırır).
    // Şema ve fiyat: https://fal.ai/models/fal-ai/pixverse/v6/image-to-video (31 Eki 2026). Kalite tahmini denenmeden.
    id: "fal:pixverse-v6-i2v",
    endpoint: "fal-ai/pixverse/v6/image-to-video",
    capabilities: ["i2v"],
    limits: { maxRefs: 1, minDurationSec: 1, maxDurationSec: 15 },
    qualityPrior: 0.55,
    price: { unit: "per_second", usd: 0.045, withAudioUsd: 0.06 },
    priceSource: {
      url: "https://fal.ai/models/fal-ai/pixverse/v6/image-to-video",
      checked: "2026-10-31",
      note: msg("price.note.kling", { silent: 0.045, audio: 0.06 }),
    },
    verified: true,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: refUri(ref(req, "first_frame", "character")),
      duration: intSeconds(req.durationSec ?? 5, 1, 15),
      resolution: "720p",
      negative_prompt: req.negativePrompt,
      seed: req.seed,
      generate_audio_switch: req.withAudio ?? false,
    }),
    outputUrls: videoUrl,
  },
  {
    // Vidu Q3 Turbo: ilk ve son kare, süre 1–16 tamsayı. Ses varsayılan açık (audio): kendi hattımızdan geldiği için
    // kapatılır; fiyat sesten bağımsız, 720p'de 360/540p'nin ($0.035) 2,2 katı.
    // Şema ve fiyat: https://fal.ai/models/fal-ai/vidu/q3/image-to-video/turbo (31 Eki 2026). Kalite tahmini denenmeden.
    id: "fal:vidu-q3-turbo-i2v",
    endpoint: "fal-ai/vidu/q3/image-to-video/turbo",
    capabilities: ["i2v", "first_last_frame"],
    limits: { maxRefs: 2, minDurationSec: 1, maxDurationSec: 16 },
    qualityPrior: 0.62,
    price: { unit: "per_second", usd: 0.077 },
    priceSource: { url: "https://fal.ai/models/fal-ai/vidu/q3/image-to-video/turbo", checked: "2026-10-31", note: msg("price.note.vidu") },
    verified: true,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: refUri(ref(req, "first_frame", "character")),
      end_image_url: refUri(ref(req, "last_frame")),
      duration: intSeconds(req.durationSec ?? 5, 1, 16),
      resolution: "720p",
      audio: req.withAudio ?? false,
      seed: req.seed,
    }),
    outputUrls: videoUrl,
  },
  {
    // Kling 2.6 Pro: start/end görsel, süre yalnız "5" ya da "10" (5 sn adım). Şema:
    // https://fal.ai/models/fal-ai/kling-video/v2.6/pro/image-to-video/api (31 Eki 2026). Fiyat yalnız fal fiyat
    // sayfasından ($0.07/sn, ses ayrımı yazmıyor): doğrulanmamış sayılır.
    id: "fal:kling-v2.6-pro-i2v",
    endpoint: "fal-ai/kling-video/v2.6/pro/image-to-video",
    capabilities: ["i2v", "first_last_frame"],
    limits: { maxRefs: 2, minDurationSec: 1, maxDurationSec: 10 },
    // Kling 3 standardın (0.75) gerisinde: fiyatı doğrulanana dek standart seviyede onun önüne geçmesin.
    qualityPrior: 0.66,
    price: { unit: "per_second", usd: 0.07, stepSec: 5, minSec: 5 },
    priceSource: { url: "https://fal.ai/pricing", checked: "2026-10-31" },
    verified: false,
    buildInput: (req) => ({
      prompt: req.prompt,
      start_image_url: refUri(ref(req, "first_frame", "character")),
      end_image_url: refUri(ref(req, "last_frame")),
      duration: (req.durationSec ?? 5) > 5 ? "10" : "5",
      negative_prompt: req.negativePrompt,
      generate_audio: req.withAudio ?? false,
    }),
    outputUrls: videoUrl,
  },
  {
    // Kling 2.1 standart (fal-ai/kling-video/v2.1/standard/image-to-video) fal'da kullanımdan kaldırıldı (31 Eki 2026);
    // yerini Kling 3 standart aldı. Kimlik değişti: eski "fal:kling-v2.1-std-i2v" önbellek kayıtları yeniden kullanılmaz.
    id: "fal:kling-v3-std-i2v",
    endpoint: "fal-ai/kling-video/v3/standard/image-to-video",
    capabilities: ["i2v", "first_last_frame"],
    limits: { maxRefs: 2, minDurationSec: 1, maxDurationSec: 15 },
    qualityPrior: 0.75,
    // 1 sn adımla en az 3 sn faturalanır; sesli $0.126/sn (ses kontrolü $0.154/sn, kullanılmıyor).
    price: { unit: "per_second", usd: 0.084, minSec: 3, withAudioUsd: 0.126 },
    priceSource: {
      url: "https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video",
      checked: "2026-10-31",
      note: msg("price.note.kling", { silent: 0.084, audio: 0.126 }),
    },
    verified: true,
    buildInput: kling3Input,
    outputUrls: videoUrl,
  },
  {
    id: "fal:kling-v3-pro-i2v",
    endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    capabilities: ["i2v", "first_last_frame"],
    limits: { maxRefs: 2, minDurationSec: 1, maxDurationSec: 15 },
    qualityPrior: 0.85,
    price: { unit: "per_second", usd: 0.112, minSec: 3, withAudioUsd: 0.168 },
    priceSource: {
      url: "https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video",
      checked: "2026-10-31",
      note: msg("price.note.klingPro", { silent: 0.112, audio: 0.168, control: 0.196 }),
    },
    // Şema ve fiyat 31 Eki'de fal sayfasından doğrulandı; pahalı katmanı varsayılan açmak kullanıcı kararı.
    verified: false,
    buildInput: kling3Input,
    outputUrls: videoUrl,
  },
  {
    id: "fal:seedance-2-ref2v",
    endpoint: "bytedance/seedance-2.0/reference-to-video",
    capabilities: ["ref2v"],
    limits: { maxRefs: 9, minDurationSec: 4, maxDurationSec: 15 },
    qualityPrior: 0.85,
    // Ses dahil (generate_audio fiyatı değiştirmez). Video referansıyla $0.1814/sn ama video referansı gönderilmiyor.
    price: { unit: "per_second", usd: 0.3024, minSec: 4 },
    priceSource: {
      url: "https://fal.ai/models/bytedance/seedance-2.0/reference-to-video",
      checked: "2026-10-31",
      note: msg("price.note.seedance"),
    },
    verified: false,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_urls: req.refs?.filter((r) => r.mimeType.startsWith("image/")).map((r) => refUri(r)),
      // "auto" veya "4".."15" (metin).
      duration: wholeSeconds(req.durationSec ?? 5, 4, 15),
      aspect_ratio: req.aspectRatio ?? "16:9",
      resolution: "720p",
      generate_audio: req.withAudio ?? false,
    }),
    outputUrls: videoUrl,
  },
];
