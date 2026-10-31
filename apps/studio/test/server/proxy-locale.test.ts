import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../../src/proxy.ts";

vi.mock("server-only", () => ({}));
const req = vi.hoisted(() => ({ cookie: undefined as string | undefined, acceptLanguage: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "ys-lang" && req.cookie !== undefined ? { value: req.cookie } : undefined) }),
  headers: async () => ({ get: (name: string) => (name === "accept-language" ? req.acceptLanguage : null) }),
}));

const { getI18n, getLocale } = await import("../../src/lib/locale.ts");

const call = (method: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest("http://localhost:3100/api/episodes", { method, headers: { host: "localhost:3100", ...headers } }));
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy: Stüdyo API'sine yalnız Stüdyo sayfası yazar", () => {
  it("yalnız /api altında çalışır", () => {
    expect(config.matcher).toBe("/api/:path*");
  });

  it("okuma istekleri serbest", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(passed(call(m, { "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("aynı kökenden JSON yazma geçer", () => {
    expect(passed(call("POST", { "sec-fetch-site": "same-origin", origin: "http://localhost:3100", "content-type": "application/json" }))).toBe(true);
    expect(passed(call("PUT", { "sec-fetch-site": "none", "content-type": "application/json; charset=utf-8" }))).toBe(true);
    // Tarayıcı dışı istemci (sec-fetch-site yok, origin yok).
    expect(passed(call("POST", { "content-type": "application/json" }))).toBe(true);
  });

  it("başka siteden ya da başka kökenden yazma 403", async () => {
    const cases: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      { "sec-fetch-site": "same-site", "content-type": "application/json" },
      { origin: "http://evil.example", "content-type": "application/json" },
      { "sec-fetch-site": "same-origin", origin: "http://localhost:9999", "content-type": "application/json" },
      { origin: "bozuk köken", "content-type": "application/json" },
    ];
    for (const h of cases) {
      const res = call("POST", h);
      expect(res.status, JSON.stringify(h)).toBe(403);
      expect(await res.json()).toEqual({ error: "Yalnız Stüdyo sayfasından" });
    }
  });

  it("JSON olmayan gövde 415 (çapraz 'basit' istek ön izinsiz gönderilemesin)", async () => {
    for (const h of [{ "content-type": "text/plain" }, {}] as Record<string, string>[]) {
      const res = call("POST", { "sec-fetch-site": "same-origin", ...h });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "JSON gerekli" });
    }
  });
});

describe("locale", () => {
  beforeEach(() => {
    req.cookie = undefined;
    req.acceptLanguage = null;
  });

  it("seçilen dil çerezden okunur", async () => {
    req.cookie = "en";
    req.acceptLanguage = "tr-TR";
    expect(await getLocale()).toBe("en");
  });

  it("çerez yoksa ya da geçersizse tarayıcı dili", async () => {
    req.acceptLanguage = "tr-TR,tr;q=0.9";
    expect(await getLocale()).toBe("tr");
    req.cookie = "de";
    req.acceptLanguage = null;
    expect(await getLocale()).toBe("en");
  });

  it("getI18n dile göre çevirmen ve biçimlendirici verir", async () => {
    req.cookie = "tr";
    const { locale, t, fmt } = await getI18n();
    expect(locale).toBe("tr");
    expect(t("nav.episodes")).toBe("Bölümler");
    expect(fmt.number(1234)).toBe("1.234");
  });
});
