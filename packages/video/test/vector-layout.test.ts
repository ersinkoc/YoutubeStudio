import { describe, expect, it } from "vitest";
import { stripBackdrop, VectorText } from "@ys/core";
import { layoutTexts, readable } from "../src/Vector.tsx";

const text = (t: string, y: number, style: "title" | "label" | "number" = "label") => VectorText.parse({ text: t, x: 960, y, style });

describe("yazı yerleşimi", () => {
  it("altyazı bölgesine inmez, en fazla iki yazı gösterir", () => {
    const placed = layoutTexts([text("1971", 1000, "number"), text("Intel", 950), text("üçüncü", 300)]);
    expect(placed).toHaveLength(2);
    for (const p of placed) expect(p.y).toBeLessThanOrEqual(800);
  });

  it("aynı yere konan yazıları üst üste bindirmez", () => {
    const [a, b] = layoutTexts([text("İlk mikroişlemci", 150, "title"), text("2.300 transistör", 160)]);
    // Başlık ~114 px, etiket ~52 px yüksek: merkezler arası en az yarı yükseklikler + boşluk.
    expect(b!.y - a!.y).toBeGreaterThanOrEqual(114 / 2 + 52 / 2 + 24 - 1);
  });

  it("uzun metni iki satıra sığacak kadar küçültür", () => {
    const [p] = layoutTexts([text("Bu çok uzun bir başlık ve anlatımı tekrar eden gereksiz bir cümle olarak yazılmış", 200, "title")]);
    expect(p!.size).toBeLessThan(104);
  });
});

describe("stripBackdrop", () => {
  const size = { width: 400, height: 800 };
  it("tuvali kaplayan dikdörtgeni ve arkadaki büyük daireyi atar, ince gölgeyi korur", () => {
    const svg =
      '<svg viewBox="0 0 400 800"><defs><linearGradient id="g"/></defs><rect width="400" height="800" fill="#eee"/>' +
      '<ellipse cx="200" cy="754" rx="95" ry="10" fill="#000"/><circle cx="200" cy="300" r="180" fill="#123"/><g id="body"/></svg>';
    expect(stripBackdrop(svg, size)).toBe(
      '<svg viewBox="0 0 400 800"><defs><linearGradient id="g"/></defs><ellipse cx="200" cy="754" rx="95" ry="10" fill="#000"/><g id="body"/></svg>',
    );
  });

  it("öznenin parçası olan küçük şekillere dokunmaz", () => {
    const svg = '<svg viewBox="0 0 400 800"><rect x="150" y="500" width="40" height="230"/><g id="head"/></svg>';
    expect(stripBackdrop(svg, size)).toBe(svg);
  });
});

describe("yazı rengi", () => {
  it("koyu renkleri reddeder, açık renkleri kullanır", () => {
    expect(readable("#1f6f6a")).toBeUndefined(); // teal: lacivert zeminde okunmuyordu
    expect(readable("#ffd84d")).toBe("#ffd84d");
    expect(readable("#fff")).toBe("#fff");
    expect(readable("tomato")).toBeUndefined();
    expect(readable(undefined)).toBeUndefined();
  });
});