// @vitest-environment happy-dom
import type { ActivityEntry, EpisodeState } from "@ys/pipeline/light";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { EpisodeView } from "../../src/app/episodes/[id]/episode-view.tsx";
import type { EpisodeResponse } from "../../src/lib/types.ts";
import { en, fmtTr, json, makeData, makeState, renderIn, tr } from "./fixtures.tsx";

const NOW = Date.parse("2026-10-31T10:10:00.000Z");
const ID = "2026-10-31-kahve-abc123";

type ActionHandler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** API sahtesi: GET bölüm yanıtı, POST eylem; gönderilen eylemler kaydedilir. */
function mockApi(data: EpisodeResponse | (() => EpisodeResponse), onAction: ActionHandler = () => json({ ok: true })) {
  const actions: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      expect(url).toBe(`/api/episodes/${ID}/action`);
      expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      actions.push(body);
      return onAction(body);
    }
    expect(url).toBe(`/api/episodes/${ID}`);
    return json(typeof data === "function" ? data() : data);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, actions };
}

async function show(data: EpisodeResponse, locale: "tr" | "en" = "tr", onAction?: ActionHandler) {
  const api = mockApi(data, onAction);
  const view = renderIn(<EpisodeView id={ID} />, locale);
  await screen.findByRole("tablist");
  return { ...api, view };
}

const click = async (el: Element) => act(async () => void fireEvent.click(el));
const activity: ActivityEntry[] = [
  { at: "2026-10-31T10:00:00Z", stage: "script", level: "stage", msg: "▶ script" },
  { at: "2026-10-31T10:01:00Z", stage: "script", level: "info", msg: "senaryo yazıldı" },
  { at: "2026-10-31T10:02:00Z", stage: "story", level: "warn", msg: "uzun beat" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("EpisodeView: yükleme ve üst bilgi", () => {
  it("veri gelene kadar yükleniyor; sonra başlık, rozet, dil, süre, mod, kalite ve harcama", async () => {
    mockApi(makeData(makeState({ story: { title: "Kahve Yasağı", logline: "", premise: "", hook: "", beats: [] } }), { spentUsd: 19 }));
    renderIn(<EpisodeView id={ID} />);
    expect(screen.getByText(tr("common.loading"))).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Kahve Yasağı" })).toBeTruthy();
    expect(screen.getAllByText(tr("status.idle")).length).toBeGreaterThan(0);
    const meta = screen.getByRole("heading", { name: "Kahve Yasağı" }).parentElement!.nextElementSibling!;
    expect(meta.textContent).toBe(`TR·${fmtTr.duration(180)}·${tr("motion.still")}·${tr("form.tier.standard")}`);
    expect(screen.getByText(tr("ep.claude", { usd: fmtTr.usd(0.75) }))).toBeTruthy();
    // %95 harcandı → kırmızı çubuk.
    expect(document.querySelector(".bg-bad[style]")).toBeTruthy();
    expect(screen.getByText(tr("series.none"))).toBeTruthy();
    expect(screen.getByRole("link", { name: tr("nav.episodes") }).getAttribute("href")).toBe("/");
  });

  it("başarısız GET veriyi değiştirmez (yükleniyor kalır)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "x" }, 500)));
    renderIn(<EpisodeView id={ID} />);
    await act(async () => {});
    expect(screen.getByText(tr("common.loading"))).toBeTruthy();
  });

  it("seri etiketi bağlantıdır; kalemle düzenlenir, kaydedilir ya da vazgeçilir", async () => {
    const { actions } = await show(makeData(makeState({}, { series: "Osmanlı Sırları" })));
    const link = screen.getByRole("link", { name: tr("series.label", { name: "Osmanlı Sırları" }) });
    expect(link.getAttribute("href")).toBe(`/?series=${encodeURIComponent("Osmanlı Sırları")}`);
    expect(document.querySelector(".bg-accent[style]")).toBeTruthy();
    await click(screen.getByTitle(tr("series.edit")));
    const input = screen.getByPlaceholderText(tr("series.placeholder")) as HTMLInputElement;
    expect(input.value).toBe("Osmanlı Sırları");
    fireEvent.change(input, { target: { value: "Yeni Seri" } });
    await act(async () => void fireEvent.submit(input.closest("form")!));
    expect(actions).toEqual([{ type: "set-series", series: "Yeni Seri" }]);
    expect(screen.queryByPlaceholderText(tr("series.placeholder"))).toBeNull();
    await click(screen.getByTitle(tr("series.edit")));
    await click(screen.getByRole("button", { name: tr("gate.cancel") }));
    expect(screen.queryByPlaceholderText(tr("series.placeholder"))).toBeNull();
    expect(actions).toHaveLength(1);
  });
});

describe("EpisodeView: sekmeler", () => {
  it("sekme tıklanınca içerik değişir ve adres çubuğuna yazılır; sayaçlar görünür", async () => {
    const shots = [{ id: "sh1", sceneId: "s1", kind: "still_motion" as const, startMs: 0, endMs: 1000, description: "", imagePrompt: "", motionPrompt: "", camera: "static" as const }];
    await show(makeData(makeState({ shots, activity })));
    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByRole("tab", { name: tr("tab.overview") }).getAttribute("aria-selected")).toBe("true");
    expect(within(tabs).getByRole("tab", { name: new RegExp(`^${tr("tab.shots")}\\s*1$`) })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: new RegExp(`^${tr("tab.activity")}\\s*3$`) })).toBeTruthy();
    const expectations: [string, string][] = [
      ["script", tr("script.none")],
      ["concept", tr("concept.none")],
      ["shots", "#1"],
      ["costs", tr("ct.col.basis")],
      ["activity", tr("act.all")],
      ["overview", tr("ov.facts")],
    ];
    for (const [tab, text] of expectations) {
      await click(within(tabs).getByRole("tab", { name: new RegExp(`^${tr(`tab.${tab}` as "tab.script")}`) }));
      expect(window.location.hash).toBe(`#${tab}`);
      expect(screen.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it("adresteki sekme açılışta ve hashchange ile uygulanır; geçersiz sekme yok sayılır", async () => {
    window.location.hash = "#costs";
    await show(makeData(makeState()));
    expect(screen.getByRole("tab", { name: tr("tab.costs") }).getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      window.location.hash = "#script";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(screen.getByRole("tab", { name: tr("tab.script") }).getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      window.location.hash = "#yok";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(screen.getByRole("tab", { name: tr("tab.script") }).getAttribute("aria-selected")).toBe("true");
  });

  it("aşama şeridinden aşamaya tıklanınca günlük o aşamaya süzülür", async () => {
    await show(makeData(makeState({ activity })));
    await click(screen.getAllByTitle(tr("pipe.open"))[1]!);
    expect(window.location.hash).toBe("#activity");
    expect(screen.getByRole("button", { name: tr("stage.story") }).className).toContain("chip-on");
    expect(screen.getByText(tr("act.count", { n: 1 }))).toBeTruthy();
    // Günlük sekmesinde "Tümü" süzgeci kaldırır.
    await click(screen.getByRole("button", { name: tr("act.all") }));
    expect(screen.getByText(tr("act.count", { n: 3 }))).toBeTruthy();
  });
});

describe("EpisodeView: durum panelleri", () => {
  const stats = {
    style: { startedAt: "2026-10-31T10:00:00Z", endedAt: "2026-10-31T10:00:30Z", durationMs: 30_000 },
    keyframes: { startedAt: "2026-10-31T10:08:00Z" },
    render: { startedAt: "2026-10-31T10:09:00Z" },
  };

  it("çalışırken: aşama ipucu, ilerleme, kalan süre, geçen süre, son güncelleme ve durdurma", async () => {
    const state = makeState({ done: { style: "t" }, stats, heartbeatAt: "2026-10-31T10:09:30Z", activity });
    const { actions } = await show(
      makeData(state, {
        status: { status: "running", stage: "keyframes" },
        progress: { stage: "keyframes", label: "kare", done: 3, total: 12, etaSec: 90 },
        job: { label: "job.produce", status: "running", log: [], startedAt: "t" },
        actual: { byStage: [{ key: "style", calls: 1, cacheHits: 0, failures: 0, micros: 120_000, durationMs: 0, units: 1 }], byProvider: [] },
      }),
    );
    // Çalışan bölümde varsayılan sekme günlük.
    expect(screen.getByRole("tab", { name: /^Günlük/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: tr("live.now", { stage: tr("stage.keyframes") }) })).toBeTruthy();
    expect(screen.getByText(tr("hint.keyframes"))).toBeTruthy();
    expect(screen.getByText("3/12")).toBeTruthy();
    expect(screen.getByText(tr("live.left", { time: fmtTr.duration(90) }))).toBeTruthy();
    expect(screen.getByText(tr("live.elapsed", { time: fmtTr.duration(120) }))).toBeTruthy();
    expect(screen.getByText(tr("live.heartbeat", { ago: fmtTr.ago("2026-10-31T10:09:30Z", NOW) }))).toBeTruthy();
    expect(screen.queryByText(tr("live.external"))).toBeNull();
    // Şerit: bitmiş aşamanın süresi ve maliyeti, çalışanın geçen süresi ve ilerleme çubuğu, bekleyenin tahmini.
    const rail = screen.getAllByTitle(tr("pipe.open"));
    expect(rail[0]!.textContent).toContain(fmtTr.duration(30));
    expect(rail[0]!.textContent).toContain(fmtTr.usd(0.12));
    expect(rail[7]!.textContent).toContain(fmtTr.duration(120));
    expect((rail[7]!.querySelector("[style]") as HTMLElement).style.width).toBe("25%");
    expect(rail[1]!.textContent).toContain(tr("pipe.est", { v: fmtTr.duration(0) }));
    // Studio işi durdurulabilir; iş sürerken eylemler kilitli.
    await click(screen.getByRole("button", { name: tr("ep.job.stop") }));
    expect(actions).toEqual([{ type: "cancel" }]);
    // Son olaylar en yeni önce; "Tüm günlük" sekmeye geçer.
    await click(screen.getByRole("button", { name: `${tr("live.allLog")} →` }));
    expect(window.location.hash).toBe("#activity");
  });

  it("CLI'dan çalışırken: render yüzdesi, ilerleme olmadan nabız çizgisi, dış iş uyarısı; aşamasız çalışma", async () => {
    const state = makeState({ stats });
    const { view } = await show(
      makeData(state, { status: { status: "running", stage: "render" }, progress: { stage: "render", label: "", done: 40, total: 100 } }),
    );
    expect(screen.getByText("40/100%")).toBeTruthy();
    expect(screen.getByText(tr("live.external"))).toBeTruthy();
    expect(screen.queryByText(tr("live.heartbeat", { ago: "" }).trim())).toBeNull();
    expect(screen.queryByRole("button", { name: tr("ep.job.stop") })).toBeNull();
    view.unmount();

    // İlerleme başka aşamada ya da toplamı 0: çubuk yok, nabız çizgisi var.
    await show(makeData(state, { status: { status: "running", stage: "keyframes" }, progress: { stage: "voice", label: "", done: 0, total: 0 } }));
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
    cleanup();
    await show(makeData(makeState(), { status: { status: "running" } }));
    expect(screen.getByRole("heading", { name: tr("live.now", { stage: "" }).trim() })).toBeTruthy();
    expect(screen.queryByText(tr("hint.keyframes"))).toBeNull();
  });

  it("takıldı: son güncelleme, aşama başlangıcı ya da oluşturma zamanından; devam eylemi", async () => {
    const base = { status: { status: "stalled" as const, stage: "keyframes" as const } };
    const { actions } = await show(makeData(makeState({ heartbeatAt: "2026-10-31T09:50:00Z", stats }), base));
    expect(screen.getByText(tr("live.stalled", { stage: tr("stage.keyframes"), ago: fmtTr.ago("2026-10-31T09:50:00Z", NOW) }))).toBeTruthy();
    await click(screen.getByRole("button", { name: tr("ep.err.resume") }));
    expect(actions).toEqual([{ type: "resume" }]);
    cleanup();
    await show(makeData(makeState({ stats }), base));
    expect(screen.getByText(tr("live.stalled", { stage: tr("stage.keyframes"), ago: fmtTr.ago("2026-10-31T10:08:00Z", NOW) }))).toBeTruthy();
    cleanup();
    await show(makeData(makeState(), { ...base, job: { label: "x", status: "running", log: [], startedAt: "t" } }));
    expect(screen.getByText(tr("live.stalled", { stage: tr("stage.keyframes"), ago: fmtTr.ago("2026-10-31T10:00:00.000Z", NOW) }))).toBeTruthy();
    // Studio işi sürerken devam kilitli.
    expect((screen.getByRole("button", { name: tr("ep.err.resume") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hata: mesaj, ses kotası hatasında Gemini'ye geçiş; başka hatada yalnız devam", async () => {
    const err = (stage: "voice" | "keyframes", message: string): Partial<EpisodeState> => ({ lastError: { stage, message, at: "t" } });
    const { actions } = await show(makeData(makeState(err("voice", "ElevenLabs quota exceeded")), { status: { status: "error", stage: "voice" } }));
    expect(screen.getByRole("heading", { name: tr("ep.err.stopped", { stage: tr("stage.voice") }) })).toBeTruthy();
    expect(screen.getByText("ElevenLabs quota exceeded")).toBeTruthy();
    await click(screen.getByRole("button", { name: tr("ep.err.toGemini") }));
    await click(screen.getByRole("button", { name: tr("ep.err.resume") }));
    expect(actions).toEqual([{ type: "change-voice", voiceId: "" }, { type: "resume" }]);
    cleanup();
    await show(makeData(makeState(err("keyframes", "kota doldu")), { status: { status: "error", stage: "keyframes" } }));
    expect(screen.queryByRole("button", { name: tr("ep.err.toGemini") })).toBeNull();
    cleanup();
    await show(makeData(makeState(err("voice", "zaman aşımı")), { status: { status: "error", stage: "voice" } }));
    expect(screen.queryByRole("button", { name: tr("ep.err.toGemini") })).toBeNull();
  });

  it("çevrilebilir hata seçili dilde gösterilir", async () => {
    const lastError = { stage: "keyframes" as const, message: "Bilinmeyen hata", text: { key: "err.unknown" as const }, at: "t" };
    await show(makeData(makeState({ lastError }), { status: { status: "error", stage: "keyframes" } }), "en");
    expect(screen.getByText("Unknown error")).toBeTruthy();
  });

  it("hata kaydı yoksa (çöken Stüdyo işi): sürecin son satırı, o da yoksa genel mesaj; sayfa çökmez", async () => {
    const job = (log: string[]) => ({ job: { label: "x", status: "error" as const, log, startedAt: "t" }, status: { status: "error" as const, stage: "keyframes" as const } });
    await show(makeData(makeState(), job(["başladı", "Süreç çıkış kodu: 3221226505 (0xC0000409)"])));
    expect(screen.getByText("Süreç çıkış kodu: 3221226505 (0xC0000409)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: tr("ep.err.toGemini") })).toBeNull();
    cleanup();
    await show(makeData(makeState(), { status: { status: "error", stage: "keyframes" } }));
    expect(screen.getByText(tr("ep.err.crashed"))).toBeTruthy();
  });

  it("onay bekliyor: senaryo ya da konsept sekmesi açılır, düğme oraya götürür", async () => {
    await show(makeData(makeState(), { status: { status: "waiting", stage: "cast" } }));
    expect(screen.getByRole("tab", { name: tr("tab.script") }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(tr("live.waiting.script"))).toBeTruthy();
    expect(screen.getAllByText(`${tr("status.waiting")} · ${tr("step.script")}`).length).toBeGreaterThan(0);
    await click(screen.getByRole("tab", { name: tr("tab.costs") }));
    await click(screen.getByRole("button", { name: tr("live.goApprove") }));
    expect(window.location.hash).toBe("#script");
    cleanup();
    window.location.hash = "";
    await show(makeData(makeState(), { status: { status: "waiting", stage: "voice" } }));
    expect(screen.getByRole("tab", { name: tr("tab.concept") }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(tr("live.waiting.concept"))).toBeTruthy();
    await click(screen.getByRole("button", { name: tr("live.goApprove") }));
    expect(window.location.hash).toBe("#concept");
  });

  it("beklemede: senaryo varsa devam düğmesi; tamamlandıysa canlı panel yok; aşamasız bekleme", async () => {
    const script = { scenes: [{ id: "s1", beatId: "b1", narration: "x", visualIntent: "", emotion: "", location: "" }] };
    const { actions } = await show(makeData(makeState({ script }), { status: { status: "idle", stage: "voice" } }));
    expect(screen.getByRole("heading", { name: tr("live.idle", { stage: tr("stage.voice") }) })).toBeTruthy();
    await click(screen.getByRole("button", { name: tr("live.continue") }));
    expect(actions).toEqual([{ type: "resume" }]);
    cleanup();
    await show(makeData(makeState(), { status: { status: "idle" } }));
    expect(screen.getByRole("heading", { name: tr("live.idle", { stage: "" }).trim() })).toBeTruthy();
    expect(screen.queryByRole("button", { name: tr("live.continue") })).toBeNull();
    expect(screen.getByText(tr("act.empty"))).toBeTruthy();
    cleanup();
    await show(makeData(makeState(), { status: { status: "done" } }));
    expect(screen.queryByText(tr("live.recent"))).toBeNull();
  });
});

describe("EpisodeView: eylem hataları", () => {
  const script = { scenes: [{ id: "s1", beatId: "b1", narration: "x", visualIntent: "", emotion: "", location: "" }] };
  const idle = () => makeData(makeState({ script }), { status: { status: "idle", stage: "voice" } });
  const resume = () => click(screen.getByRole("button", { name: tr("live.continue") }));

  it("bilinen sunucu hatası sözlükten çevrilir (İngilizce)", async () => {
    await show(idle(), "en", () => json({ error: "Önce çalışan iş bitmeli" }, 409));
    await click(screen.getByRole("button", { name: en("live.continue") }));
    expect(screen.getByText(en("err.busy"))).toBeTruthy();
  });

  it("bilinmeyen hata olduğu gibi; gövdesiz hata genel mesaj; sonraki eylem hatayı temizler", async () => {
    let reply: () => Response = () => json({ error: "Tuhaf bir şey oldu" }, 500);
    await show(idle(), "tr", () => reply());
    await resume();
    expect(screen.getByText("Tuhaf bir şey oldu")).toBeTruthy();
    reply = () => new Response("<html>", { status: 502 });
    await resume();
    expect(screen.getByText(tr("common.actionFailed"))).toBeTruthy();
    reply = () => json({}, 400);
    await resume();
    expect(screen.getByText(tr("common.actionFailed"))).toBeTruthy();
    reply = () => json({ ok: true });
    await resume();
    expect(screen.queryByText(tr("common.actionFailed"))).toBeNull();
  });

  it("ağ hatasında genel mesaj ve düğmeler kilitli kalmaz (yenileme de düşse)", async () => {
    const { fetchMock } = await show(idle());
    fetchMock.mockImplementation(async () => {
      throw new Error("ağ yok");
    });
    await resume();
    expect(screen.getByText(tr("common.actionFailed"))).toBeTruthy();
    expect((screen.getByRole("button", { name: tr("live.continue") }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("EpisodeView: yenileme aralıkları", () => {
  it("çalışırken 1,5 sn, durunca 5 sn aralıkla yeniler; kaldırılınca durur", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let current = makeData(makeState(), { status: { status: "running", stage: "script" } });
    const { fetchMock } = mockApi(() => current);
    const view = renderIn(<EpisodeView id={ID} />);
    await act(async () => {});
    // İlk yükleme + "çalışıyor" görülünce hızlı aralığa geçerken bir yenileme.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    current = makeData(makeState(), { status: { status: "idle", stage: "script" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    // Durum değişince zamanlayıcı yeniden kurulur (hemen bir yenileme), sonra 5 sn.
    const after = fetchMock.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(4900)));
    expect(fetchMock.mock.calls.length).toBe(after);
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(fetchMock.mock.calls.length).toBe(after + 1);
    view.unmount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(fetchMock.mock.calls.length).toBe(after + 1);
  });
});
