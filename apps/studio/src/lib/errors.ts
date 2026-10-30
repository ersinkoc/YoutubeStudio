import type { MessageKey } from "./i18n";

/**
 * Sunucunun (pipeline eylemleri, API) Türkçe hata mesajlarını sözlük anahtarına çevirir: İngilizce arayüzde de
 * okunsun. Tanınmayan mesaj olduğu gibi gösterilir (günlük dili Türkçe).
 */
const KNOWN: [RegExp, MessageKey, string[]?][] = [
  [/^Önce çalışan iş bitmeli/, "err.busy"],
  [/zaten çalışıyor/, "err.busy"],
  [/^Önce senaryo üretilmeli/, "err.noScript"],
  [/^Seçim yapılmamış: (.+)/, "err.missingSelection", ["items"]],
  [/^Senaryo onaylandı; düzenlemek/, "err.scriptLocked"],
  [/^Konsept onaylandı; hareket modu/, "err.conceptLocked"],
  [/^Video render edildi; ses değiştirmek/, "err.voiceLocked"],
  [/^Yeniden çizilecek çekim yok/, "err.noShots"],
  [/^Kütüphanede onaylı karakter değil/, "err.notLibrary"],
  [/gerçeklik denetimi kapalıyken geçti/, "err.realismOnly"],
  [/^Reddedilen çizim depoda yok/, "err.rejectedMissing"],
  [/^Geçersiz hareket modu/, "err.badMotion"],
  [/^Bilinmeyen eylem/, "err.badAction"],
  [/^Geçersiz bölüm/, "err.badEpisode"],
  [/^Bölüm bulunamadı/, "err.badEpisode"],
  [/^Konu gerekli/, "err.topic"],
  [/^Süre 0,5–30 dk/, "err.minutes"],
  [/^Bütçe pozitif/, "err.budget"],
  [/^Dikey \(9:16\) vektör/, "err.verticalVector"],
];

export function errorKey(message: string): { key: MessageKey; vars: Record<string, string> } | undefined {
  for (const [re, key, names] of KNOWN) {
    const m = re.exec(message);
    if (m) return { key, vars: Object.fromEntries((names ?? []).map((n, i) => [n, m[i + 1] ?? ""])) };
  }
  return undefined;
}
