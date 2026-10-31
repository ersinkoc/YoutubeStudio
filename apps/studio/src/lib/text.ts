import { formatText, MESSAGES, type MessageLocale, type Msg, type Text } from "@ys/core/messages";

/*
 * Sunucunun ürettiği çevrilebilir metinler (tahmin satırları, birimler, fiyatlar) için ortak yardımcılar. Saf: hem sunucu
 * sayfaları hem istemci bileşenleri kullanır.
 */

/** Birim; miktar 1 iken mesajın tekil biçimi (`<anahtar>.one`) varsa o. */
function unitFor(n: number, unit: Text): Text {
  if (typeof unit === "string" || n !== 1) return unit;
  const one = `${unit.key}.one`;
  return one in MESSAGES ? ({ ...unit, key: one } as Msg) : unit;
}

/** "148 görsel" / "148 images": sayı arayüzün biçimiyle, birim seçili dilde. */
export function quantityText(locale: MessageLocale, n: number, unit: Text, number: (n: number) => string): string {
  return `${number(n)} ${formatText(locale, unitFor(n, unit))}`;
}

/** Tahmin satırının model sütunu: "claude (SVG)", sağlayıcı yoksa yalnız açıklama ("yerel"), ikisi de yoksa "—". */
export function providerText(locale: MessageLocale, row: { providerId?: string; via?: Text }): string {
  const via = row.via === undefined ? undefined : formatText(locale, row.via);
  if (!row.providerId) return via ?? "—";
  return via ? `${row.providerId} (${via})` : row.providerId;
}
