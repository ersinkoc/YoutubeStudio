/**
 * studio mesajları (bkz. ./index.ts): Stüdyo API yanıtlarındaki hatalar. İsteğin dilinde (çerez `ys-lang`, yoksa
 * Accept-Language) döner. Türkçeleri önceki yanıtlarla aynıdır (istemcinin eski hata eşlemesi bunlara bakar).
 */
export const STUDIO_MESSAGES = {
  "api.badEpisode": { tr: "Geçersiz bölüm", en: "Invalid episode" },
  "api.busy": { tr: "Önce çalışan iş bitmeli", en: "Wait for the running job to finish first" },
  "api.badMotion": { tr: "Geçersiz hareket modu", en: "Invalid motion mode" },
  "api.badAction": { tr: "Bilinmeyen eylem: {type}", en: "Unknown action: {type}" },
  "api.topic": { tr: "Konu gerekli", en: "A topic is required" },
  "api.bank.fields": { tr: "Ad ve tarif gerekli (çizgi stili geçerli olmalı)", en: "A name and a description are required (and a valid line style)" },
  "api.minutes": { tr: "Süre 0,5–30 dk olmalı", en: "Length must be 0.5–30 min" },
  "api.budget": { tr: "Bütçe pozitif olmalı", en: "Budget must be positive" },
  "api.jobRunning": { tr: "Zaten çalışan bir iş var: {label}", en: "A job is already running: {label}" },
  "api.noVideo": { tr: "Video yok", en: "No video" },
  "api.noVideoFile": { tr: "Video dosyası yok", en: "Video file missing" },
  "api.forbidden": { tr: "Yasak", en: "Forbidden" },
  "api.notFound": { tr: "Yok", en: "Not found" },
} as const;
