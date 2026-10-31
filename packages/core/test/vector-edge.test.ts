import { describe, expect, it } from "vitest";
import { applyLineStyle, bumpVersion, compareVersions, formatUsd, sanitizeSvg, Shot, stripBackdrop, toDollars, usd } from "../src/index.ts";

describe("SVG temizleyici: kenar durumlar", () => {
  it("iç başvuru olmayan href atılır, #id kalır", () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><use href="https://evil.example/a.svg#x"/><use xlink:href="#ok"/></svg>')).toBe(
      '<svg viewBox="0 0 1 1"><use/><use xlink:href="#ok"/></svg>',
    );
  });

  it("değersiz öznitelik okunur ama izin listesinde değilse atılır", () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><rect hidden fill=red/></svg>')).toBe('<svg viewBox="0 0 1 1"><rect fill="red"/></svg>');
  });

  it("temizlik sonrası kök <svg> bozulmuşsa reddeder", () => {
    expect(() => sanitizeSvg("<svg foo/></svg>")).toThrow("SVG bulunamadı");
    expect(() => sanitizeSvg("svg yok")).toThrow("SVG bulunamadı");
  });
});

describe("stripBackdrop: kenar durumlar", () => {
  const size = { width: 400, height: 800 };

  it("<svg> ile başlamayan girdiye dokunmaz", () => {
    expect(stripBackdrop("<g/>", size)).toBe("<g/>");
  });

  it("yüzdeli tam dikdörtgen ve büyük elips atılır; ince gölge kalır, ilk gerçek parçada durur", () => {
    const svg =
      '<svg viewBox="0 0 400 800"><rect width="100%" height="100%"/><ellipse rx="200" ry="300"/>' +
      '<ellipse rx="90" ry="10"/><ellipse rx="50" ry="100"/><rect width="400" height="800"/></svg>';
    expect(stripBackdrop(svg, size)).toBe('<svg viewBox="0 0 400 800"><ellipse rx="90" ry="10"/><ellipse rx="50" ry="100"/><rect width="400" height="800"/></svg>');
  });

  it("öznitelikleri eksik şekiller zemin sayılmaz", () => {
    const svg = '<svg viewBox="0 0 400 800"><circle/><g/></svg>';
    expect(stripBackdrop(svg, size)).toBe(svg);
    const ellipse = '<svg viewBox="0 0 400 800"><ellipse rx="300"/></svg>';
    // ry yoksa 0: gölge gibi korunur.
    expect(stripBackdrop(ellipse, size)).toBe(ellipse);
    const rect = '<svg viewBox="0 0 400 800"><rect width="400"/></svg>';
    expect(stripBackdrop(rect, size)).toBe(rect);
  });

  it("en çok dört üst düzey öğeye bakar", () => {
    const shadow = '<ellipse rx="10" ry="5"/>';
    const svg = `<svg viewBox="0 0 400 800">${shadow.repeat(4)}<rect width="400" height="800"/></svg>`;
    expect(stripBackdrop(svg, size)).toBe(svg);
  });
});

describe("çizgi stili: kenar durumlar", () => {
  it("adlı koyu renkler de koyu sayılır, diğer adlar sayılmaz", () => {
    expect(applyLineStyle('<svg><path stroke="black"/><path stroke="red"/></svg>', "outline")).toBe('<svg><path stroke="#1d1a24"/><path stroke="red"/></svg>');
  });

  it("kontursuz ya da stroke=none öğeye ve gruplara dokunmaz (iç içe gruplar)", () => {
    const svg = '<svg><g><g/><path fill="#000"/><rect stroke="none"/></g></svg>';
    expect(applyLineStyle(svg, "ink")).toBe(svg);
  });

  it("düz stilde stroke=none grubun içindeki çizgi üst grubun konturunu miras almaz", () => {
    const svg = '<svg><g stroke="#000" stroke-width="3"><g stroke="none"><path d="M0" fill="none"/></g></g></svg>';
    expect(applyLineStyle(svg, "flat")).toBe('<svg><g><g stroke="none"><path d="M0" fill="none"/></g></g></svg>');
  });
});

describe("para ve sürüm", () => {
  it("mikro-dolar biçimlenir: 1 doların altı 4, üstü 2 basamak", () => {
    expect(toDollars(usd(2.5))).toBe(2.5);
    expect(formatUsd(usd(0.0123))).toBe("$0.0123");
    expect(formatUsd(usd(12.345))).toBe("$12.35");
  });

  it("geçersiz sürümler: geçerli olan büyük, ikisi de geçersizse eşit; artırma reddeder", () => {
    expect(compareVersions("1.0.0", "bozuk")).toBe(1);
    expect(compareVersions("x", "y")).toBe(0);
    expect(() => bumpVersion("bozuk", "patch")).toThrow("Geçersiz sürüm: bozuk");
  });
});

describe("çekim şeması", () => {
  const base = { id: "s1", sceneId: "sc", kind: "still_motion", description: "d", startMs: 0, endMs: 1000, minMs: 500, maxMs: 1500 };
  it("bitiş başlangıçtan sonra, en kısa en uzundan kısa olmalı", () => {
    expect(Shot.safeParse(base).success).toBe(true);
    expect(Shot.safeParse({ ...base, startMs: 2000 }).success).toBe(false);
    expect(Shot.safeParse({ ...base, minMs: 2000 }).error?.issues[0]?.message).toBe("minMs <= maxMs olmalı");
  });
});

describe("kapsam: kalan kenar durumlar", () => {
  const size = { width: 400, height: 800 };

  it("stripBackdrop <defs> bloğunu başta tutar; genişliksiz dikdörtgen ve rx'siz elips zemin değildir", () => {
    const svg = '<svg viewBox="0 0 400 800"><defs><linearGradient id="g"/></defs><rect height="800"/></svg>';
    expect(stripBackdrop(svg, size)).toBe(svg);
    const ellipse = '<svg viewBox="0 0 400 800"><ellipse ry="300"/></svg>';
    expect(stripBackdrop(ellipse, size)).toBe(ellipse);
  });

  it("açık-kapalı öğeler ve kendiliğinden kapanan gruplar da işlenir", () => {
    expect(applyLineStyle('<svg><path stroke="#000"></path></svg>', "outline")).toBe('<svg><path stroke="#1d1a24"></path></svg>');
    // Düz stilde kendiliğinden kapanan koyu konturlu grup: kontur silinir, miras yığınına girmez.
    expect(applyLineStyle('<svg><g stroke="#000"/><path d="M0" fill="none"/></svg>', "flat")).toBe('<svg><g/><path d="M0" fill="none"/></svg>');
  });

  it("mürekkep stili var olan uç/köşe biçimini korur", () => {
    expect(applyLineStyle('<svg><path stroke="#000" stroke-linecap="butt" stroke-linejoin="miter"/></svg>', "ink")).toBe(
      '<svg><path stroke="#111014" stroke-linecap="butt" stroke-linejoin="miter"/></svg>',
    );
  });
});
