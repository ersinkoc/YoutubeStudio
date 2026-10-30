import { VectorAssetMeta } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import { lineStyleOf, type EpisodeState } from "./state.ts";

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
