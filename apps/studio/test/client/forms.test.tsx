// @vitest-environment happy-dom
import type { SeriesSummary } from "@ys/pipeline/light";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { msg } from "@ys/core/messages";
import { MODEL_CHOICES } from "@ys/core/models";
import { ModelsForm } from "../../src/app/models/models-form.tsx";
import { NewEpisodeForm } from "../../src/app/new-episode-form.tsx";
import { VOICES } from "../../src/lib/voices.ts";
import { en, fmtTr, json, makeEstimate, makeEstimates, renderIn, row, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  router.push.mockReset();
});

// ---------------- yeni bölüm formu ----------------

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;

function mockApi({ estimate = () => json(makeEstimates()), create = () => json({ id: "yeni-bolum" }) }: { estimate?: Handler; create?: Handler } = {}) {
  const estimates: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url === "/api/estimate") {
      estimates.push(body);
      return estimate(body);
    }
    expect(url).toBe("/api/episodes");
    creates.push(body);
    return create(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, estimates, creates };
}

const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const field = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const submit = () => act(async () => void fireEvent.submit(document.querySelector("form")!));

const series: SeriesSummary[] = [
  {
    name: "Osmanlı Sırları",
    episodes: 3,
    videos: 2,
    lastAt: "2026-10-30T00:00:00Z",
    defaults: { lang: "en", minutes: 5, tier: "premium", motionMode: "vector", stylePack: "flat-explainer", voiceId: "", budgetUsd: 7 },
  },
  { name: "Bilim Kısa", episodes: 1, videos: 0, lastAt: "2026-10-29T00:00:00Z", defaults: { lang: "de", minutes: 2, tier: "economy", budgetUsd: 4 } },
];

describe("NewEpisodeForm", () => {
  beforeEach(() => vi.useFakeTimers());

  it("açılışta 400 ms sonra tahmin ister; tahmin, mod karşılaştırması ve uyarılar görünür", async () => {
    const estimates = makeEstimates();
    estimates.animated = makeEstimate("animated", {
      totalUsd: 9,
      rows: [
        row({ stage: "script", costUsd: 0 }),
        row({ stage: "keyframes", providerId: "fal:flux", costUsd: 6 }),
        row({ stage: "clips", costUsd: 3 }),
        row({ stage: "shots", providerId: "claude", via: msg("cost.via.vision"), costUsd: 1 }),
      ],
      warnings: ["Klip sağlayıcısı yavaş", msg("cost.overBudget", { total: "9.00", cap: 5 })],
    });
    const api = mockApi({ estimate: () => json(estimates) });
    renderIn(<NewEpisodeForm />);
    expect(screen.getByText(tr("series.hint"))).toBeTruthy();
    expect(screen.getByText(tr("form.stylePack.autoHint"))).toBeTruthy();
    await tick(399);
    expect(api.estimates).toHaveLength(0);
    await tick(1);
    expect(api.estimates).toEqual([
      { lang: "tr", minutes: 3, tier: "standard", motionMode: "animated", voiceId: VOICES[0]!.id, budgetUsd: 20, vertical: false, qa: true, realism: true },
    ]);
    expect(screen.getByText(fmtTr.usd(9))).toBeTruthy();
    expect(screen.getByText(`~${fmtTr.duration(estimates.animated.totalSeconds)}`)).toBeTruthy();
    // Ücretsiz satırlar listelenmez; sağlayıcısız satırda tire.
    expect(screen.queryByText(`${tr("stage.script")} · —`)).toBeNull();
    expect(screen.getByText(`${tr("stage.keyframes")} · fal:flux`)).toBeTruthy();
    expect(screen.getByText(`${tr("stage.clips")} · —`)).toBeTruthy();
    expect(screen.getByText(`${tr("motion.animated")}: ${fmtTr.usd(9)}`).className).toBe("text-white");
    expect(screen.getByText(`${tr("motion.vector.short")}: ${fmtTr.usd(0.8)}`)).toBeTruthy();
    expect(screen.getByText("⚠ Klip sağlayıcısı yavaş")).toBeTruthy();
    expect(screen.getByText("⚠ Tahmini toplam ($9.00) bütçe tavanını ($5) aşıyor")).toBeTruthy();
    expect(screen.getByText(`${tr("stage.shots")} · claude (görsel)`)).toBeTruthy();
    expect(screen.queryByText(tr("form.overBudget"))).toBeNull();
  });

  it("form değişince tahmin yenilenir: vektör modunda çizgi stili, bütçe aşımı uyarısı", async () => {
    const api = mockApi();
    renderIn(<NewEpisodeForm />);
    await tick(400);
    expect(field("lineStyle")).toBeNull();
    fireEvent.change(field<HTMLSelectElement>("motionMode"), { target: { value: "vector" } });
    fireEvent.change(field("budgetUsd"), { target: { value: "0.5" } });
    fireEvent.click(document.querySelector('input[name="vertical"]')!);
    await tick(400);
    // Arka arkaya değişiklikler tek istekte toplanır.
    expect(api.estimates).toHaveLength(2);
    expect(api.estimates[1]).toMatchObject({ motionMode: "vector", budgetUsd: 0.5, vertical: true });
    expect(field("lineStyle")).toBeTruthy();
    expect(screen.getByText(tr("form.overBudget"))).toBeTruthy();
  });

  it("tahmin isteği başarısızsa tahmin kutusu çizilmez", async () => {
    mockApi({ estimate: () => json({ error: "x" }, 500) });
    renderIn(<NewEpisodeForm />);
    await tick(400);
    expect(screen.queryByText(tr("form.estCost"))).toBeNull();
  });

  it("stil paketi: hazır paket paleti ve çizgi stili, özel paket ipucu (İngilizce)", async () => {
    mockApi();
    renderIn(<NewEpisodeForm />, "en");
    const pack = field<HTMLSelectElement>("stylePack");
    fireEvent.change(pack, { target: { value: "flat-explainer" } });
    expect(screen.getByText(en("form.stylePack.line", { line: en("line.flat") }))).toBeTruthy();
    expect(document.querySelectorAll('[title="#1d2b53"]')).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Flat explainer" })).toBeTruthy();
    fireEvent.change(pack, { target: { value: "custom" } });
    expect(screen.getByText(en("form.stylePack.customHint"))).toBeTruthy();
    expect(document.querySelectorAll('[title="#1d2b53"]')).toHaveLength(0);
  });

  it("var olan seri seçilince ayarlar son bölümden dolar; bilinmeyen seri ipucu gösterir", async () => {
    const api = mockApi();
    renderIn(<NewEpisodeForm series={series} />);
    await tick(400);
    const name = field("series");
    expect(document.querySelectorAll("#series-list option")).toHaveLength(2);
    fireEvent.change(name, { target: { value: "  osmanlı sırları " } });
    expect(screen.getByText(tr("series.inherit", { n: 3 }))).toBeTruthy();
    expect(field<HTMLSelectElement>("lang").value).toBe("en");
    expect(field("minutes").value).toBe("5");
    expect(field<HTMLSelectElement>("tier").value).toBe("premium");
    expect(field<HTMLSelectElement>("motionMode").value).toBe("vector");
    expect(field<HTMLSelectElement>("voiceId").value).toBe("");
    expect(field("budgetUsd").value).toBe("7");
    expect(field<HTMLSelectElement>("stylePack").value).toBe("flat-explainer");
    expect(field("lineStyle")).toBeTruthy();
    await tick(400);
    expect(api.estimates.at(-1)).toMatchObject({ lang: "en", minutes: 5, tier: "premium", motionMode: "vector", voiceId: "", budgetUsd: 7 });
    // Modu ve paketi olmayan seri: mod ve paket değişmez, ses alanı korunur.
    fireEvent.change(name, { target: { value: "Bilim Kısa" } });
    expect(field<HTMLSelectElement>("lang").value).toBe("de");
    expect(field<HTMLSelectElement>("motionMode").value).toBe("vector");
    expect(field<HTMLSelectElement>("stylePack").value).toBe("flat-explainer");
    expect(field<HTMLSelectElement>("voiceId").value).toBe("");
    fireEvent.change(name, { target: { value: "Yepyeni" } });
    expect(screen.getByText(tr("series.hint"))).toBeTruthy();
  });

  it("seri sayfasından açılınca ayarlar baştan doldurulur", async () => {
    mockApi();
    renderIn(<NewEpisodeForm series={series} initialSeries="Bilim Kısa" />);
    expect(field("series").value).toBe("Bilim Kısa");
    expect(screen.getByText(tr("series.inherit", { n: 1 }))).toBeTruthy();
    expect(field<HTMLSelectElement>("lang").value).toBe("de");
    expect(field("budgetUsd").value).toBe("4");
  });

  it("gönderince bölüm oluşturulur ve sayfasına gidilir", async () => {
    const api = mockApi();
    renderIn(<NewEpisodeForm />);
    fireEvent.change(field<HTMLTextAreaElement>("topic"), { target: { value: "Lale Devri" } });
    fireEvent.change(field("styleHint"), { target: { value: "minyatür" } });
    fireEvent.change(field("series"), { target: { value: "Seri A" } });
    await submit();
    expect(api.creates).toEqual([
      {
        topic: "Lale Devri",
        lang: "tr",
        minutes: 3,
        tier: "standard",
        motionMode: "animated",
        voiceId: VOICES[0]!.id,
        styleHint: "minyatür",
        series: "Seri A",
        budgetUsd: 20,
        vertical: false,
        qa: true,
        realism: true,
        stylePack: "auto",
      },
    ]);
    expect(router.push).toHaveBeenCalledWith("/episodes/yeni-bolum");
  });

  it("vektör modunda seçilen çizgi stili gönderilir; gönderim sürerken düğme kilitli", async () => {
    let finish: (r: Response) => void = () => {};
    const api = mockApi({ create: () => new Promise<Response>((r) => (finish = r)) });
    renderIn(<NewEpisodeForm />);
    fireEvent.change(field<HTMLSelectElement>("motionMode"), { target: { value: "vector" } });
    await tick(400);
    fireEvent.change(field<HTMLSelectElement>("lineStyle"), { target: { value: "ink" } });
    fireEvent.click(document.querySelector('input[name="qa"]')!);
    await submit();
    const button = screen.getByRole("button", { name: tr("form.submitting") }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(api.creates[0]).toMatchObject({ motionMode: "vector", lineStyle: "ink", qa: false });
    await act(async () => finish(json({ id: "v1" })));
    expect(router.push).toHaveBeenCalledWith("/episodes/v1");
  });

  it("sunucu hataları: bilinen çevrilir, bilinmeyen aynen, gövdesiz/kimliksiz genel mesaj, ağ hatası", async () => {
    let reply: () => Response | Promise<Response> = () => json({ error: "Konu gerekli" }, 400);
    mockApi({ create: () => reply() });
    renderIn(<NewEpisodeForm />);
    await submit();
    expect(screen.getByText(tr("err.topic"))).toBeTruthy();
    expect((screen.getByRole("button", { name: tr("form.submit") }) as HTMLButtonElement).disabled).toBe(false);
    reply = () => json({ error: "Depo dolu" }, 500);
    await submit();
    expect(screen.getByText("Depo dolu")).toBeTruthy();
    reply = () => new Response("<html>", { status: 502 });
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    reply = () => json({});
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    reply = () => Promise.reject(new Error("ağ yok"));
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("kaldırılınca bekleyen tahmin isteği iptal edilir", async () => {
    const api = mockApi();
    const view = renderIn(<NewEpisodeForm />);
    view.unmount();
    await tick(1000);
    expect(api.estimates).toHaveLength(0);
  });
});

// ---------------- modeller ----------------

describe("ModelsForm", () => {
  function mockPut(reply: (body: Record<string, unknown>) => Response | Promise<Response> = (b) => json(b)) {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("/api/settings/models");
        expect(init?.method).toBe("PUT");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return reply(body);
      }),
    );
    return bodies;
  }
  const selectOf = (role: string) => screen.getByText(role).closest("div.flex")!.querySelector("select")!;

  it("gruplar ve ajanlar varsayılanlarıyla listelenir; seçim kaydedilir", async () => {
    const bodies = mockPut();
    renderIn(<ModelsForm initial={{}} />);
    expect(screen.getByText(tr("models.hint"))).toBeTruthy();
    expect(screen.getByText(tr("models.group.vector"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: tr("models.reset") })).toBeNull();
    const sel = selectOf("screenwriter");
    expect(sel.value).toBe("");
    expect(sel.options[0]!.textContent).toBe(tr("models.useDefault", { model: "claude-opus-5-5" }));
    expect(sel.options).toHaveLength(MODEL_CHOICES.length + 1);
    await act(async () => void fireEvent.change(sel, { target: { value: "claude-haiku-5-5" } }));
    expect(bodies).toEqual([{ screenwriter: "claude-haiku-5-5" }]);
    expect(screen.getByText(tr("models.saved"))).toBeTruthy();
    expect(selectOf("screenwriter").className).toContain("border-accent");
    // Varsayılanla aynı model seçmek vurgulanmaz; boş seçim kaydı siler.
    await act(async () => void fireEvent.change(selectOf("director"), { target: { value: "claude-sonnet-5-5" } }));
    expect(selectOf("director").className).not.toContain("border-accent");
    await act(async () => void fireEvent.change(selectOf("screenwriter"), { target: { value: "" } }));
    expect(bodies.at(-1)).toEqual({ director: "claude-sonnet-5-5" });
    // Hepsini sıfırla
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("models.reset") })));
    expect(bodies.at(-1)).toEqual({});
    expect(screen.queryByRole("button", { name: tr("models.reset") })).toBeNull();
  });

  it("kaydederken seçimler kilitli; sunucunun temizlediği ayar geri yazılır", async () => {
    let finish: (r: Response) => void = () => {};
    mockPut(() => new Promise<Response>((r) => (finish = r)));
    renderIn(<ModelsForm initial={{ "asset-gate": "claude-opus-5-5" }} />, "en");
    await act(async () => void fireEvent.change(selectOf("asset-gate"), { target: { value: "claude-fable-5-1" } }));
    expect(screen.getByText(en("models.saving"))).toBeTruthy();
    expect(selectOf("asset-gate").disabled).toBe(true);
    await act(async () => finish(json({})));
    expect(selectOf("asset-gate").value).toBe("");
    expect(screen.getByText(en("models.saved"))).toBeTruthy();
  });

  it("sunucu reddederse ya da ağ düşerse hata gösterilir", async () => {
    let reply: () => Response | Promise<Response> = () => json({ error: "x" }, 500);
    mockPut(() => reply());
    renderIn(<ModelsForm initial={{}} />);
    await act(async () => void fireEvent.change(selectOf("director"), { target: { value: "claude-opus-5-5" } }));
    expect(screen.getByText(tr("models.error")).className).toContain("text-bad");
    reply = () => Promise.reject(new Error("ağ yok"));
    await act(async () => void fireEvent.change(selectOf("director"), { target: { value: "claude-haiku-5-5" } }));
    expect(screen.getByText(tr("models.error"))).toBeTruthy();
  });
});
