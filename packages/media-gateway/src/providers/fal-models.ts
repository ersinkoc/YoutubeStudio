import { toDataUri } from "../http.ts";
import type { AspectRatio, GenerationRequest, RefInput } from "../types.ts";
import type { FalModelSpec } from "./fal.ts";

/*
 * fal model kataloğu. Fiyatlar Eylül–Ekim 2026 üçüncü taraf kaynaklardan alınmış tahminlerdir
 * (docs/PROJE_PLANI.md §1, §18); fatura ile karşılaştırılıp güncellenecek.
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

const imageUrls = (res: Record<string, unknown>): string[] =>
  ((res.images as { url: string }[] | undefined) ?? []).map((i) => i.url);

const videoUrl = (res: Record<string, unknown>): string[] => {
  const v = res.video as { url: string } | undefined;
  return v ? [v.url] : [];
};

/** Kling 5 veya 10 saniyelik klip üretir; istenen süre en yakın üst değere yuvarlanır. */
const klingDuration = (sec = 5): string => (sec <= 5 ? "5" : "10");

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
    priceSource: { url: "https://fal.ai/models/fal-ai/flux/dev", checked: "2026-09-11", note: "~1 MP; megapiksel başına" },
    verified: true,
    buildInput: (req) => ({
      prompt: req.prompt,
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
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: refUri(req.refs?.[0]),
      aspect_ratio: req.aspectRatio ?? "16:9",
      seed: req.seed,
    }),
    outputUrls: imageUrls,
  },
  {
    id: "fal:kling-v2.1-std-i2v",
    endpoint: "fal-ai/kling-video/v2.1/standard/image-to-video",
    capabilities: ["i2v"],
    limits: { maxRefs: 1, minDurationSec: 1, maxDurationSec: 10 },
    qualityPrior: 0.7,
    // Kling 5 veya 10 sn klip üretir; 6 sn istek 10 sn faturalanır.
    price: { unit: "per_second", usd: 0.05, stepSec: 5, minSec: 5 },
    priceSource: { url: "https://fal.ai/models/fal-ai/kling-video/v2.1/standard/image-to-video", checked: "2026-10-29", note: "29 Eki faturası: 5 sn klip $0.25" },
    verified: true,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: refUri(ref(req, "first_frame", "character")),
      duration: klingDuration(req.durationSec),
      negative_prompt: req.negativePrompt,
    }),
    outputUrls: videoUrl,
  },
  {
    id: "fal:kling-v3-pro-i2v",
    endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    capabilities: ["i2v", "first_last_frame"],
    limits: { maxRefs: 2, minDurationSec: 1, maxDurationSec: 10 },
    qualityPrior: 0.85,
    price: { unit: "per_second", usd: 0.112, stepSec: 5, minSec: 5 },
    priceSource: { url: "https://www.developersdigest.tech/blog/image-video-generation-api-pricing-2026", checked: "2026-10-18", note: "Kling 3.0 1080p sessiz 0.8 Unit/sn; fal fiyatı doğrulanmadı" },
    verified: false,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: refUri(ref(req, "first_frame", "character")),
      tail_image_url: refUri(ref(req, "last_frame")),
      duration: klingDuration(req.durationSec),
      negative_prompt: req.negativePrompt,
      generate_audio: req.withAudio ?? false,
    }),
    outputUrls: videoUrl,
  },
  {
    id: "fal:seedance-2-ref2v",
    endpoint: "bytedance/seedance-2.0/reference-to-video",
    capabilities: ["ref2v"],
    limits: { maxRefs: 9, minDurationSec: 4, maxDurationSec: 15 },
    qualityPrior: 0.85,
    price: { unit: "per_second", usd: 0.23, minSec: 4 },
    priceSource: { url: "https://fal.ai/seedance-2.0", checked: "2026-09-01", note: "720p; sağlayıcıya göre $0.15–0.30/sn" },
    verified: false,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_urls: req.refs?.filter((r) => r.mimeType.startsWith("image/")).map((r) => refUri(r)),
      duration: req.durationSec ?? 5,
      resolution: "720p",
      generate_audio: req.withAudio ?? false,
    }),
    outputUrls: videoUrl,
  },
];
