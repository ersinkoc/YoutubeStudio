import { LineStyle, LocalizedError, msg, stylePackOf, VectorAssetMeta } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import { cleanSeries, sameSeries } from "./series.ts";
import { lineStyleOf, motionModeOf, type EpisodeInput, type EpisodeState } from "./state.ts";

const CHARACTER_DIR = "library/vector/character/";

/** Kütüphanede onaylı, kimliği bilinen karakter: başka bölümde yeniden çizilmeden kullanılabilir. */
export interface LibraryCharacter {
  /** Kısa kimlik (anahtarın hash'i); casting ajanı bununla seçer. */
  id: string;
  key: string;
  name: string;
  description: string;
  reference?: string;
  pack?: string;
  artStyle: string;
  lineStyle: string;
  episodes: string[];
  /** Genel rol (bankada çizilenler). */
  role?: string;
  /** Bankada doğrudan çizildi. */
  bank?: boolean;
  /** Maskotu olduğu seriler. */
  mascotOf: string[];
}

export const libraryIdOf = (key: string) => key.slice(CHARACTER_DIR.length).replace(/\.svg$/, "");

/**
 * Kütüphanedeki karakterler (kalite kapısını geçmiş ya da insanın kabul ettiği; insanın reddettiği hariç). `style`
 * verilirse yalnız aynı stil ve çizgi stilindekiler: başka stilde çizilmiş karakter bu bölümde yabancı durur.
 */
export async function listLibraryCharacters(
  store: AssetStore,
  style?: { artStyle: string; lineStyle: string; realism?: boolean },
): Promise<LibraryCharacter[]> {
  const keys = (await store.list(CHARACTER_DIR)).filter((k) => /\/[0-9a-f]{32}\.svg\.json$/.test(k));
  const out: LibraryCharacter[] = [];
  for (const metaKey of keys) {
    const parsed = VectorAssetMeta.safeParse(await getJson(store, metaKey));
    if (!parsed.success) continue;
    const { identity, check } = parsed.data;
    if (!identity || !check?.passed || check.override?.decision === "rejected") continue;
    // Gerçeklik kapalı bölümde sadakatsiz geçmiş karakter, gerçeklik açık bölüme önerilmez (insan kabul etmediyse).
    if (style?.realism && check.fidelitySkipped && check.override?.decision !== "accepted") continue;
    if (style && (identity.artStyle !== style.artStyle || identity.lineStyle !== style.lineStyle)) continue;
    const key = metaKey.replace(/\.json$/, "");
    out.push({ id: libraryIdOf(key), key, ...identity });
  }
  return out.sort((a, b) => b.episodes.length - a.episodes.length || a.name.localeCompare(b.name));
}

/** Karakterin kullanıldığı bölümü kimliğine ekler (Stüdyo'da "N bölümde" diye görünür). */
export async function noteCharacterUse(store: AssetStore, key: string, episodeId: string): Promise<void> {
  const meta = await getJson<VectorAssetMeta>(store, `${key}.json`);
  if (!meta?.identity || meta.identity.episodes?.includes(episodeId)) return;
  await putJson(store, `${key}.json`, { ...meta, identity: { ...meta.identity, episodes: [...(meta.identity.episodes ?? []), episodeId] } });
}

/**
 * Kimlik bilgisi eklenmeden önce çizilmiş karakterler: bölüm durumlarından (kadro + seçim + stil) kimlik yazılır.
 * Para harcamaz; `pnpm ys library --backfill`.
 */
export async function backfillLibraryIdentities(store: AssetStore): Promise<number> {
  let added = 0;
  for (const stateKey of (await store.list("episodes/")).filter((k) => k.endsWith("/state.json"))) {
    const state = await getJson<EpisodeState>(store, stateKey);
    if (!state?.style || !state.cast || !state.concept) continue;
    for (const c of state.cast.characters) {
      const key = state.concept.selected[c.id]?.key;
      if (!key?.startsWith(CHARACTER_DIR)) continue;
      const meta = await getJson<VectorAssetMeta>(store, `${key}.json`);
      if (!meta) continue;
      const episodes = [...new Set([...(meta.identity?.episodes ?? []), state.id])];
      if (meta.identity?.episodes?.includes(state.id)) continue;
      const identity = meta.identity ?? {
        name: c.name,
        description: c.visualDescription,
        reference: c.reference,
        pack: state.style.pack,
        artStyle: state.style.artStyle,
        lineStyle: lineStyleOf(state),
        episodes: [],
      };
      await putJson(store, `${key}.json`, { ...meta, identity: { ...identity, episodes } });
      if (!meta.identity) added++;
    }
  }
  return added;
}

// ---------------- karakter bankası ----------------

/**
 * Karakter bankasında çizim yaparken kullanılan sanal bölümün kimliği: maliyet defterinde bu adla görünür, durumu
 * kaydedilmez (bölüm listesine girmez); Stüdyo'da bankanın işi bu kimlikle izlenir.
 */
export const CHARACTER_BANK_ID = "character-bank";

/** Bankadan bölüme seçilen karakterler ve bölüme uygulanacak stil (karakter yeniden çizilmeden kullanılsın diye). */
export interface BankChoice {
  characters: LibraryCharacter[];
  pack: string;
  lineStyle: LineStyle;
}

/**
 * Bankadan seçilen karakterleri bulur ve ortak stillerini döndürür: hepsi aynı stil paketinde ve çizgi stilinde
 * olmalı (bölüm o stile geçer). Paketsiz ("özel" stilde çizilmiş) karakterin stili yeniden kurulamaz, seçilemez.
 */
export async function bankChoice(store: AssetStore, ids: readonly string[]): Promise<BankChoice | undefined> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return undefined;
  const all = await listLibraryCharacters(store);
  const characters = wanted.map((id) => {
    const c = all.find((l) => l.id === id);
    if (!c) throw new LocalizedError(msg("err.bank.notFound", { id }));
    if (!c.pack || !stylePackOf(c.pack)) throw new LocalizedError(msg("err.bank.noPack", { name: c.name }));
    return c;
  });
  const [first] = characters;
  if (characters.some((c) => c.pack !== first!.pack || c.lineStyle !== first!.lineStyle)) {
    throw new LocalizedError(msg("err.bank.mixedStyles", { names: characters.map((c) => `${c.name} (${c.pack}/${c.lineStyle})`).join(", ") }));
  }
  return { characters, pack: first!.pack!, lineStyle: LineStyle.parse(first!.lineStyle) };
}

/** Karakteri serinin maskotu yapar (ya da çıkarır): serinin her bölümünün kadrosuna kendiliğinden girer. */
export async function setMascot(store: AssetStore, id: string, series: string, on: boolean): Promise<void> {
  const name = cleanSeries(series);
  const c = (await listLibraryCharacters(store)).find((l) => l.id === id);
  if (!c || !name) throw new LocalizedError(msg("err.bank.notFound", { id }));
  const meta = VectorAssetMeta.parse(await getJson(store, `${c.key}.json`));
  const rest = meta.identity!.mascotOf.filter((s) => !sameSeries(s, name));
  await putJson(store, `${c.key}.json`, { ...meta, identity: { ...meta.identity!, mascotOf: on ? [...rest, name] : rest } });
}

/** Serinin maskotları (bölüm kadrosuna kendiliğinden eklenir). */
export async function seriesMascots(store: AssetStore, series: string | undefined): Promise<LibraryCharacter[]> {
  if (!series) return [];
  return (await listLibraryCharacters(store)).filter((c) => c.mascotOf.some((s) => sameSeries(s, series)));
}

/**
 * Bölüm girdisine bankadan seçilenleri uygular: bölüm, karakterlerin stil paketine ve çizgi stiline geçer (karakterler
 * yeniden çizilmeden kullanılsın). Kimlik kütüphane kimliği ya da en az 6 haneli başı olabilir. Yalnız vektör modunda.
 */
export async function withBankChoice(store: AssetStore, input: EpisodeInput): Promise<EpisodeInput> {
  const asked = [input.presenter, ...(input.bankCast ?? [])].filter((id): id is string => Boolean(id));
  if (!asked.length) return input;
  if (motionModeOf(input) !== "vector") throw new LocalizedError(msg("err.bank.vectorOnly"));
  const all = await listLibraryCharacters(store);
  const full = (id: string) => {
    if (all.some((c) => c.id === id)) return id;
    const hits = id.length >= 6 ? all.filter((c) => c.id.startsWith(id)) : [];
    // Belirsiz ya da bilinmeyen kimlik olduğu gibi kalır; bankChoice "bankada yok" der.
    return hits.length === 1 ? hits[0]!.id : id;
  };
  const presenter = input.presenter ? full(input.presenter) : undefined;
  const bankCast = [...new Set((input.bankCast ?? []).map(full))].filter((id) => id !== presenter);
  const choice = (await bankChoice(store, [...(presenter ? [presenter] : []), ...bankCast]))!;
  return { ...input, presenter, bankCast: bankCast.length ? bankCast : undefined, stylePack: choice.pack, lineStyle: choice.lineStyle };
}
