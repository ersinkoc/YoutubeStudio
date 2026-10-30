import type { LessonTarget } from "@ys/agents";
import { getJson, putJson, type AssetStore } from "@ys/storage";

/**
 * Orkestratörün hafızası: incelemelerden ve senaryo doktorundan çıkan genel kurallar. Bölümler arası kalıcıdır;
 * aynı kural tekrar bulundukça sayacı artar ve sonraki bölümlerde ilgili ajanın talimatına eklenir.
 */

export const LESSONS_KEY = "library/lessons.json";

export interface Lesson {
  target: LessonTarget;
  rule: string;
  /** Kaç bölümde/incelemede bulundu. */
  count: number;
  firstSeen: string;
  lastSeen: string;
  episodes: string[];
}

export interface LessonBook {
  lessons: Lesson[];
}

/** Benzer kuralları birleştirmek için kaba anahtar: küçük harf, noktalama ve dolgu kelimeleri atılmış. */
export function lessonKey(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "that", "are", "never", "always", "should"].includes(w))
    .sort()
    .join(" ");
}

export async function loadLessons(store: AssetStore): Promise<LessonBook> {
  return (await getJson<LessonBook>(store, LESSONS_KEY)) ?? { lessons: [] };
}

/** Yeni kuralları deftere ekler; aynısı varsa sayacı artırır. Saf: defteri değiştirip döndürür. */
export function mergeLessons(
  book: LessonBook,
  found: { target: LessonTarget; rule: string }[],
  episodeId: string,
  at = new Date().toISOString(),
): LessonBook {
  for (const f of found) {
    const rule = f.rule.trim();
    if (!rule) continue;
    const key = lessonKey(rule);
    const existing = book.lessons.find((l) => l.target === f.target && lessonKey(l.rule) === key);
    if (existing) {
      existing.lastSeen = at;
      if (!existing.episodes.includes(episodeId)) {
        existing.episodes.push(episodeId);
        existing.count++;
      }
    } else {
      book.lessons.push({ target: f.target, rule, count: 1, firstSeen: at, lastSeen: at, episodes: [episodeId] });
    }
  }
  return book;
}

/** Bir ajana verilecek en önemli kurallar: çok tekrarlanan ve yeni olan önce. */
export function topLessons(book: LessonBook, target: LessonTarget, limit = 8): string[] {
  return book.lessons
    .filter((l) => l.target === target)
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, limit)
    .map((l) => l.rule);
}

export async function saveLessons(store: AssetStore, book: LessonBook): Promise<void> {
  await putJson(store, LESSONS_KEY, book);
}

/** Küratörün birleştirdiği kurallarla bir hedefin derslerini değiştirir; sayaç ve bölümler kaynaklardan toplanır. */
export function applyCuration(
  book: LessonBook,
  target: LessonTarget,
  curated: { rule: string; sources: number[] }[],
): LessonBook {
  const current = book.lessons.filter((l) => l.target === target);
  const merged: Lesson[] = curated.flatMap(({ rule, sources }) => {
    const src = sources.map((i) => current[i]).filter((l): l is Lesson => l !== undefined);
    if (!src.length) return [];
    const episodes = [...new Set(src.flatMap((l) => l.episodes))];
    return [
      {
        target,
        rule,
        count: episodes.length,
        firstSeen: src.map((l) => l.firstSeen).sort()[0]!,
        lastSeen: src.map((l) => l.lastSeen).sort().at(-1)!,
        episodes,
      },
    ];
  });
  // Küratör hiçbir şey döndürmediyse (ya da geçersiz indeksler) mevcut dersler korunur.
  if (merged.length === 0) return book;
  book.lessons = [...book.lessons.filter((l) => l.target !== target), ...merged];
  return book;
}

/** Bu sayıyı aşan hedefin dersleri küratöre gönderilir. */
export const CURATE_ABOVE = 10;