import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { msg, type Text } from "@ys/core/messages";
import { QUALITY_GATE } from "@ys/core/rules";
import type { CostEntry, ProviderAdapter, Quota } from "@ys/media-gateway";
import { saveLessons, saveModelSettings, type EpisodeInput, type EpisodeState } from "@ys/pipeline/light";
import { FsAssetStore, putJson, type AssetStore } from "@ys/storage";
import { translator } from "../../src/lib/i18n.ts";
import { fakeProvider } from "./fakes.ts";

/**
 * Sunucu bileşenleri: sayfa fonksiyonu çağrılır, dönen JSX statik HTML'e çevrilir. Veri katmanı (lib/server) bellekte
 * sahtedir; istemci bileşenleri (başka testlerin konusu) aldıkları özellikleri gösteren taslaklarla değiştirilir.
 */

const fake = vi.hoisted(() => ({
  episodes: [] as EpisodeState[],
  entries: [] as CostEntry[],
  providers: [] as ProviderAdapter[],
  skipped: [] as Text[],
  quotas: new Map<string, Quota | Error>(),
  store: undefined as unknown as AssetStore,
  cookie: "tr" as string | undefined,
  job: undefined as { status: string; log: string[] } | undefined,
  update: { current: "1.2.3", available: false } as { current: string; available: boolean; latest?: { version: string; url: string; publishedAt: string } },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (fake.cookie ? { value: fake.cookie } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("../../src/lib/server", () => ({
  repo: () => ({
    list: async () => fake.episodes,
    load: async (id: string) => {
      const e = fake.episodes.find((x) => x.id === id);
      if (!e) throw new Error(`Bölüm bulunamadı: ${id}`);
      return e;
    },
  }),
  ledgerEntries: async () => fake.entries,
  catalog: () => ({ providers: fake.providers, skipped: fake.skipped }),
  quotaOf: async (id: string) => {
    const q = fake.quotas.get(id);
    if (q instanceof Error) throw q;
    return q;
  },
  store: () => fake.store,
  getJob: () => fake.job,
}));
vi.mock("../../src/lib/update", () => ({ updateInfo: async () => fake.update }));
vi.mock("../../src/app/new-episode-form", () => ({
  NewEpisodeForm: ({ series, initialSeries, bank }: { series: { name: string }[]; initialSeries?: string; bank: { name: string }[] }) => (
    <div data-form={series.map((s) => s.name).join("|")} data-initial={initialSeries ?? ""} data-bank={bank.map((c) => c.name).join("|")} />
  ),
}));
vi.mock("../../src/app/nav-menu", () => ({ NavMenu: () => <nav data-nav="" /> }));
vi.mock("../../src/app/auto-refresh", () => ({ AutoRefresh: ({ everyMs }: { everyMs: number }) => <i data-refresh={everyMs} /> }));
vi.mock("../../src/app/episodes/[id]/parts", () => ({
  Badge: ({ status, children }: { status: string; children: ReactNode }) => <b data-status={status}>{children}</b>,
}));
vi.mock("../../src/app/episodes/[id]/episode-view", () => ({ EpisodeView: ({ id }: { id: string }) => <div data-episode={id} /> }));
vi.mock("../../src/app/characters/character-bank", () => ({
  CharacterBank: ({ initial, series, initialJob }: { initial: { name: string }[]; series: string[]; initialJob: unknown }) => (
    <div data-bank={initial.map((c) => c.name).join("|")} data-series={series.join("|")} data-job={JSON.stringify(initialJob)} />
  ),
}));
vi.mock("../../src/app/models/models-form", () => ({ ModelsForm: ({ initial }: { initial: object }) => <div data-models={JSON.stringify(initial)} /> }));
vi.mock("../../src/app/locale-provider", () => ({
  LocaleProvider: ({ locale, children }: { locale: string; children: ReactNode }) => <div data-locale={locale}>{children}</div>,
  LanguageSwitch: () => <span data-lang-switch="" />,
}));

const Home = (await import("../../src/app/page.tsx")).default;
const CostsPage = (await import("../../src/app/costs/page.tsx")).default;
const PricingPage = (await import("../../src/app/pricing/page.tsx")).default;
const LessonsPage = (await import("../../src/app/lessons/page.tsx")).default;
const RulesPage = (await import("../../src/app/rules/page.tsx")).default;
const ModelsPage = (await import("../../src/app/models/page.tsx")).default;
const CharactersPage = (await import("../../src/app/characters/page.tsx")).default;
const EpisodePage = (await import("../../src/app/episodes/[id]/page.tsx")).default;
const NewEpisodePage = (await import("../../src/app/episodes/new/page.tsx")).default;
const layout = await import("../../src/app/layout.tsx");

const html = async (el: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await el);
/** HTML'den yalnız görünen metin (etiketler atılır, boşluklar sadeleşir). */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const INPUT: EpisodeInput = { topic: "Konu", lang: "tr", targetSec: 120, tier: "economy", aiClipRatio: 0.2, budgetUsd: 5, width: 1920, height: 1080, fps: 30 };
const ep = (id: string, over: Partial<EpisodeState> = {}, input: Partial<EpisodeInput> = {}): EpisodeState =>
  ({ id, createdAt: "2026-10-30T09:00:00.000Z", input: { ...INPUT, ...input }, done: {}, agentCostUsd: 0, ...over }) as EpisodeState;
const entry = (over: Partial<CostEntry>): CostEntry => ({
  at: "2026-10-30T10:00:00Z",
  providerId: "fal:x",
  capability: "t2i",
  estimateMicros: 1_000_000,
  cacheHit: false,
  requestHash: "h",
  ...over,
});
const img = (key: string) => ({ key, mimeType: "image/png" });

beforeEach(() => {
  fake.episodes = [];
  fake.entries = [];
  fake.providers = [];
  fake.skipped = [];
  fake.quotas.clear();
  fake.store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-pages-")));
  fake.cookie = "tr";
  fake.job = undefined;
  fake.update = { current: "1.2.3", available: false };
});

describe("Ana sayfa", () => {
  const all = () => [
    ep("e-calisan", { stats: { style: { startedAt: new Date().toISOString() } }, heartbeatAt: new Date().toISOString(), shots: [{ id: "sh1" }] as EpisodeState["shots"], keyframes: { sh1: img("kf.png") } }, { series: "Osmanlı" }),
    ep("e-video", { story: { title: "Bitmiş Başlık" } as EpisodeState["story"], render: { path: "v.mp4" } as EpisodeState["render"], done: { style: "t", story: "t" }, shots: [{ id: "sh2" }] as EpisodeState["shots"], stills: { sh2: img("still.png") } }, { series: "osmanlı " }),
    ep("e-konsept", { concept: { candidates: {}, selected: { c1: img("konsept.png") } }, shots: [{ id: "sh3" }] as EpisodeState["shots"] }, { motionMode: "vector" }),
    ep("e-bos"),
    ep("e-demo", {}, { topic: "render demo" }),
  ];

  it("filtresiz: seriler, KPI'lar, küçük resimler, aşama çubuğu ve harcama", async () => {
    fake.episodes = all();
    fake.entries = [
      entry({ episodeId: "e-video", estimateMicros: 2_500_000 }),
      entry({ episodeId: "e-video", estimateMicros: 500_000 }),
      entry({ episodeId: "e-video", cacheHit: true }),
      entry({}),
    ];
    const h = await html(Home({ searchParams: Promise.resolve({}) }));
    const t = text(h);
    expect(t).toContain("Bölümler");
    // Seri sayımı büyük/küçük harf ve boşluk duyarsız; demo bölüm sayılmaz.
    expect(h).toContain('href="/?series=Osmanl%C4%B1"');
    expect(t).toMatch(/Tümü 4/);
    expect(t).toMatch(/Osmanlı 2/);
    expect(t).toMatch(/Serisiz 2/);
    expect(t).toMatch(/Bölüm 4 Bitmiş video 1 Toplam harcama \$3\.00 Şu an çalışan 1/);
    expect(h).toContain('data-refresh="4000"');
    expect(h).toContain('src="/api/assets/kf.png"');
    expect(h).toContain('src="/api/assets/still.png"');
    expect(h).toContain('src="/api/assets/konsept.png"');
    expect(h).not.toContain("render demo");
    expect(t).toContain("Bitmiş Başlık");
    expect(h).toContain('data-status="running"');
    expect(t).toContain("Çalışıyor · Stil");
    expect(t).toContain("Vektör");
    expect(t).toContain("2/12 · $3.00");
    expect(h).toContain('href="/episodes/e-video"');
    // Form artık kendi sayfasında; ana sayfada yalnız ona giden düğme var.
    expect(h).not.toContain("data-form");
    expect(h).toContain('href="/episodes/new"');
    expect(h).not.toContain("e-demo");
  });

  it("seri filtresi ve serisizler", async () => {
    fake.episodes = all();
    const series = await html(Home({ searchParams: Promise.resolve({ series: "OSMANLI" }) }));
    expect(text(series)).toContain("Seri: OSMANLI");
    expect(series).toContain('href="/episodes/e-calisan"');
    expect(series).not.toContain('href="/episodes/e-bos"');
    expect(series).toContain('href="/episodes/new?series=OSMANLI"');

    const none = await html(Home({ searchParams: Promise.resolve({ series: "-" }) }));
    expect(text(none)).toContain("Bölümler");
    expect(none).toContain('href="/episodes/e-bos"');
    expect(none).not.toContain('href="/episodes/e-video"');
    expect(none).toContain('href="/episodes/new"');
    expect(none).toContain('data-refresh="30000"');
  });

  it("boş liste: seri gezintisi yok, boş mesajı", async () => {
    fake.episodes = [ep("e-tek")];
    fake.episodes[0]!.input.lang = "en";
    const one = await html(Home({ searchParams: Promise.resolve({}) }));
    expect(one).not.toContain("Serilere göre");
    fake.episodes = [];
    const h = await html(Home({ searchParams: Promise.resolve({}) }));
    expect(text(h)).toContain("Henüz bölüm yok");
  });
});

describe("Maliyetler sayfası", () => {
  it("kayıt yoksa sıfır ve boş tablolar", async () => {
    const t = text(await html(CostsPage()));
    expect(t).toContain("Toplam harcama $0");
    expect(t).toContain("Video dakikası başına —");
    expect(t.match(/Henüz kayıt yok/g)).toHaveLength(3);
  });

  it("sağlayıcı, aşama, bölüm ve gün tabloları; bitmiş videonun dakika maliyeti", async () => {
    const voice = { s1: { durationMs: 60_000 }, s2: { durationMs: 60_000 } } as unknown as EpisodeState["voice"];
    fake.episodes = [
      ep("e-bitmis", { story: { title: "Bitmiş" } as EpisodeState["story"], render: { path: "v" } as EpisodeState["render"], voice }),
      ep("e-yarim", { voice: { s1: { durationMs: 30_000 } } as unknown as EpisodeState["voice"] }),
      ep("e-sessiz", { render: { path: "v" } as EpisodeState["render"] }),
      ep("e-kayitsiz"),
      // Bitmiş ama defterde kaydı olmayan video (ücretsiz): süreye sayılır, maliyete değil.
      ep("e-ucretsiz", { render: { path: "v" } as EpisodeState["render"], voice: { s1: { durationMs: 60_000 } } as unknown as EpisodeState["voice"] }),
      ep("e-demo", { render: { path: "v" } as EpisodeState["render"], voice }, { topic: "render demo" }),
    ];
    fake.entries = [
      entry({ episodeId: "e-bitmis", stage: "voice", providerId: "eleven:v3", capability: "tts", estimateMicros: 3_000_000, durationMs: 4000, units: 812, unitLabel: "karakter" }),
      entry({ episodeId: "e-bitmis", stage: "keyframes", estimateMicros: 1_000_000, units: 1 }),
      entry({ episodeId: "e-yarim", stage: "cli:image", cacheHit: true, at: "2026-10-31T10:00:00Z" }),
      entry({ episodeId: "e-sessiz", estimateMicros: 0, error: "çöktü" }),
      entry({ providerId: "fal:y", estimateMicros: 0, durationMs: 0 }),
    ];
    const h = await html(CostsPage());
    const t = text(h);
    // Önbellekten gelen çağrı ücretsiz ve "ücretli çağrı" sayılmaz; başarısız deneme sayılır.
    expect(t).toContain("Toplam harcama $4.00");
    expect(t).toContain("Ücretli API çağrısı 3 1 önbellekten · 1 hata");
    expect(t).toContain("Bitmiş video 3 dk 2 bölüm");
    // $4 / 3 dk.
    expect(t).toContain("Video dakikası başına $1.33");
    expect(t).toContain("eleven:v3 1 — — 812 karakter 4 sn $3.00");
    expect(t).toContain("Seslendirme");
    // "cli:" aşamaları ve aşamasız kayıt çevrilmeden gösterilir.
    expect(t).toContain("cli:image 0 1 — — $0");
    expect(t).toContain("— 1 — 1 — $0");
    expect(h).toContain('href="/episodes/e-bitmis"');
    expect(t).toContain("Bitmiş video hazır 2 2 dk $4.00 $2.00");
    expect(t).toContain("Konu 0 30 sn $0 —");
    expect(t).toContain("Konu video hazır 0 — $0 —");
    expect(h).not.toContain("e-kayitsiz");
    expect(h).not.toContain("e-ucretsiz");
    expect(t).toContain("2026-10-31");
    expect(h).toContain("text-bad");
  });

  it("İngilizce: defterdeki Türkçe birimler çevrilir, miktar 1 iken tekil", async () => {
    fake.cookie = "en";
    fake.entries = [
      entry({ providerId: "eleven:v3", estimateMicros: 3_000_000, units: 812, unitLabel: "karakter" }),
      entry({ providerId: "img", estimateMicros: 1_000_000, units: 1, unitLabel: "görsel" }),
      entry({ providerId: "img2", estimateMicros: 500_000, units: 148, unitLabel: "görsel" }),
    ];
    const t = text(await html(CostsPage()));
    expect(t).toContain("812 characters");
    expect(t).toContain("1 image ");
    expect(t).toContain("148 images");
  });

  it("sıfır tutarlı tek grupta çubuk genişliği 0", async () => {
    fake.entries = [entry({ estimateMicros: 0, stage: "voice", units: 2 })];
    const h = await html(CostsPage());
    expect(h).toContain("width:0%");
    expect(text(h)).toContain("2 —");
  });
});

describe("Fiyatlar sayfası", () => {
  it("yeteneğe göre gruplar; kota, ölçülen süre, kaynak ve devre dışı sağlayıcılar", async () => {
    fake.providers = [
      fakeProvider({
        id: "eleven:v3",
        capabilities: ["tts", "tts_timestamps"],
        quotaValue: { unit: "chars", used: 100, limit: 1000, plan: "creator" },
        priceSource: { url: "https://elevenlabs.io/pricing", checked: "2026-10-29", note: "Creator planı" },
      }),
      fakeProvider({ id: "gemini:tts", capabilities: ["tts"], quotaValue: { unit: "chars", used: 50, limit: 50 }, priceSource: { url: "https://ai.google.dev/p", checked: "2026-10-01" } }),
      fakeProvider({ id: "bozuk:tts", capabilities: ["tts"], quotaValue: { unit: "chars", used: 0, limit: 1 } }),
      fakeProvider({ id: "comfy:flux", local: true, capabilities: ["t2i"], price: { unit: "free" }, qualityPrior: 0.5 }),
      fakeProvider({ id: "garip", capabilities: [] }),
    ];
    fake.quotas.set("eleven:v3", { unit: "chars", used: 100, limit: 1000, plan: "creator" });
    fake.quotas.set("gemini:tts", { unit: "chars", used: 50, limit: 50 });
    fake.quotas.set("bozuk:tts", new Error("ağ yok"));
    fake.skipped = ["fal:* (FAL_KEY yok)"];
    fake.entries = [entry({ providerId: "eleven:v3", durationMs: 3000 }), entry({ providerId: "eleven:v3", durationMs: 5000 })];
    const h = await html(PricingPage());
    const t = text(h);
    expect(t).toContain("Fiyat kataloğu");
    expect(t).toContain("Seslendirme");
    expect(t).toContain("Metinden görsel");
    expect(t).toContain("cap.—");
    expect(t).toContain("eleven:v3 tts, tts_timestamps $0.1/1000 karakter");
    expect(t).toContain("0.80");
    expect(t).toContain("4 sn (2)");
    expect(h).toContain('title="2 ölçüm"');
    expect(t).toContain("900 / 1.000 karakter · creator");
    expect(t).toContain("elevenlabs.io · 2026-10-29 Creator planı");
    expect(t).toContain("ai.google.dev · 2026-10-01");
    // Kotası dolmuş sağlayıcı kırmızı.
    expect(h).toMatch(/class="text-bad">0 \/ 50 karakter/);
    expect(t).toContain("comfy:flux yerel");
    expect(t).toContain("ücretsiz (yerel)");
    expect(t).toContain("Devre dışı");
    expect(t).toContain("fal:* (FAL_KEY yok)");
  });

  it("İngilizce: fiyat, birim, not ve devre dışı nedenleri", async () => {
    fake.cookie = "en";
    fake.providers = [
      fakeProvider({
        id: "fal:kling",
        capabilities: ["i2v"],
        price: { unit: "per_second", usd: 0.084, minSec: 3, withAudioUsd: 0.126 },
        quotaValue: { unit: "credits", used: 1, limit: 10 },
        priceSource: { url: "https://fal.ai/k", checked: "2026-10-31", note: msg("price.note.kling", { silent: 0.084, audio: 0.126 }) },
      }),
      fakeProvider({ id: "img", capabilities: ["t2i"], price: { unit: "per_output", usd: 0.025 } }),
    ];
    fake.quotas.set("fal:kling", { unit: "credits", used: 1, limit: 10 });
    fake.skipped = [msg("gw.skip.noKey", { scope: "gemini:*", key: "GEMINI_API_KEY" })];
    const t = text(await html(PricingPage()));
    expect(t).toContain("$0.084/s, at least 3 s; with audio $0.126/s");
    expect(t).toContain("$0.025/image");
    expect(t).toContain("9 / 10 credits");
    expect(t).toContain("silent $0.084/s, with audio $0.126/s");
    expect(t).toContain("gemini:* (no GEMINI_API_KEY)");
  });

  it("sağlayıcı ve atlanan yoksa boş sayfa", async () => {
    const t = text(await html(PricingPage()));
    expect(t).toContain("Fiyat kataloğu");
    expect(t).not.toContain("Devre dışı");
  });
});

describe("Dersler sayfası", () => {
  it("ders yoksa boş mesajı", async () => {
    expect(text(await html(LessonsPage()))).toContain("Henüz ders yok");
  });

  it("hedefe göre gruplar; sayıca çok olan, eşitse en yeni önce", async () => {
    const lesson = (target: "director" | "designer" | "script", rule: string, count: number, lastSeen: string) => ({ target, rule, count, firstSeen: lastSeen, lastSeen, episodes: [] });
    await saveLessons(fake.store, {
      lessons: [
        lesson("director", "eski kural", 2, "2026-10-01T00:00:00Z"),
        lesson("director", "yeni kural", 2, "2026-10-20T00:00:00Z"),
        lesson("director", "sık kural", 5, "2026-09-01T00:00:00Z"),
        lesson("script", "senaryo kuralı", 1, "2026-10-02T00:00:00Z"),
      ],
    });
    const h = await html(LessonsPage());
    const t = text(h);
    expect(t).toContain("Yönetmen");
    expect(t).toContain("Senarist");
    expect(t).not.toContain("Tasarımcı");
    expect(t.indexOf("sık kural")).toBeLessThan(t.indexOf("yeni kural"));
    expect(t.indexOf("yeni kural")).toBeLessThan(t.indexOf("eski kural"));
    expect(t).toContain("5 bölümde");
    expect(t).not.toContain("Henüz ders yok");
  });
});

describe("Kurallar sayfası", () => {
  it("eşikleri koddaki sabitlerden okur", async () => {
    fake.cookie = "en";
    const t = text(await html(RulesPage()));
    expect(t).toContain("Studio rules");
    expect(t).toContain(`recognisability at least ${QUALITY_GATE.recognizableMin.character} for characters`);
    expect(t).toContain(`at most ${QUALITY_GATE.maxDraws} draws`);
    expect(t).not.toMatch(/\{\w+\}/);
  });
});

/** Kütüphaneye onaylı karakter yazar (paketli ya da paketsiz). */
async function libraryCharacter(id: string, name: string, pack?: string) {
  const key = `library/vector/character/${id.padEnd(32, "0")}.svg`;
  await fake.store.put(key, new TextEncoder().encode("<svg/>"), "image/svg+xml");
  await putJson(fake.store, `${key}.json`, {
    check: { kind: "character", name, recognizable: 9, passed: true, defects: [], attempts: 1, sources: [], refs: [] },
    identity: { name, description: "", pack, artStyle: "a", lineStyle: "outline", episodes: [] },
  });
}

describe("Karakterler sayfası", () => {
  it("bankadaki karakterleri, serileri ve banka işini bileşene verir", async () => {
    await libraryCharacter("a", "Ada", "flat-explainer");
    fake.episodes = [ep("e1", {}, { series: "Bilim" })];
    fake.job = { status: "running", log: [] };
    const h = await html(CharactersPage());
    expect(h).toContain('data-bank="Ada"');
    expect(h).toContain('data-series="Bilim"');
    expect(h).toContain("&quot;running&quot;");
    expect(text(h)).toContain(translator("tr")("bank.title"));
    fake.job = undefined;
    expect(await html(CharactersPage())).toContain('data-job="null"');
  });

  it("yeni bölüm formuna yalnız paketli (seçilebilir) karakterler gider", async () => {
    await libraryCharacter("a", "Ada", "flat-explainer");
    await libraryCharacter("b", "Özel");
    await libraryCharacter("c", "Eski paket", "kaldirilmis-paket");
    expect(await html(NewEpisodePage({ searchParams: Promise.resolve({}) }))).toContain('data-bank="Ada"');
  });
});

describe("Modeller sayfası", () => {
  it("kayıtlı seçimleri forma verir", async () => {
    await saveModelSettings(fake.store, { screenwriter: "claude-haiku-5-5" });
    const h = await html(ModelsPage());
    expect(h).toContain(`data-models="{&quot;screenwriter&quot;:&quot;claude-haiku-5-5&quot;}"`);
    expect(text(h)).toContain(translator("tr")("models.title"));
  });
});

describe("Yeni bölüm sayfası", () => {
  it("başlık, geri bağlantısı, seriler (demo hariç) ve adresteki seri", async () => {
    fake.episodes = [ep("e1", {}, { series: "Osmanlı" }), ep("e2", {}, { series: "Demo", topic: "render demo" })];
    const h = await html(NewEpisodePage({ searchParams: Promise.resolve({ series: "Osmanlı" }) }));
    expect(text(h)).toContain("Yeni bölüm");
    expect(text(h)).toContain("Bölümlere dön");
    expect(h).toContain('href="/"');
    expect(h).toContain('data-form="Osmanlı"');
    expect(h).toContain('data-initial="Osmanlı"');
    // Boş seri parametresi seri seçmez.
    expect(await html(NewEpisodePage({ searchParams: Promise.resolve({ series: "" }) }))).toContain('data-initial=""');
  });
});

describe("Bölüm sayfası", () => {
  it("var olan bölüm görünümü açar; olmayan notFound", async () => {
    fake.episodes = [ep("e1")];
    expect(await html(EpisodePage({ params: Promise.resolve({ id: "e1" }) }))).toBe('<div data-episode="e1"></div>');
    await expect(EpisodePage({ params: Promise.resolve({ id: "yok" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Kök yerleşim", () => {
  it("başlık ve açıklama seçilen dilde", async () => {
    fake.cookie = "en";
    expect(await layout.generateMetadata()).toEqual({ title: "AI Video Factory", description: "From one topic to a finished video: an AI video factory" });
  });

  it("gezinti, sürüm ve güncelleme yoksa uyarısız", async () => {
    const h = await html(layout.default({ children: <p>içerik</p> }));
    expect(h).toContain('<html lang="tr">');
    expect(h).toContain('data-locale="tr"');
    expect(text(h)).toContain("AI Video Factory v1.2.3");
    expect(h).toContain("data-nav");
    expect(h).toContain("<p>içerik</p>");
    expect(text(h)).not.toContain("Yeni sürüm");
  });

  it("yeni sürüm varsa uyarı ve sürüm notları bağlantısı", async () => {
    fake.update = { current: "1.2.3", available: true, latest: { version: "1.3.0", url: "https://github.com/r/v1.3.0", publishedAt: "t" } };
    const h = await html(layout.default({ children: null }));
    expect(text(h)).toContain("Yeni sürüm çıktı: v1.3.0 (şu an v1.2.3).");
    expect(h).toContain('href="https://github.com/r/v1.3.0"');
    expect(text(h)).toContain("git pull && pnpm install && pnpm studio:build");
  });
});
