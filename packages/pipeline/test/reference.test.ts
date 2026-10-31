import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FsAssetStore } from "@ys/storage";
import { findReferences, rasterizeSvg, searchQuery, titleMatch } from "../src/reference.ts";

const png = async () => new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } }).png().toBuffer());

/** Wikipedia + Commons yanıtlarını taklit eder; kaç istek yapıldığını sayar. */
function fakeFetch() {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("en.wikipedia.org")) {
      return Response.json({
        query: {
          pages: {
            "1": { index: 1, title: "Runic inscriptions in Hagia Sophia", thumbnail: { source: "https://img/runes.jpg" } },
            "2": { index: 2, title: "Hagia Sophia", fullurl: "https://en.wikipedia.org/wiki/Hagia_Sophia", thumbnail: { source: "https://img/960px-Hagia.jpg" } },
          },
        },
      });
    }
    if (url.includes("commons.wikimedia.org")) {
      return Response.json({
        query: {
          pages: {
            "3": { index: 1, title: "File:Hagia.jpg", imageinfo: [{ thumburl: "https://img/Hagia.jpg", mime: "image/jpeg", descriptionurl: "https://c/Hagia", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } } }] },
            "4": { index: 2, title: "File:Plan.svg", imageinfo: [{ thumburl: "https://img/plan.png", mime: "image/svg+xml" }] },
            "5": { index: 3, title: "File:Dome.jpg", imageinfo: [{ thumburl: "https://img/dome.jpg", mime: "image/jpeg", descriptionurl: "https://c/Dome" }] },
          },
        },
      });
    }
    return new Response(await png(), { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  return { fn, calls };
}

describe("referans görsel arama", () => {
  it("başlık eşleşmesi: yan konu değil, öznenin kendi sayfası", () => {
    expect(titleMatch("Hagia Sophia", "Hagia Sophia exterior")).toBe(1);
    expect(titleMatch("Runic inscriptions in Hagia Sophia", "Hagia Sophia exterior")).toBeLessThan(0.6);
  });

  it("Wikipedia'nın doğru sayfasını ve Commons fotoğraflarını alır; aynı dosyayı ve SVG çizimleri atlar; önbelleğe yazar", async () => {
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-ref-")));
    const { fn, calls } = fakeFetch();
    const r = await findReferences("Hagia Sophia exterior", { store, fetch: fn });
    expect(r.sources.map((s) => s.title)).toEqual(["Hagia Sophia", "Dome.jpg"]);
    expect(r.images.every((i) => i.mimeType === "image/jpeg")).toBe(true);
    expect(calls.some((u) => u.includes("runes"))).toBe(false);

    const before = calls.length;
    const again = await findReferences("hagia sophia exterior ", { store, fetch: fn });
    expect(calls.length).toBe(before);
    expect(again.sources).toEqual(r.sources);
    expect(again.images).toHaveLength(2);
  });

  it("ağ hatası üretimi durdurmaz: boş referans döner", async () => {
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-ref-")));
    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const r = await findReferences("Intel C4004", { store, fetch: failing });
    expect(r.images).toEqual([]);
  });

  it("SVG çizimi denetim için PNG'ye çevrilir", async () => {
    const img = await rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#0a0"/></svg>');
    expect(img.mimeType).toBe("image/png");
    expect((await sharp(Buffer.from(img.data)).metadata()).width).toBe(768);
  });
});

describe("nesne tarifinden arama sorgusu", () => {
  it("tarifin baş kısmı, en çok 5 kelime", () => {
    expect(searchQuery("Wooden laboratory workbench with beakers and flasks on top, front view, no text")).toBe("wooden laboratory workbench");
    expect(searchQuery("A brown horse standing, side view")).toBe("brown horse standing");
  });
});

describe("hazır SVG (Commons)", () => {
  it("yalnız serbest lisanslı, konuyla ilgili, nesne çizimi olan dosyalar alınır", async () => {
    const { findVectorSources } = await import("../src/reference.ts");
    const { FsAssetStore } = await import("@ys/storage");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const page = (title: string, license: string, mime = "image/svg+xml") => ({
      title: `File:${title}`,
      imageinfo: [{ url: `https://x/${title}`, descriptionurl: `https://c/${title}`, mime, size: 1000, extmetadata: { LicenseShortName: { value: license } } }],
    });
    const pages = {
      1: { ...page("Steam locomotive diagram.svg", "Public domain"), index: 1 },
      2: { ...page("Steam locomotive (Fornari 1903).svg", "Public domain"), index: 2 },
      3: { ...page("Steam locomotive.svg", "CC BY-SA 4.0"), index: 3 },
      4: { ...page("Bicycle.svg", "CC0"), index: 4 },
    };
    const fetchFn = (async (url: string) =>
      url.includes("api.php")
        ? new Response(JSON.stringify({ query: { pages } }))
        : new Response('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#000"/></svg>')) as typeof fetch;
    const found = await findVectorSources("steam locomotive", { store: new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-vs-"))), fetch: fetchFn });
    expect(found.map((f) => f.source.title)).toEqual(["Steam locomotive (Fornari 1903).svg"]);
  });
});

describe("arama sorgusu: kesilen sorgunun sonundaki işlev sözcükleri", () => {
  it("5 kelimede kesilince sondaki edat/bağlaç atılır; tek kelime kalırsa korunur", () => {
    expect(searchQuery("flat perforated build platform on the printer bed")).toBe("flat perforated build platform");
    expect(searchQuery("small pile of white plastic shavings")).toBe("small pile of white plastic");
    expect(searchQuery("stack of old letters and envelopes")).toBe("stack of old letters");
    expect(searchQuery("on")).toBe("on");
  });
});
