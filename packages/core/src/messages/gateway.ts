/**
 * gateway mesajları (bkz. ./index.ts): sağlayıcı ve ajan hataları, devre dışı sağlayıcı nedenleri.
 * Türkçeleri önceki düz hata metinleriyle birebir aynıdır (günlük, CLI ve hata eşlemesi bunlara bakar).
 */
export const GATEWAY_MESSAGES = {
  // Düz metni (eski çağrı, sağlayıcının kendi hata metni) çevrilebilir hataya sarar.
  "gw.text": { tr: "{text}", en: "{text}" },
  // Liste birleştirme: iç içe mesajlar dil korunarak birleşsin diye.
  "gw.join.pipe": { tr: "{a} | {b}", en: "{a} | {b}" },
  "gw.join.semi": { tr: "{a}; {b}", en: "{a}; {b}" },
  "gw.failure": { tr: "{provider}: {error}", en: "{provider}: {error}" },
  "gw.allFailed": { tr: "Tüm sağlayıcılar başarısız: {list}", en: "All providers failed: {list}" },
  "gw.noProvider": {
    tr: '"{capability}" ({quality}, {tier}) için uygun sağlayıcı yok',
    en: 'No suitable provider for "{capability}" ({quality}, {tier})',
  },
  "gw.budget": {
    tr: "Bölüm {episode} bütçe tavanını aşacak; onay gerekli",
    en: "Episode {episode} would exceed its budget cap; approval needed",
  },
  "gw.budget.failed": {
    tr: "Bölüm {episode} bütçe tavanını aşacak; onay gerekli (başarısız: {list})",
    en: "Episode {episode} would exceed its budget cap; approval needed (failed: {list})",
  },
  "gw.noFiles": { tr: "Sağlayıcı dosya döndürmedi", en: "Provider returned no files" },
  "gw.http": { tr: "HTTP {status} {url}: {body}", en: "HTTP {status} {url}: {body}" },
  "gw.timeout.request": { tr: "İstek zaman aşımı ({ms} ms): {url}", en: "Request timed out ({ms} ms): {url}" },
  "gw.timeout.poll": { tr: "Zaman aşımı ({ms} ms)", en: "Timed out ({ms} ms)" },
  "gw.submitted": { tr: "gönderilmiş iş başarısız ({job}): {error}", en: "submitted job failed ({job}): {error}" },
  "gw.fal.nsfw": {
    tr: "fal güvenlik filtresi {n} görseli işaretledi (siyah görsel)",
    en: "fal safety filter flagged {n} image(s) (black image)",
  },
  "gw.fal.failed": { tr: "fal {type}: {error}", en: "fal {type}: {error}" },
  "gw.fal.errorType": { tr: "hata", en: "error" },
  "gw.fal.contentRejected": { tr: "fal içerik reddi: {body}", en: "fal content rejection: {body}" },
  "gw.noDetails": { tr: "ayrıntı yok", en: "no details" },
  "gw.noReason": { tr: "neden yok", en: "no reason" },
  "gw.unknown": { tr: "bilinmiyor", en: "unknown" },
  "gw.gemini.blocked": { tr: "Gemini engelledi: {reason}", en: "Gemini blocked: {reason}" },
  "gw.gemini.noImage": { tr: "Gemini görsel döndürmedi ({reason})", en: "Gemini returned no image ({reason})" },
  "gw.gemini.noImageText": {
    tr: "Gemini görsel döndürmedi ({reason}): {text}",
    en: "Gemini returned no image ({reason}): {text}",
  },
  "gw.gemini.noAudio": { tr: "Gemini TTS ses döndürmedi", en: "Gemini TTS returned no audio" },
  "gw.veo.error": { tr: "Veo: {error}", en: "Veo: {error}" },
  "gw.veo.noVideo": { tr: "Veo video döndürmedi: {reasons}", en: "Veo returned no video: {reasons}" },
  "gw.comfy.error": { tr: "ComfyUI hata: {detail}", en: "ComfyUI error: {detail}" },
  "gw.eleven.missing": { tr: "ElevenLabs TTS için voiceId ve text gerekli", en: "ElevenLabs TTS requires voiceId and text" },

  // Kurulmayan sağlayıcılar (Fiyatlar sayfası, CLI).
  "gw.skip.comfyFile": { tr: "comfy:{id} (workflow dosyası yok: {file})", en: "comfy:{id} (workflow file missing: {file})" },
  "gw.skip.comfy": { tr: "comfy:* (COMFYUI_URL veya manifest.json yok)", en: "comfy:* (no COMFYUI_URL or manifest.json)" },
  "gw.skip.unverified": {
    tr: "{id} (doğrulanmadı; FAL_ENABLE_UNVERIFIED=1 ile aç)",
    en: "{id} (unverified; enable with FAL_ENABLE_UNVERIFIED=1)",
  },
  "gw.skip.noKey": { tr: "{scope} ({key} yok)", en: "{scope} (no {key})" },
  "gw.skip.veo": {
    tr: "gemini:veo (veo-3.1-generate-preview kapandı; GEMINI_VEO_MODEL ile aç, doğrulanmadı)",
    en: "gemini:veo (veo-3.1-generate-preview was shut down; enable with GEMINI_VEO_MODEL, unverified)",
  },

  // Ajan (Claude) hataları.
  "agent.timeout": { tr: "{agent}: {sec} sn içinde bitmedi", en: "{agent}: did not finish within {sec} s" },
  "agent.noResult": { tr: "{agent}: sonuç mesajı gelmedi", en: "{agent}: no result message received" },
  "agent.failed": { tr: "{agent}: {subtype}{detail} (maliyet ${cost})", en: "{agent}: {subtype}{detail} (cost ${cost})" },
  "agent.apiError": { tr: "{agent}: API hatası{status}: {result}", en: "{agent}: API error{status}: {result}" },
  "agent.schema": { tr: "{agent}: şemaya uymayan çıktı: {detail}", en: "{agent}: output does not match the schema: {detail}" },
} as const;
