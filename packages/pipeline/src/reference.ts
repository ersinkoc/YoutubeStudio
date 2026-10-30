import { createHash } from "node:crypto";
import type { AgentImage } from "@ys/agents";
import { QUALITY_GATE } from "@ys/core";
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

const UA = "YoutubeStudio/0.1 (vector illustration reference lookup)";
const MAX_IMAGES = QUALITY_GATE.maxReferences;
const MAX_SIDE = 768;

interface Candidate extends ReferenceSource {
  thumb: string;
}

async function getJsonUrl<T>(fetchFn: typeof fetch, url: string): Promise<T | undefined> {
  const res = await fetchFn(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
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
  deps: { store: AssetStore; fetch?: typeof fetch; log?: (m: string) => void },
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
  for (const search of [wikipediaLead, commonsSearch]) {
    try {
      candidates.push(...(await search(fetchFn, q)));
    } catch (e) {
      deps.log?.(`  referans araması başarısız (${search.name}): ${e instanceof Error ? e.message : String(e)}`);
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
      const res = await fetchFn(c.thumb, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
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
      deps.log?.(`  referans indirilemedi (${c.title}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await putJson(deps.store, `${dir}/index.json`, { query: q, sources: out.sources, keys: out.keys });
  return out;
}

/**
 * Nesne tarifinden kısa arama sorgusu: "Wooden laboratory workbench with beakers, front view" → "wooden laboratory
 * workbench". Yönetmen referans sorgusu vermediyse kullanılır (her nesne gerçek bir örneğe bakılarak çizilsin).
 */
export function searchQuery(description: string): string {
  const head = description.split(/[,.;:(]|\b(?:with|front view|side view|seen|no text)\b/i)[0] ?? description;
  return head
    .replace(/^\s*(an?|the)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ")
    .toLowerCase();
}

/** SVG'yi görsel modelin karşılaştırması için PNG'ye çevirir (beyaz zemin, uzun kenar ≤ 768). */
export async function rasterizeSvg(svg: string): Promise<AgentImage> {
  const png = await sharp(Buffer.from(svg), { density: 96 })
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  return { data: new Uint8Array(png), mimeType: "image/png" };
}
