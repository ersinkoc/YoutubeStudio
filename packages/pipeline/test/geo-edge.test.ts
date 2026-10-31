import { describe, expect, it } from "vitest";
import { MapSpec } from "@ys/core";
import { flagCodes, generateMap } from "../src/geo.ts";

const palette = ["#1d2433", "#3a4a66", "#c8553d"];

describe("harita: kenar durumlar", () => {
  it("uygun vurgu rengi olmayan palette sıcak turuncuya düşer; alpha-2 kodu da tanınır", async () => {
    const map = await generateMap(MapSpec.parse({ focus: ["tr"], highlight: [{ countries: ["tr"] }] }), "tr", ["#000000", "#ffffff", "#808080"]);
    expect(map.svg).toContain('fill="#d9783c"');
    expect(map.meta.labels?.map((l) => l.text)).toContain("TÜRKİYE");
  });

  it("küre: odak yoksa sabit merkez, odak varsa ülkenin üstü; arka yüzdeki ülkeye etiket yazılmaz", async () => {
    const world = await generateMap(MapSpec.parse({ projection: "globe" }), "en", palette);
    expect(world.svg).toContain('fill="#1b2333"');
    expect(world.svg).toContain('stroke="#8fa3b5"');
    expect(world.meta.labels).toEqual([]);

    const globe = await generateMap(
      MapSpec.parse({
        projection: "globe",
        focus: ["TUR"],
        highlight: [
          { countries: ["AUS"], label: "Avustralya" },
          { countries: ["NZL", "CHL"] },
          { countries: ["GRC", "TUR", "BGR"], label: "Balkanlar ve Anadolu", tone: "warm" },
        ],
      }),
      "tr",
      palette,
    );
    const texts = globe.meta.labels!.map((l) => l.text);
    expect(texts).toContain("BALKANLAR VE ANADOLU");
    expect(texts).not.toContain("AVUSTRALYA");
    expect(texts.some((t) => /ZELANDA|ŞİLİ/.test(t))).toBe(false);
    expect(globe.svg).toContain('fill="#d9785c"');
  });

  it("tek şehirlik küçük bölgede aşırı yakınlaşmaz; tek parçalı ülke etiketi ortasında; boşluklu kod da adıyla yazılır", async () => {
    const map = await generateMap(
      MapSpec.parse({
        markers: [
          { lon: 7.44, lat: 46.95, label: "Bern" },
          { lon: 8.54, lat: 47.37, label: "Zürih" },
        ],
        highlight: [{ countries: [" che "], tone: "muted" }],
      }),
      "en",
      palette,
    );
    const labels = map.meta.labels!;
    const bern = labels.find((l) => l.text === "Bern")!;
    const zurich = labels.find((l) => l.text === "Zürih")!;
    // 5200 ölçeğinde ~1 derece ≈ 90 px: iki şehir yakın ama ayrı.
    expect(Math.hypot(bern.x - zurich.x, bern.y - zurich.y)).toBeGreaterThan(60);
    expect(Math.hypot(bern.x - zurich.x, bern.y - zurich.y)).toBeLessThan(400);
    expect(labels.map((l) => l.text)).toContain("SWITZERLAND");
    expect(labels.map((l) => l.text)).not.toContain(" CHE ");
  });

  it("Mercator'un dışında kalan işaret ve rota çizilmez; etiketsiz rota etiket üretmez", async () => {
    const map = await generateMap(
      MapSpec.parse({
        markers: [
          { lon: 28.98, lat: 41.01, label: "İstanbul" },
          { lon: 32.85, lat: 39.93, label: "Ankara" },
          { lon: 30, lat: 89, label: "Kutup" },
        ],
        routes: [
          { points: [{ lon: 0, lat: 88 }, { lon: 40, lat: 88.5 }], label: "Kuzey" },
          { points: [{ lon: 28.98, lat: 41.01 }, { lon: 32.85, lat: 39.93 }] },
        ],
      }),
      "tr",
      palette,
    );
    const texts = map.meta.labels!.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(["İstanbul", "Ankara"]));
    expect(texts).not.toContain("Kutup");
    expect(texts).not.toContain("Kuzey");
    expect(map.svg).not.toContain('id="route-0"');
    expect(map.svg).toContain('id="route-1"');
    expect(map.meta.routes).toBe(2);
  });

  it("tarihî bayrak kimlikleri listelenir", () => {
    expect(flagCodes()).toEqual(["ottoman"]);
  });
});
