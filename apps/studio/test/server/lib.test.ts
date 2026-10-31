import { describe, expect, it } from "vitest";
import { errorKey } from "../../src/lib/errors.ts";
import { formatters, isLocale, localeFromHeader, translator, type MessageKey } from "../../src/lib/i18n.ts";
import { statusLabel } from "../../src/lib/status.ts";
import { VOICES } from "../../src/lib/voices.ts";

describe("errorKey", () => {
  it("sunucunun Türkçe hatalarını sözlük anahtarına çevirir", () => {
    const cases: [string, MessageKey][] = [
      ["Önce çalışan iş bitmeli", "err.busy"],
      ["Bu bölüm zaten çalışıyor (süreç 12)", "err.busy"],
      ["Önce senaryo üretilmeli", "err.noScript"],
      ["Senaryo onaylandı; düzenlemek için…", "err.scriptLocked"],
      ["Konsept onaylandı; hareket modu…", "err.conceptLocked"],
      ["Video render edildi; ses değiştirmek…", "err.voiceLocked"],
      ["Yeniden çizilecek çekim yok", "err.noShots"],
      ["Kütüphanede onaylı karakter değil: x", "err.notLibrary"],
      ["karakter gerçeklik denetimi kapalıyken geçti", "err.realismOnly"],
      ["Reddedilen çizim depoda yok", "err.rejectedMissing"],
      ["Geçersiz hareket modu", "err.badMotion"],
      ["Bilinmeyen eylem: x", "err.badAction"],
      ["Geçersiz bölüm", "err.badEpisode"],
      ["Bölüm bulunamadı: e1", "err.badEpisode"],
      ["Konu gerekli", "err.topic"],
      ["Süre 0,5–30 dk olmalı", "err.minutes"],
      ["Bütçe pozitif olmalı", "err.budget"],
    ];
    for (const [msg, key] of cases) expect(errorKey(msg), msg).toEqual({ key, vars: {} });
  });

  it("değişkenli mesajın parçalarını taşır; tanınmayanı undefined döner", () => {
    expect(errorKey("Seçim yapılmamış: c1, l2")).toEqual({ key: "err.missingSelection", vars: { items: "c1, l2" } });
    expect(errorKey("tamamen başka bir hata")).toBeUndefined();
  });
});

describe("statusLabel", () => {
  const t = translator("tr");
  it("bitmiş, boşta ya da aşamasız durumda yalnız temel metin", () => {
    expect(statusLabel(t, { status: "done", stage: "render" })).toBe("Tamamlandı");
    expect(statusLabel(t, { status: "idle", stage: "voice" })).toBe("Beklemede");
    expect(statusLabel(t, { status: "running" })).toBe("Çalışıyor");
  });
  it("bekleme onaylanacak kapıyı, diğerleri aşamayı söyler", () => {
    expect(statusLabel(t, { status: "waiting", stage: "voice" })).toBe("Onay bekliyor · Konsept");
    expect(statusLabel(t, { status: "waiting", stage: "cast" })).toBe("Onay bekliyor · Senaryo");
    expect(statusLabel(t, { status: "running", stage: "keyframes" })).toBe("Çalışıyor · Kareler");
    expect(statusLabel(translator("en"), { status: "stalled", stage: "style" })).toBe("Stalled · Style");
  });
});

describe("i18n", () => {
  it("her sesin iki dilde etiketi var; Gemini boş kimlikli", () => {
    for (const v of VOICES) {
      expect(translator("tr")(v.label)).not.toBe(v.label);
      expect(translator("en")(v.label)).not.toBe(v.label);
    }
    expect(VOICES.find((v) => v.id === "")?.label).toBe("voice.gemini");
  });

  it("çevirmen değişkenleri doldurur, eksik değişkeni ve bilinmeyen anahtarı olduğu gibi bırakır", () => {
    const t = translator("tr");
    expect(t("ago.sec", { n: 5 })).toBe("5 sn önce");
    expect(t("ago.sec", {})).toBe("{n} sn önce");
    expect(t("ago.now")).toBe("az önce");
    expect(t("yok.boyle.anahtar" as MessageKey)).toBe("yok.boyle.anahtar");
  });

  it("isLocale ve Accept-Language", () => {
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(localeFromHeader("en-US,tr;q=0.8")).toBe("tr");
    expect(localeFromHeader("TR")).toBe("tr");
    expect(localeFromHeader("de-DE, en")).toBe("en");
    expect(localeFromHeader("ru,trk")).toBe("en");
    expect(localeFromHeader(null)).toBe("en");
    expect(localeFromHeader(undefined)).toBe("en");
  });

  it("para her dilde $ ile, kademeli hassasiyetle", () => {
    const { usd } = formatters("tr");
    expect(usd(0)).toBe("$0");
    expect(usd(0.0042)).toBe("$0.0042");
    expect(usd(3.456)).toBe("$3.46");
    expect(usd(12345.6)).toBe("$12,346");
  });

  it("süre saniye, dakika ve saat olarak; tanımsız ya da sonsuz '—'", () => {
    const tr = formatters("tr").duration;
    expect(tr(undefined)).toBe("—");
    expect(tr(Number.NaN)).toBe("—");
    expect(tr(42.4)).toBe("42 sn");
    expect(tr(120)).toBe("2 dk");
    expect(tr(125)).toBe("2 dk 5 sn");
    expect(tr(7200)).toBe("2 sa");
    expect(tr(7260)).toBe("2 sa 1 dk");
    expect(formatters("en").duration(90)).toBe("1 min 30 s");
  });

  it("sayı ve tarih dile göre biçimlenir", () => {
    expect(formatters("tr").number(1234567.4)).toBe("1.234.567");
    expect(formatters("en").number(1234567.4)).toBe("1,234,567");
    const iso = "2026-10-31T10:20:30Z";
    const d = new Date(iso);
    expect(formatters("en").date(iso)).toBe(d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
    expect(formatters("tr").day(iso)).toBe(d.toLocaleDateString("tr-TR"));
    expect(formatters("en").time(iso)).toBe(d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  });

  it("göreli zaman: az önce, sn, dk, sa, gün; gelecek tarih 'az önce'", () => {
    const { ago } = formatters("tr");
    const now = Date.parse("2026-10-31T12:00:00Z");
    const before = (s: number) => new Date(now - s * 1000).toISOString();
    expect(ago(before(2), now)).toBe("az önce");
    expect(ago(before(-60), now)).toBe("az önce");
    expect(ago(before(30), now)).toBe("30 sn önce");
    expect(ago(before(150), now)).toBe("2 dk önce");
    expect(ago(before(7300), now)).toBe("2 sa önce");
    expect(ago(before(3 * 86400 + 5), now)).toBe("3 gün önce");
    // Varsayılan "şimdi" Date.now().
    expect(ago(new Date().toISOString())).toBe("az önce");
  });
});
