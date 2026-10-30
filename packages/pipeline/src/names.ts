/**
 * Görsel modelleri gerçek kişi adı geçen istekleri reddediyor (30 Eki: Gemini, "Federico Faggin" ve
 * "Ted Hoff" referanslı her kareye IMAGE_OTHER döndü). Görünüm zaten referans görsellerden geldiği için
 * görsel prompt'unda adlar yerine nötr etiketler kullanılır.
 */

export interface NamedCharacter {
  id: string;
  name: string;
}

/** Kadro sırasına göre sabit etiket: c1 → "Character A". */
export function castAliases(characters: readonly NamedCharacter[]): Map<string, string> {
  return new Map(characters.map((c, i) => [c.id, `Character ${String.fromCharCode(65 + (i % 26))}`]));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Prompt'taki tam adları ve çok kelimeli adların soyadını etiketle değiştirir ("Faggin's desk" →
 * "Character A's desk"). Uzun adlar önce değiştirilir ki "Ted Hoff" içindeki "Hoff" iki kez işlenmesin.
 */
export function anonymizeNames(prompt: string, characters: readonly NamedCharacter[]): string {
  const aliases = castAliases(characters);
  const terms: { term: string; alias: string }[] = [];
  for (const c of characters) {
    const alias = aliases.get(c.id)!;
    terms.push({ term: c.name, alias });
    const words = c.name.split(/\s+/).filter(Boolean);
    const last = words.at(-1);
    if (words.length > 1 && last && last.length > 2 && /^\p{Lu}/u.test(last)) terms.push({ term: last, alias });
  }
  terms.sort((a, b) => b.term.length - a.term.length);
  let out = prompt;
  for (const { term, alias } of terms) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "gu"), alias);
  }
  return out;
}
