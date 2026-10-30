/**
 * Stüdyo kuralları: kalite kapısının eşikleri tek yerde. Pipeline bu sayılarla karar verir, Stüdyo'nun Kurallar
 * sayfası aynı sayıları gösterir; yazılı kural ile çalışan kural ayrışamaz.
 * 30 Eki kararı: "at gibi olmayan at" ya da hiçbir şeye benzemeyen SVG asla doğrudan kullanılmaz.
 */

export type GatedKind = "character" | "prop" | "background";

export const QUALITY_GATE = {
  /**
   * Tanınırlık alt sınırı (0–10): adı söylenmeden bakan biri bir saniyede ne olduğunu anlamalı. Arka planlar bilerek
   * boş oda kabuğudur; onlarda "tutarlı ve hangi tür mekân olduğu anlaşılıyor" yeterli.
   */
  recognizableMin: { character: 7, prop: 7, background: 5 } satisfies Record<GatedKind, number>,
  /** Gerçek bir özne (referans görselli) için referansa sadakat alt sınırı (0–10). */
  fidelityMin: 6,
  /** Bir varlık en çok kaç kez çizilir (ilk çizim + kusur listesiyle yeniden çizimler). */
  maxDraws: 3,
  /** Referans görsel sayısı üst sınırı (Wikipedia + Commons). */
  maxReferences: 3,
} as const;

/** Ekrandaki yazılar: aynı anda en çok kaç tane ve hangi dikey bant (alttaki ~%25 altyazının). */
export const TEXT_RULES = { maxTexts: 2, top: 60, bottom: 800 } as const;

/**
 * Hikâye nesnesinin okunabilir en kısa "en uzun kenarı" (m, derinlik ölçeğiyle çarpılır). Fiziksel olarak doğru ama
 * ekranda 15 px kalan not, kitap, çip görünmez (30 Eki denemesi); çizgi filmdeki gibi abartılır.
 */
export const READABLE_SIDE = { held: 0.28, surface: 0.18, floor: 0.14 } as const;

export interface GateScores {
  recognizable: number;
  /** Referans yoksa undefined. */
  fidelity?: number;
}

/** Kapı kararı: tanınırlık eşiği ve (referans varsa) sadakat eşiği birlikte sağlanmalı. */
export function gatePasses(kind: GatedKind, s: GateScores): boolean {
  if (s.recognizable < QUALITY_GATE.recognizableMin[kind]) return false;
  return s.fidelity === undefined || s.fidelity >= QUALITY_GATE.fidelityMin;
}

/** İki deneme arasında daha iyisi: önce geçen, sonra tanınırlık, sonra sadakat. */
export function betterGate(kind: GatedKind, a: GateScores, b: GateScores | undefined): boolean {
  if (!b) return true;
  const pa = gatePasses(kind, a);
  const pb = gatePasses(kind, b);
  if (pa !== pb) return pa;
  return a.recognizable + (a.fidelity ?? 0) > b.recognizable + (b.fidelity ?? 0);
}
