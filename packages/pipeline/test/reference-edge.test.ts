import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { findReferences, findVectorSources, searchQuery, titleMatch } from "../src/reference.ts";

/*
 * Wikimedia istekleri modül düzeyinde sıraya girer (en az 400 ms aralık, 429'da bekleme). Testler gerçek beklemesin
 * diye setTimeout ve Date sahte; vaat bitene kadar sahte saat ilerletilir (dosya/sharp G/Ç'si gerçek kalır).
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function drive<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    await vi.advanceTimersByTimeAsync(1000);
    await new Promise((r) => setImmediate(r));
  }
  return p;
}

const tempStore = (): AssetStore => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-refe-")));
const png = async () => new Uint8Array(await sharp({ create: { width: 20, height: 10, channels: 3, background: "#36c" } }).png().toBuffer());
const indexKey = async (store: AssetStore, prefix: string) => (await store.list(prefix)).filter((k) => k.endsWith("index.json"));

type Route = (url: string) => Response | Promise<Response>;
function fakeFetch(route: Route) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return route(url);
  }) as typeof fetch;
  return { fn, calls };
}

const wiki = (pages: unknown) => Response.json({ query: { pages } });

describe("referans arama: Wikimedia sırası", () => {
  it("429'da Retry-After kadar (en çok 10 sn, yoksa 3 sn) bekleyip bir kez yeniden dener", async () => {
    const delays = vi.spyOn(globalThis, "setTimeout");
    let n = 0;
    const { fn, calls } = fakeFetch((url) => {
      if (!url.includes("wikipedia")) return wiki({});
      n++;
      if (n === 1) return new Response("", { status: 429, headers: { "retry-after": "60" } });
      if (n === 3) return new Response("", { status: 429 });
      return wiki({});
    });
    expect((await drive(findReferences("Kız Kulesi", { store: tempStore(), fetch: fn }))).images).toEqual([]);
    expect(delays.mock.calls.map(([, ms]) => ms)).toContain(10_000);
    delays.mockClear();
    await drive(findReferences("Rumeli Hisarı", { store: tempStore(), fetch: fn }));
    expect(delays.mock.calls.map(([, ms]) => ms)).toContain(3_000);
    expect(delays.mock.calls.map(([, ms]) => ms)).not.toContain(10_000);
    expect(calls.filter((u) => u.includes("wikipedia"))).toHaveLength(4);
  });

  it("üst üste 429 ve 5xx geçici hatadır: günlüğe yazılır, sonuç önbelleğe yazılmaz", async () => {
    const store = tempStore();
    const logs: string[] = [];
    const { fn, calls } = fakeFetch((url) => (url.includes("wikipedia") ? new Response("", { status: 429 }) : new Response("", { status: 503 })));
    const r = await drive(findReferences("Galata", { store, fetch: fn, log: (m) => logs.push(m) }));
    expect(r).toEqual({ images: [], sources: [], keys: [] });
    expect(calls.filter((u) => u.includes("wikipedia"))).toHaveLength(2);
    expect(logs).toEqual(["  referans araması başarısız (wikipediaLead): HTTP 429", "  referans araması başarısız (commonsSearch): HTTP 503"]);
    expect(await indexKey(store, "library/reference/")).toEqual([]);
  });

  it("Error olmayan fırlatma da günlüğe yazılır; 404 'sonuç yok' sayılıp önbelleğe yazılır", async () => {
    const logs: string[] = [];
    const thrower = (async () => {
      throw "kapalı";
    }) as unknown as typeof fetch;
    await drive(findReferences("x", { store: tempStore(), fetch: thrower, log: (m) => logs.push(m) }));
    expect(logs[0]).toBe("  referans araması başarısız (wikipediaLead): kapalı");

    const store = tempStore();
    const { fn } = fakeFetch(() => new Response("", { status: 404 }));
    await drive(findReferences("Yok böyle bir şey", { store, fetch: fn }));
    expect(await indexKey(store, "library/reference/")).toHaveLength(1);
  });

  it("fetch verilmezse küresel fetch kullanılır", async () => {
    const { fn, calls } = fakeFetch(() => wiki({}));
    vi.stubGlobal("fetch", fn);
    await drive(findReferences("Topkapı", { store: tempStore() }));
    expect(calls).toHaveLength(2);
  });
});

describe("referans arama: adaylar", () => {
  it("sırasız sayfalar, eksik alanlar ve en çok 3 görsel; tam adresi olmayan Wikipedia sayfasının adresi kurulur", async () => {
    const image = await png();
    const { fn, calls } = fakeFetch((url) => {
      if (url.includes("wikipedia")) {
        return wiki({
          a: { title: "Galata Tower", thumbnail: { source: "https://img/galata.jpg" } },
          b: { title: "!!", thumbnail: { source: "https://img/bos.jpg" } },
          c: { title: "Tower Galata history", thumbnail: { source: "https://img/tarih.jpg" } },
        });
      }
      if (url.includes("commons")) {
        return wiki({
          c: { index: 2, title: "File:B.png", imageinfo: [{ thumburl: "https://img/b.png", mime: "image/png" }] },
          d: { index: 1, title: "File:A.jpg", imageinfo: [{ thumburl: "https://img/a.jpg", mime: "image/jpeg", descriptionurl: "https://c/A" }] },
          e: { title: "File:NoMime", imageinfo: [{ thumburl: "https://img/n.jpg" }] },
          f: { index: 3, title: "File:C.jpg", imageinfo: [{ thumburl: "https://img/c.jpg", mime: "image/jpeg" }] },
          g: { index: 4, title: "File:D.jpg", imageinfo: [{ thumburl: "https://img/d.jpg", mime: "image/jpeg" }] },
        });
      }
      return new Response(image);
    });
    const r = await drive(findReferences("Galata Tower", { store: tempStore(), fetch: fn }));
    expect(r.sources).toEqual([
      { title: "Galata Tower", url: "https://en.wikipedia.org/wiki/Galata%20Tower", license: undefined },
      { title: "A.jpg", url: "https://c/A", license: undefined },
      { title: "B.png", url: "https://img/b.png", license: undefined },
    ]);
    expect(calls.some((u) => u.endsWith("/c.jpg"))).toBe(false);
  });

  it("indirme: 404 atlanır, 5xx ve bozuk görsel önbelleği engeller", async () => {
    const store = tempStore();
    const logs: string[] = [];
    const commons = (names: string[]) => wiki(Object.fromEntries(names.map((n, i) => [n, { index: i, title: `File:${n}`, imageinfo: [{ thumburl: `https://img/${n}`, mime: "image/jpeg" }] }])));
    const { fn } = fakeFetch(async (url) => {
      if (url.includes("wikipedia")) return wiki(undefined);
      if (url.includes("commons")) return commons(["yok.jpg", "bozuk.jpg", "atar.jpg", "iyi.jpg"]);
      if (url.endsWith("yok.jpg")) return new Response("", { status: 404 });
      if (url.endsWith("bozuk.jpg")) return new Response("png değil");
      if (url.endsWith("atar.jpg")) throw "bağlantı koptu";
      return new Response(await png());
    });
    const r = await drive(findReferences("Kule", { store, fetch: fn, log: (m) => logs.push(m) }));
    expect(r.sources.map((s) => s.title)).toEqual(["iyi.jpg"]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/^ {2}referans indirilemedi \(bozuk\.jpg\): /);
    expect(logs[1]).toBe("  referans indirilemedi (atar.jpg): bağlantı koptu");
    expect(await indexKey(store, "library/reference/")).toEqual([]);

    const store2 = tempStore();
    const { fn: fn2 } = fakeFetch((url) => (url.includes("commons") ? commons(["a.jpg"]) : url.includes("wikipedia") ? wiki({}) : new Response("", { status: 500 })));
    expect((await drive(findReferences("Kule", { store: store2, fetch: fn2 }))).images).toEqual([]);
    expect(await indexKey(store2, "library/reference/")).toEqual([]);
  });

  it("önbellekte olup depodan silinmiş görsel atlanır", async () => {
    const store = tempStore();
    const { fn } = fakeFetch(async (url) =>
      url.includes("commons") ? wiki({ a: { title: "File:A.jpg", imageinfo: [{ thumburl: "https://img/a.jpg", mime: "image/jpeg" }] } }) : url.includes("wikipedia") ? wiki({}) : new Response(await png()),
    );
    const first = await drive(findReferences("Saat", { store, fetch: fn }));
    expect(first.keys).toHaveLength(1);
    const [idx] = await indexKey(store, "library/reference/");
    const cached = (await getJson<{ keys: string[] }>(store, idx!))!;
    await putJson(store, idx!, { ...cached, keys: [...cached.keys, "library/reference/silinmis.jpg"] });
    const again = await findReferences("saat", { store, fetch: fn });
    expect(again.images).toHaveLength(1);
    expect(again.keys).toHaveLength(2);
  });

  it("başlık eşleşmesi: kelimesiz başlık 0; sorgu tarifin baş kısmından", () => {
    expect(titleMatch("!!", "galata")).toBe(0);
    expect(searchQuery("(no subject)")).toBe("");
  });
});

describe("hazır SVG: kenar durumlar", () => {
  const svgOk = '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#000"/></svg>';
  const page = (title: string, info: Record<string, unknown>, index?: number) => ({ title: `File:${title}`, index, imageinfo: [info] });
  const info = (title: string, extra: Record<string, unknown> = {}) => ({
    url: `https://x/${title}`,
    mime: "image/svg+xml",
    extmetadata: { LicenseShortName: { value: "CC0" } },
    ...extra,
  });

  it("lisanssız, boyutu bilinmeyen, büyük ve eleman sayısı aşan çizimler; açıklama adresi yoksa dosya adresi", async () => {
    const store = tempStore();
    const many = `<svg viewBox="0 0 10 10">${'<rect width="1" height="1"/>'.repeat(700)}</svg>`;
    const pages = {
      1: page("Horse a.svg", info("Horse a.svg", { extmetadata: undefined }), 1),
      2: page("Horse big.svg", info("Horse big.svg", { size: 400_000 }), 2),
      3: page("Horse many.svg", info("Horse many.svg"), 3),
      4: page("Horse ok.svg", info("Horse ok.svg"), 4),
      5: page("Horse ek.svg", info("Horse ek.svg"), 5),
      6: { title: "File:Horse bos.svg", index: 0 },
    };
    const { fn } = fakeFetch((url) => (url.includes("api.php") ? wiki(pages) : new Response(url.endsWith("many.svg") ? many : svgOk)));
    const found = await drive(findVectorSources("horse", { store, fetch: fn }, 1));
    expect(found.map((f) => f.source)).toEqual([{ title: "Horse ok.svg", url: "https://x/Horse ok.svg", license: "CC0" }]);
    expect(await indexKey(store, "library/vector-source/")).toHaveLength(1);
  });

  it("indirme 404 atlanır; 5xx, ağ hatası ve arama hatası önbelleğe yazdırmaz; bozuk SVG yalnız atlanır", async () => {
    const pages = {
      1: page("Cart 404.svg", info("Cart 404.svg"), 1),
      2: page("Cart text.svg", info("Cart text.svg"), 2),
      3: page("Cart nobox.svg", info("Cart nobox.svg"), 3),
      4: page("Cart ok.svg", info("Cart ok.svg", { descriptionurl: "https://c/ok" }), 4),
    };
    const store = tempStore();
    const { fn } = fakeFetch((url) => {
      if (url.includes("api.php")) return wiki(pages);
      if (url.endsWith("404.svg")) return new Response("", { status: 404 });
      if (url.endsWith("text.svg")) return new Response("svg değil");
      if (url.endsWith("nobox.svg")) return new Response("<svg><rect/></svg>");
      return new Response(svgOk);
    });
    const found = await drive(findVectorSources("cart", { store, fetch: fn }, 5));
    expect(found.map((f) => f.source.url)).toEqual(["https://c/ok"]);
    expect(await indexKey(store, "library/vector-source/")).toHaveLength(1);

    for (const failure of [() => new Response("", { status: 502 }), () => Promise.reject(new Error("ağ"))]) {
      const s = tempStore();
      const { fn: f } = fakeFetch((url) => (url.includes("api.php") ? wiki({ 1: page("Cart ok.svg", info("Cart ok.svg"), 1) }) : failure()));
      expect(await drive(findVectorSources("cart", { store: s, fetch: f }))).toEqual([]);
      expect(await indexKey(s, "library/vector-source/")).toEqual([]);
    }

    const logs: string[] = [];
    for (const thrown of [new Error("HTTP 503"), "kapalı"]) {
      const s = tempStore();
      const bad = (async () => {
        throw thrown;
      }) as unknown as typeof fetch;
      expect(await drive(findVectorSources("cart", { store: s, fetch: bad, log: (m) => logs.push(m) }))).toEqual([]);
      expect(await indexKey(s, "library/vector-source/")).toEqual([]);
    }
    expect(logs).toEqual(["  hazır SVG araması başarısız: HTTP 503", "  hazır SVG araması başarısız: kapalı"]);
  });

  it("önbellekten okur, depodan silinmiş dosyayı atlar; fetch verilmezse küresel fetch", async () => {
    const store = tempStore();
    const { fn, calls } = fakeFetch((url) => (url.includes("api.php") ? wiki({ 1: page("Lamp.svg", info("Lamp.svg"), 1) }) : new Response(svgOk)));
    vi.stubGlobal("fetch", fn);
    const first = await drive(findVectorSources("lamp", { store }));
    expect(first).toHaveLength(1);
    const [idx] = await indexKey(store, "library/vector-source/");
    const cached = (await getJson<{ items: { key: string; source: unknown }[] }>(store, idx!))!;
    await putJson(store, idx!, { items: [...cached.items, { key: "library/vector-source/silinmis.svg", source: { title: "x", url: "y" } }] });
    const before = calls.length;
    const again = await findVectorSources("lamp ", { store });
    expect(calls.length).toBe(before);
    expect(again).toEqual(first);
  });
});
