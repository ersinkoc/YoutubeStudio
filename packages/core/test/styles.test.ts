import { describe, expect, it } from "vitest";
import { LineStyle } from "../src/vector.ts";
import { STYLE_PACKS, styleFromPack, stylePackOf } from "../src/styles.ts";

describe("stil paketleri", () => {
  it("en az 20 paket, kimlikler benzersiz, renkler geçerli, çizgi stili bilinen", () => {
    expect(STYLE_PACKS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(STYLE_PACKS.map((p) => p.id)).size).toBe(STYLE_PACKS.length);
    expect(new Set(STYLE_PACKS.map((p) => p.artStyle)).size).toBe(STYLE_PACKS.length);
    for (const p of STYLE_PACKS) {
      expect(p.palette.length, p.id).toBeGreaterThanOrEqual(3);
      for (const c of p.palette) expect(c, p.id).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(LineStyle.safeParse(p.lineStyle).success, p.id).toBe(true);
      expect(p.name.tr && p.name.en && p.designNotes && p.suits, p.id).toBeTruthy();
    }
  });

  it("paketin stil kitabı paket kimliğini ve tasarımcı notlarını taşır", () => {
    const style = styleFromPack(stylePackOf("noir")!);
    expect(style).toMatchObject({ pack: "noir", artStyle: "film noir illustration in high contrast" });
    expect(style.designNotes).toContain("red accent");
    expect(stylePackOf("yok")).toBeUndefined();
  });
});
