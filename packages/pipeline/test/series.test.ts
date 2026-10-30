import { describe, expect, it } from "vitest";
import { cleanSeries, newEpisodeState, seriesEpisodeIds, seriesStylePack, setSeries, summarizeSeries, type EpisodeInput, type EpisodeState } from "../src/light.ts";

const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 180, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30 };
let n = 0;
function ep(series: string | undefined, at: string, pack?: string): EpisodeState {
  const s = { ...newEpisodeState({ ...input, series }), id: `ep${++n}`, createdAt: at };
  if (pack) s.style = { artStyle: pack, promptPrefix: "", negativeRules: [], palette: ["#000000", "#111111", "#222222"], lighting: "", lensLanguage: "", pack };
  return s;
}

describe("seriler", () => {
  const a1 = ep("Osmanlı'nın Bilinmeyenleri", "2026-10-01", "ottoman-miniature");
  const a2 = ep("  osmanlı'nın   bilinmeyenleri ", "2026-10-05");
  const b1 = ep("Uzay", "2026-10-03", "space-sci-fi");
  const none = ep(undefined, "2026-10-04");

  it("büyük/küçük harf ve boşluk farkı ayrı seri yapmaz; en son bölümü olan seri önce", () => {
    const list = summarizeSeries([a1, a2, b1, none]);
    expect(list.map((s) => [s.name, s.episodes])).toEqual([
      ["Osmanlı'nın Bilinmeyenleri", 2],
      ["Uzay", 1],
    ]);
    expect(list[0]!.defaults).toMatchObject({ lang: "tr", minutes: 3 });
  });

  it("yeni bölüm serinin paketini devralır, serinin bölümleri bilinir", () => {
    expect(seriesStylePack([a1, a2, b1], a2)).toBe("ottoman-miniature");
    expect(seriesStylePack([a1, b1], none)).toBeUndefined();
    expect([...seriesEpisodeIds([a1, a2, b1], a2)]).toEqual([a1.id]);
  });

  it("seri adı temizlenir, boşsa seriden çıkar", () => {
    expect(cleanSeries("  A   B ")).toBe("A B");
    const s = ep("X", "2026-10-06");
    setSeries(s, "   ");
    expect(s.input.series).toBeUndefined();
  });
});
