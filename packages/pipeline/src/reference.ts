import { createHash } from "node:crypto";
import type { AgentImage } from "@ys/agents";
import { errorText, msg, QUALITY_GATE, sanitizeSvg, svgSize, type Text } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import sharp from "sharp";

/**
 * Gerçek öznenin referans görselleri: önce Wikipedia'nın sayfa görseli (en temsili fotoğraf/tablo), sonra Wikimedia
 * Commons araması. Ücretsiz ve anahtarsız; görseller yalnız çizime rehber olur, videoya girmez. Sonuç (boş da olsa)
 * kütüphanede saklanır: aynı sorgu bir daha internete gitmez.
 */

export interface ReferenceSource {
  title: string;
  /** Görselin sayfası (lisans ve yazar bilgisi orada). */
  url: string;
  license?: string;
}

export interface References {
  images: AgentImage[];
  sources: ReferenceSource[];
  /** Depodaki görsel anahtarları (Stüdyo'da gösterim için). */
  keys: string[];
}

// Wikimedia iletişim bilgisi olmayan istemcileri daha sıkı sınırlar; kişisel e-posta yerine herkese açık proje adresi.
const UA = "YoutubeStudio/0.1 (https://github.com/ersinkoc/YoutubeStudio; vector illustration reference lookup)";

/**
 * Wikimedia istekleri sıraya girer (aralarında en az MIN_GAP_MS) ve 429'da Retry-After kadar (en çok 10 sn) bekleyip bir
 * kez yeniden denenir: paralel varlık çizimleri art arda istek atıp geçici olarak engelleniyordu.
 */
const MIN_GAP_MS = 400;
let lane: Promise<unknown> = Promise.resolve();
let lastAt = 0;
function wikimedia(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const run = lane.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      const res = await fetchFn(url, init);
      if (res.status !== 429 || attempt >= 1) return res;
      const retryAfter = Math.min(10, Number(res.headers.get("retry-after")) || 3);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
    }
  });
  lane = run.catch(() => {});
  return run;
}
const MAX_IMAGES = QUALITY_GATE.maxReferences;
const MAX_SIDE = 768;

interface Candidate extends ReferenceSource {
  thumb: string;
}

async function getJsonUrl<T>(fetchFn: typeof fetch, url: string): Promise<T | undefined> {
  const res = await wikimedia(fetchFn, url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  // 429/5xx geçicidir: hata fırlatılır ki sonuç önbelleğe "referans yok" diye yazılmasın.
  if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
  return res.ok ? ((await res.json()) as T) : undefined;
}

type Pages<P> = { query?: { pages?: Record<string, P & { index?: number }> } };
const byIndex = <P extends { index?: number }>(pages: Record<string, P> | undefined) => Object.values(pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** Sayfa başlığının kelimelerinden kaçı sorguda geçiyor (0–1): "Hagia Sophia" ↔ "Hagia Sophia exterior" = 1. */
export function titleMatch(title: string, query: string): number {
  const q = new Set(words(query));
  const t = words(title);
  return t.length ? t.filter((w) => q.has(w)).length / t.length : 0;
}

/**
 * Wikipedia'nın sayfa görseli. Arama ilk sırada yan konuyu getirebiliyor ("Hagia Sophia exterior" → "Runic
 * inscriptions in Hagia Sophia"); başlığı sorguyla en çok örtüşen sayfa seçilir, zayıf eşleşme atlanır.
 */
async function wikipediaLead(fetchFn: typeof fetch, query: string): Promise<Candidate[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=5&prop=pageimages|info&piprop=thumbnail&pithumbsize=${MAX_SIDE}&inprop=url&gsrsearch=${encodeURIComponent(query)}`;
  const data = await getJsonUrl<Pages<{ title: string; fullurl?: string; thumbnail?: { source: string } }>>(fetchFn, url);
  const best = byIndex(data?.query?.pages)
    .filter((p) => p.thumbnail?.source)
    .map((p) => ({ p, score: titleMatch(p.title, query) }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)[0];
  return best
    ? [{ title: best.p.title, url: best.p.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(best.p.title)}`, thumb: best.p.thumbnail!.source }]
    : [];
}

async function commonsSearch(fetchFn: typeof fetch, query: string): Promise<Candidate[]> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=${MAX_SIDE}&iiextmetadatafilter=LicenseShortName&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}`;
  type Info = { thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: { LicenseShortName?: { value?: string } } };
  const data = await getJsonUrl<Pages<{ title: string; imageinfo?: Info[] }>>(fetchFn, url);
  return byIndex(data?.query?.pages).flatMap((p) => {
    const info = p.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png)$/.test(info.mime ?? "")) return [];
    return [{ title: p.title.replace(/^File:/, ""), url: info.descriptionurl ?? info.thumburl, thumb: info.thumburl, license: info.extmetadata?.LicenseShortName?.value }];
  });
}

/** Dosya adı aynıysa (Wikipedia görseli Commons'ta da çıkar) tekrar sayılmaz. */
const fileOf = (u: string) => decodeURIComponent(u.split("?")[0]!.split("/").pop()!.replace(/^\d+px-/, ""));

export async function findReferences(
  query: string,
  deps: { store: AssetStore; fetch?: typeof fetch; log?: (t: Text) => void },
): Promise<References> {
  const q = query.trim();
  const dir = `library/reference/${createHash("sha256").update(q.toLowerCase()).digest("hex").slice(0, 24)}`;
  const cached = await getJson<{ sources: ReferenceSource[]; keys: string[] }>(deps.store, `${dir}/index.json`);
  if (cached) {
    const images = await Promise.all(cached.keys.map(async (key) => ({ data: (await deps.store.get(key))!, mimeType: "image/jpeg" })));
    return { images: images.filter((i) => i.data), sources: cached.sources, keys: cached.keys };
  }

  const fetchFn = deps.fetch ?? fetch;
  const candidates: Candidate[] = [];
  let searchFailed = false;
  for (const search of [wikipediaLead, commonsSearch]) {
    try {
      candidates.push(...(await search(fetchFn, q)));
    } catch (e) {
      searchFailed = true;
      deps.log?.(msg("log.ref.searchFailed", { source: search.name, error: errorText(e) }));
    }
  }
  const seen = new Set<string>();
  const out: References = { images: [], sources: [], keys: [] };
  for (const c of candidates) {
    if (out.images.length >= MAX_IMAGES) break;
    const file = fileOf(c.thumb);
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const res = await wikimedia(fetchFn, c.thumb, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        // 429/5xx geçici: sonuç önbelleğe yazılmasın ki sonraki çalıştırma yeniden denesin.
        if (res.status === 429 || res.status >= 500) searchFailed = true;
        continue;
      }
      // Tek biçim ve boyut: JPEG, uzun kenar ≤ 768 (görsel model sınırları ve depo boyutu için).
      const jpeg = new Uint8Array(
        await sharp(Buffer.from(await res.arrayBuffer()))
          .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 82 })
          .toBuffer(),
      );
      const key = `${dir}/${out.keys.length}.jpg`;
      await deps.store.put(key, jpeg, "image/jpeg");
      out.images.push({ data: jpeg, mimeType: "image/jpeg" });
      out.sources.push({ title: c.title, url: c.url, license: c.license });
      out.keys.push(key);
    } catch (e) {
      searchFailed = true;
      deps.log?.(msg("log.ref.downloadFailed", { title: c.title, error: errorText(e) }));
    }
  }
  // Arama yarıda kaldıysa (ağ, 429/5xx) sonuç önbelleğe yazılmaz: geçici bir hata kalıcı "referans yok" olmasın.
  if (!searchFailed) await putJson(deps.store, `${dir}/index.json`, { query: q, sources: out.sources, keys: out.keys });
  return out;
}

/**
 * Nesne tarifinden kısa arama sorgusu: "Wooden laboratory workbench with beakers, front view" → "wooden laboratory
 * workbench". Yönetmen referans sorgusu vermediyse kullanılır (her nesne gerçek bir örneğe bakılarak çizilsin).
 */
export function searchQuery(description: string): string {
  // split her zaman en az bir parça döndürür.
  const head = description.split(/[,.;:(]|\b(?:with|front view|side view|seen|no text)\b/i)[0]!;
  const words = head
    .replace(/^\s*(an?|the)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.toLowerCase());
  // 5 kelimede kesilen sorgu işlev sözcüğüyle bitmesin: "flat perforated build platform on" çakmaktaşı aletler,
  // "small pile of white plastic" karpuz getirdi (31 Eki üretim verisi).
  while (words.length > 1 && TRAILING_STOPWORDS.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}

const TRAILING_STOPWORDS = new Set(["on", "of", "in", "at", "to", "for", "from", "and", "or", "by", "into", "onto", "under", "over", "near", "its", "their", "a", "an", "the"]);

/** SVG'yi görsel modelin karşılaştırması için PNG'ye çevirir (beyaz zemin, uzun kenar ≤ 768). */
export async function rasterizeSvg(svg: string): Promise<AgentImage> {
  const png = await sharp(Buffer.from(svg), { density: 96 })
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  return { data: new Uint8Array(png), mimeType: "image/png" };
}

/** Commons'tan bulunan hazır SVG: temizlenmiş, kaynağı ve lisansıyla. */
export interface VectorSource {
  svg: string;
  source: ReferenceSource;
}

/** Yalnız atıf gerektirmeyen lisanslar: video açıklamasına atıf yazmadan kullanılabilsin. */
const FREE_LICENSE = /public domain|^pd\b|cc0|no restrictions/i;
const MAX_SVG_BYTES = 300_000;
/** Çok ayrıntılı çizim (harita, teknik şema, fotogerçekçi) sahnede gürültü olur. */
const MAX_ELEMENTS = 600;
/** Nesne çizimi olmayan Commons dosyaları (şema, logo, arma, yazı tipi, harita…): kapıya hiç gönderilmez. */
const NOT_OBJECT =
  /diagram|schema|scheme|схема|logo|icon|coat of arms|coa|emblem|flag|map|font|sample|layout|keyboard|pattern|chart|graph|plot|point|sign|cypher|seal|badge|symbol|network|axle|crease/i;
const STOP = new Set(["the", "a", "an", "of", "and", "with", "in", "on", "for", "to", "front", "view", "side"]);

/**
 * Nesne için Wikimedia Commons'ta hazır vektör çizim arar (kamu malı / CC0). Bulunanlar temizlenir ve kalite kapısına
 * aday olur: Claude'un koordinat yazarak çizdiğinden genelde daha doğru ve ucuzdur. Sonuç kütüphanede saklanır.
 */
export async function findVectorSources(
  query: string,
  deps: { store: AssetStore; fetch?: typeof fetch; log?: (t: Text) => void },
  limit = 2,
): Promise<VectorSource[]> {
  const q = query.trim();
  const dir = `library/vector-source/${createHash("sha256").update(q.toLowerCase()).digest("hex").slice(0, 24)}`;
  const cached = await getJson<{ items: { key: string; source: ReferenceSource }[] }>(deps.store, `${dir}/index.json`);
  if (cached) {
    const items = await Promise.all(cached.items.map(async (i) => ({ bytes: await deps.store.get(i.key), source: i.source })));
    return items.flatMap((i) => (i.bytes ? [{ svg: new TextDecoder().decode(i.bytes), source: i.source }] : []));
  }

  const fetchFn = deps.fetch ?? fetch;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiextmetadatafilter=LicenseShortName&gsrsearch=${encodeURIComponent(`filetype:drawing ${q}`)}`;
  type Info = { url?: string; descriptionurl?: string; mime?: string; size?: number; extmetadata?: { LicenseShortName?: { value?: string } } };
  let failed = false;
  let pages: ({ title: string; imageinfo?: Info[] } & { index?: number })[] = [];
  try {
    pages = byIndex((await getJsonUrl<Pages<{ title: string; imageinfo?: Info[] }>>(fetchFn, url))?.query?.pages);
  } catch (e) {
    failed = true;
    deps.log?.(msg("log.ref.vectorSearchFailed", { error: errorText(e) }));
  }
  const wanted = words(q).filter((w) => !STOP.has(w));
  const out: VectorSource[] = [];
  const items: { key: string; source: ReferenceSource }[] = [];
  for (const p of pages) {
    if (out.length >= limit) break;
    const info = p.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value ?? "";
    const title = p.title.replace(/^File:/, "");
    if (!info?.url || info.mime !== "image/svg+xml" || (info.size ?? 0) > MAX_SVG_BYTES || !FREE_LICENSE.test(license)) continue;
    // Başlık konuyla ilgili olmalı ("Horse silhouette.svg" ↔ "horse"); arama motoru açıklamadan alakasız dosya getirebiliyor.
    const titleWords = new Set(words(title));
    if (!wanted.some((w) => titleWords.has(w)) || NOT_OBJECT.test(title)) continue;
    try {
      const res = await wikimedia(fetchFn, info.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) failed = true;
        continue;
      }
      const svg = sanitizeSvg(await res.text());
      svgSize(svg);
      // Temizlenmiş SVG her zaman <svg ile başlar: eşleşme vardır.
      if (svg.match(/</g)!.length > MAX_ELEMENTS) continue;
      const key = `${dir}/${items.length}.svg`;
      await deps.store.put(key, new TextEncoder().encode(svg), "image/svg+xml");
      const source = { title, url: info.descriptionurl ?? info.url, license };
      items.push({ key, source });
      out.push({ svg, source });
    } catch (e) {
      // Bozuk ya da viewBox'sız SVG atlanır; ağ hatası önbelleğe "yok" yazdırmaz.
      if (!(e instanceof Error && /SVG/.test(e.message))) failed = true;
    }
  }
  if (!failed) await putJson(deps.store, `${dir}/index.json`, { query: q, items });
  return out;
}
