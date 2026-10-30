import { describe, expect, it } from "vitest";
import { MapSpec, sanitizeSvg } from "@ys/core";
import { toOutputSchema } from "../../agents/src/runner.ts";
import { VectorSceneOut } from "../../agents/src/vector.ts";
import { declutter, generateFlag, generateMap } from "../src/geo.ts";

const palette = ["#1d2433", "#3a4a66", "#c8553d"];

describe("gerçek veriden harita", () => {
  it("ülkeleri vurgular, adları dilin büyük harf kuralıyla yazar, rotayı çizilebilir yol olarak verir", async () => {
    const map = await generateMap(
      MapSpec.parse({
        focus: ["TUR"],
        highlight: [{ countries: ["TUR"] }],
        markers: [{ lon: 28.98, lat: 41.01, label: "İstanbul" }],
        routes: [{ points: [{ lon: 30.18, lat: 40.02 }, { lon: 28.98, lat: 41.01 }], label: "1299–1453" }],
      }),
      "tr",
      palette,
    );
    expect(map.width).toBe(1920);
    // Vurgu rengi paletin orta tonlu doygun rengi (koyu lacivert değil).
    expect(map.svg).toContain('fill="#c8553d"');
    expect(map.meta.labels?.map((l) => l.text)).toEqual(expect.arrayContaining(["TÜRKİYE", "İstanbul", "1299–1453"]));
    expect(map.meta.routes).toBe(1);
    expect(map.meta.exact).toBe(true);
    // Temizleyiciden geçince rota çizim öznitelikleri kalır.
    const clean = sanitizeSvg(map.svg);
    expect(clean).toContain('id="route-0"');
    expect(clean).toContain('pathLength="1"');
  });

  it("bilinmeyen ülke kodu sessizce atlanır, dünya haritası kaba veriyle küçük kalır", async () => {
    const map = await generateMap(MapSpec.parse({ highlight: [{ countries: ["XXX", "FRA"], tone: "cool" }] }), "en", palette);
    expect(map.meta.labels?.some((l) => l.text === "FRANCE" || l.text.includes("FRENCH"))).toBe(true);
    const world = await generateMap(MapSpec.parse({}), "en", palette);
    expect(world.svg.length).toBeLessThan(300_000);
  });

  it("etiketler çakışmayacak şekilde kaydırılır; ülke adı yerinde kalır", () => {
    const out = declutter([
      { x: 500, y: 300, text: "TÜRKİYE", kind: "country", order: 0 },
      { x: 500, y: 300, text: "Bursa", kind: "city", order: 1 },
      { x: 505, y: 302, text: "Söğüt", kind: "city", order: 2 },
    ]);
    expect(out[0]).toMatchObject({ x: 500, y: 300 });
    const [, a, b] = out;
    expect(a!.x !== 500 || a!.y !== 300).toBe(true);
    expect(Math.abs(a!.x - b!.x) + Math.abs(a!.y - b!.y)).toBeGreaterThan(20);
  });
});

describe("gerçek bayrak", () => {
  it("ABD bayrağının yıldızları (marker) temizleyiciden geçer; Osmanlı bayrağı tarihî eşlemeyle gelir", async () => {
    const us = await generateFlag({ code: "us", pole: false });
    expect(sanitizeSvg(us.svg)).toContain("marker-mid");
    const ottoman = await generateFlag({ code: "ottoman", pole: true });
    expect(ottoman.meta).toMatchObject({ exact: true, grounded: true });
    expect((await generateFlag({ code: "TUR", pole: false })).svg).toContain("#e30a17");
  });

  it("bilinmeyen bayrak hata verir (çekimden düşer, uydurma çizilmez)", async () => {
    await expect(generateFlag({ code: "atlantis", pole: false })).rejects.toThrow();
    await expect(generateFlag({ code: "zz", pole: false })).rejects.toThrow(/bulunamadı/);
  });
});

describe("yönetmen şeması", () => {
  it("harita ve bayrak alanlarıyla JSON Schema'ya çevrilir", () => {
    const schema = JSON.stringify(toOutputSchema(VectorSceneOut));
    expect(schema).toContain("routes");
    expect(schema).toContain("pole");
  });
});
