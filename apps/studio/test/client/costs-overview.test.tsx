// @vitest-environment happy-dom
import { msg } from "@ys/core/messages";
import type { CostGroup } from "@ys/media-gateway";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostsTab } from "../../src/app/episodes/[id]/costs-panel.tsx";
import { OverviewTab } from "../../src/app/episodes/[id]/overview.tsx";
import { Bar, costOf, modeOf, Stat, StatusIcon } from "../../src/app/episodes/[id]/parts.tsx";
import { en, fmtEn, fmtTr, makeData, makeEstimate, makeState, renderIn, row, tr } from "./fixtures.tsx";

afterEach(cleanup);

const group = (over: Partial<CostGroup> & Pick<CostGroup, "key">): CostGroup => ({
  calls: 1,
  cacheHits: 0,
  failures: 0,
  micros: 100_000,
  durationMs: 0,
  units: 1,
  ...over,
});

describe("CostsTab", () => {
  it("tahmin ve gerçekleşeni aşama satırlarında yan yana gösterir", () => {
    const state = makeState(
      {
        stats: {
          script: { startedAt: "2026-10-31T10:00:00Z", endedAt: "2026-10-31T10:01:30Z", durationMs: 90_000 },
          concept: { startedAt: "2026-10-31T10:05:00Z" },
        },
      },
      { motionMode: "vector" },
    );
    const est = makeEstimate("vector", {
      rows: [
        row({ stage: "script", providerId: "claude", costUsd: 0.1, done: true }),
        // Aynı aşamanın ikinci satırı: gerçek değer yalnız ilk satırda.
        row({ stage: "script", providerId: "claude-doctor", costUsd: 0.05, quantity: 0 }),
        row({ stage: "concept", costUsd: 0.2, unit: "" }),
        row({ stage: "voice", costUsd: 1 }),
      ],
      warnings: ["Ses sağlayıcısı yok"],
    });
    const data = makeData(state, {
      estimates: { ...makeData(state).estimates, vector: est },
      actual: {
        byStage: [
          group({ key: "script", micros: 500_000, failures: 2, calls: 3, cacheHits: 1 }),
          group({ key: "concept", micros: 6_000 }),
        ],
        byProvider: [
          group({ key: "claude", micros: 500_000, calls: 4, durationMs: 8000, cacheHits: 2 }),
          group({ key: "fal:flux", micros: 5_000, calls: 0 }),
        ],
      },
    });
    renderIn(<CostsTab data={data} />);
    // Özet kartları
    expect(screen.getByText(fmtTr.usd(est.totalUsd))).toBeTruthy();
    expect(screen.getByText(`${fmtTr.usd(2)} / ${fmtTr.usd(20)}`)).toBeTruthy();
    expect(screen.getByText(tr("ep.claude", { usd: fmtTr.usd(0.75) }))).toBeTruthy();
    expect(screen.getAllByText(fmtTr.duration(90)).length).toBeGreaterThan(0);
    // Bütçeyi 1,5 kattan fazla aşan gerçek değer vurgulanır ve hata sayısı görünür.
    const over = screen.getByText(tr("ct.failures", { n: 2 })).closest("td")!;
    expect(over.className).toContain("text-accent");
    expect(over.getAttribute("title")).toBe(tr("ct.calls", { calls: 3, cache: 1, fail: 2 }));
    // Küçük tutar (10.000 mikro altı) aşım sayılmaz.
    const small = screen.getByText(fmtTr.usd(0.006)).closest("td")!;
    expect(small.className).not.toContain("text-accent");
    // Miktar: birim ya da miktar yoksa tire.
    expect(screen.getAllByText(`${fmtTr.number(1)} adet`)).toHaveLength(2);
    expect(screen.getByText("Ses sağlayıcısı yok")).toBeTruthy();
    // Sağlayıcı dökümü
    expect(screen.getByText(tr("costs.byProvider"))).toBeTruthy();
    const claude = screen.getByText("claude:", { exact: false }).closest("span")!;
    expect(claude.textContent).toContain(tr("ct.callCount", { n: 4 }));
    expect(claude.textContent).toContain(tr("ct.avg", { time: fmtTr.duration(2) }));
    expect(claude.textContent).toContain(tr("ct.cache", { n: 2 }));
    const flux = screen.getByText("fal:flux:", { exact: false }).closest("span")!;
    // Çağrısı olmayan sağlayıcıda ortalama ve önbellek eki yok.
    expect(flux.textContent).toBe(`fal:flux: ${fmtTr.usd(0.005)} · ${tr("ct.callCount", { n: 0 })}`);
  });

  it("gerçekleşen yoksa tireler, uyarı ve sağlayıcı bölümü yok (İngilizce)", () => {
    const state = makeState({}, { aiClipRatio: 0.5 });
    const data = makeData(state, {
      estimates: { ...makeData(state).estimates, mixed: makeEstimate("mixed", { rows: [row({ stage: "render" })] }) },
    });
    render(<CostsTab data={data} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(tr("costs.byProvider"))).toBeNull();
    expect(screen.getByText(tr("stage.render"))).toBeTruthy();
    cleanup();
    renderIn(<CostsTab data={data} />, "en");
    expect(screen.getByText(en("ct.col.stage"))).toBeTruthy();
  });
});

describe("CostsTab: çevrilebilir tahmin metinleri", () => {
  it("birim (tekil/çoğul), model açıklaması, dayanak ve uyarılar seçili dilde", () => {
    const state = makeState({}, { motionMode: "vector" });
    const rows = [
      row({ stage: "concept", providerId: "claude", via: msg("cost.via.svg"), quantity: 1, unit: msg("unit.asset"), basis: msg("cost.basis.measured", { n: 3 }) }),
      row({ stage: "keyframes", providerId: "claude", via: msg("cost.via.draftReview"), quantity: 12, unit: msg("unit.frame"), basis: msg("cost.basis.props") }),
      row({ stage: "render", via: msg("cost.via.remotion"), quantity: 1, unit: msg("unit.videoSec"), basis: msg("cost.basis.local") }),
    ];
    const data = makeData(state, {
      estimates: { ...makeData(state).estimates, vector: makeEstimate("vector", { rows, warnings: [msg("cost.noProvider", { capability: "tts" })] }) },
    });
    renderIn(<CostsTab data={data} />, "en");
    expect(screen.getByText("1 asset")).toBeTruthy();
    expect(screen.getByText("12 frames")).toBeTruthy();
    expect(screen.getByText("1 s of video")).toBeTruthy();
    expect(screen.getByText("claude (SVG)")).toBeTruthy();
    expect(screen.getByText("claude (draft review)")).toBeTruthy();
    expect(screen.getByText("local (Remotion)")).toBeTruthy();
    expect(screen.getByText("measured (n=3)")).toBeTruthy();
    expect(screen.getByText(/No suitable provider for "tts"/)).toBeTruthy();
    cleanup();
    renderIn(<CostsTab data={data} />, "tr");
    expect(screen.getByText("1 varlık")).toBeTruthy();
    expect(screen.getByText("claude (taslak denetimi)")).toBeTruthy();
    expect(screen.getByText("yerel (Remotion)")).toBeTruthy();
  });
});

describe("OverviewTab", () => {
  const review = {
    at: "2026-10-31T11:00:00Z",
    shots: {
      sh1: { score: 8, issues: [{ type: "text", detail: "yazı var" }] },
      sh2: { score: 9, issues: [{ type: "text", detail: "yine yazı" }, { type: "hands", detail: "el bozuk" }] },
    },
    lessons: Array.from({ length: 7 }, (_, i) => ({ target: "director" as const, rule: `Kural ${i + 1}` })),
  };

  it("render edilmiş videoyu, posteri ve indirme bağlantısını gösterir", () => {
    const state = makeState({
      render: { path: "/x/video.mp4", at: "2026-10-31T12:00:00Z" },
      shots: [
        {
          id: "sh1",
          sceneId: "s1",
          kind: "still_motion",
          startMs: 0,
          endMs: 3000,
          description: "",
          imagePrompt: "",
          motionPrompt: "",
          camera: "static",
        },
      ],
      keyframes: { sh1: { key: "episodes/x/kf/sh1.png", mimeType: "image/png" } },
      voice: { s1: { key: "v", mimeType: "audio/mpeg", durationMs: 120_000, words: [], estimatedTiming: false } },
      stats: { script: { startedAt: "2026-10-31T10:00:00Z", durationMs: 60_000 }, story: undefined },
      review,
      draftReview: { ...review, avg: 7.5, revisedScenes: ["s2"] },
      scriptNotes: ["Tarih düzeltildi"],
      style: {
        pack: "flat-explainer",
        artStyle: "Düz",
        promptPrefix: "",
        negativeRules: [],
        palette: ["#112233", "#445566", "#778899"],
        lighting: "",
        lensLanguage: "",
      },
    });
    const data = makeData(state, { actual: { byStage: [{ key: "keyframes", calls: 1, cacheHits: 0, failures: 0, micros: 4_000_000, durationMs: 0, units: 1 }], byProvider: [] } });
    const { container } = renderIn(<OverviewTab data={data} />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(`/api/episodes/${state.id}/video?v=${encodeURIComponent("2026-10-31T12:00:00Z")}`);
    expect(video.getAttribute("poster")).toBe("/api/assets/episodes/x/kf/sh1.png");
    expect(screen.getByText(tr("video.download")).closest("a")!.getAttribute("href")).toContain("&download");
    expect(screen.getByText(tr("video.srt")).closest("a")!.getAttribute("href")).toContain("&srt");
    // act verilmezse altyazı anahtarı yok.
    expect(screen.queryByText(tr("video.captions"))).toBeNull();
    // Video 2 dk, toplam $4 → dakika başına $2.
    expect(screen.getByText(fmtTr.duration(120))).toBeTruthy();
    expect(screen.getByText(fmtTr.usd(2))).toBeTruthy();
    expect(screen.getByText(fmtTr.duration(60))).toBeTruthy();
    // İnceleme: ortalama 8.5, yeşil; en sık sorun "text" (2).
    expect(screen.getByText("8.5").className).toContain("text-ok");
    expect(screen.getByText("text")).toBeTruthy();
    expect(screen.getByText(tr("prod.draft", { avg: "7.5", n: 1 }))).toBeTruthy();
    // Dersler: 5'i görünür, düğmeyle tümü.
    expect(screen.queryByText("Kural 6")).toBeNull();
    fireEvent.click(screen.getByText(tr("ov.more", { n: 2 })));
    expect(screen.getByText("Kural 7")).toBeTruthy();
    fireEvent.click(screen.getByText(tr("ov.less")));
    expect(screen.queryByText("Kural 7")).toBeNull();
    expect(screen.getByText("Tarih düzeltildi")).toBeTruthy();
    // Bilgiler: paket adı, ses, palet.
    expect(screen.getByText(tr("voice.gemini"))).toBeTruthy();
    expect(container.querySelectorAll('[title="#112233"]')).toHaveLength(1);
  });

  it("altyazı anahtarı ayarı değiştirir; render yeniden açıldıysa yeniden render düğmesi çıkar", () => {
    const act = vi.fn(async (_action: Record<string, unknown>) => true);
    const done = makeState({ render: { path: "/x/v.mp4", at: "t" }, done: { render: "t" } });
    const { rerender } = renderIn(<OverviewTab data={makeData(done)} act={act} />);
    const box = screen.getByLabelText(tr("video.captions")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.queryByText(tr("video.rerender"))).toBeNull();
    fireEvent.click(box);
    expect(act).toHaveBeenLastCalledWith({ type: "set-captions", enabled: false });
    const off = makeState({ render: { path: "/x/v.mp4", at: "t" }, done: {} }, { captions: false });
    rerender(<OverviewTab data={makeData(off)} act={act} busy />);
    expect((screen.getByLabelText(tr("video.captions")) as HTMLInputElement).checked).toBe(false);
    const again = screen.getByText(tr("video.rerender")).closest("button")!;
    expect(again.disabled).toBe(true);
    rerender(<OverviewTab data={makeData(off)} act={act} />);
    fireEvent.click(screen.getByText(tr("video.rerender")));
    expect(act).toHaveBeenLastCalledWith({ type: "resume" });
  });

  it("video yoksa yer tutucu; inceleme yoksa bilgi; zayıf ve orta puan renkleri", () => {
    const state = makeState({ voiceProviderId: "gemini-tts" }, { voiceId: "bilinmeyen" });
    const { rerender } = renderIn(<OverviewTab data={makeData(state)} />);
    expect(screen.getByText(tr("ov.noVideo"))).toBeTruthy();
    expect(screen.getByText(tr("ov.noReview"))).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("gemini-tts")).toBeTruthy();
    expect(screen.queryByText(tr("video.download"))).toBeNull();

    const mid = { at: "x", shots: { a: { score: 5, issues: [] } }, lessons: [] };
    rerender(<OverviewTab data={makeData(makeState({ review: mid }))} />);
    expect(screen.getByText("5.0").className).toContain("text-accent");
    const low = { at: "x", shots: { a: { score: 2, issues: [] } }, lessons: [] };
    rerender(<OverviewTab data={makeData(makeState({ review: low, scriptNotes: [] }))} />);
    expect(screen.getByText("2.0").className).toContain("text-bad");
    rerender(<OverviewTab data={makeData(makeState({ review: { at: "x", shots: {}, lessons: [] } }))} />);
    expect(screen.getByText("0.0")).toBeTruthy();
  });

  it("bilinmeyen ses ve sağlayıcı yoksa ses satırı tire", () => {
    renderIn(<OverviewTab data={makeData(makeState({}, { voiceId: "bilinmeyen" }))} />);
    const voiceRow = screen.getByText(tr("fact.voice")).parentElement!;
    expect(voiceRow.querySelector("dd")!.textContent).toBe("—");
  });

  it("poster inceleme karesinden; ses yoksa ve sağlayıcı yoksa tire", () => {
    const shot = { id: "a", sceneId: "s1", kind: "still_motion" as const, startMs: 0, endMs: 1, description: "", imagePrompt: "", motionPrompt: "", camera: "static" as const };
    const state = makeState({ render: { path: "p", at: "t" }, shots: [shot], stills: { a: { key: "st/a.png", mimeType: "image/png" } } });
    const { container, rerender } = renderIn(<OverviewTab data={makeData(state)} />);
    expect(container.querySelector("video")!.getAttribute("poster")).toBe("/api/assets/st/a.png");
    rerender(<OverviewTab data={makeData(makeState({ render: { path: "p", at: "t" } }))} />);
    expect(container.querySelector("video")!.getAttribute("poster")).toBeNull();
    rerender(<OverviewTab data={makeData(makeState({ render: { path: "p", at: "t" }, shots: [shot] }))} />);
    expect(container.querySelector("video")!.getAttribute("poster")).toBeNull();
  });

  it("vektör modunda çizgi stili: kullanıcı seçimi, paketinki ya da varsayılan (İngilizce)", () => {
    const style = { artStyle: "x", promptPrefix: "", negativeRules: [], palette: ["#000000", "#111111", "#222222"], lighting: "", lensLanguage: "" };
    const { rerender } = renderIn(<OverviewTab data={makeData(makeState({}, { motionMode: "vector", lineStyle: "ink", voiceId: "" }))} />, "en");
    expect(screen.getByText(en("line.ink"))).toBeTruthy();
    expect(screen.getByText(en("voice.gemini"))).toBeTruthy();
    expect(screen.getByText(en("fact.line"))).toBeTruthy();
    rerender(<OverviewTab data={makeData(makeState({ style: { ...style, pack: "flat-explainer" } }, { motionMode: "vector" }))} />);
    expect(screen.getByText(tr("line.flat"))).toBeTruthy();
    rerender(<OverviewTab data={makeData(makeState({ style }, { motionMode: "vector" }))} />);
    expect(screen.getByText(tr("line.outline"))).toBeTruthy();
    expect(screen.queryByText(tr("fact.pack"))).toBeNull();
  });
});

describe("parts", () => {
  it("modeOf: seçim yoksa klip oranından türetir", () => {
    expect(modeOf({ aiClipRatio: 0 })).toBe("still");
    expect(modeOf({ aiClipRatio: 0.3 })).toBe("mixed");
    expect(modeOf({ aiClipRatio: 0, motionMode: "vector" })).toBe("vector");
  });

  it("costOf yalnız verilen aşamaları toplar", () => {
    const est = makeEstimate("still");
    expect(costOf(est, ["cast", "concept"], fmtEn)).toBe(`~${fmtEn.usd(0.5)} · ~${fmtEn.duration(90)}`);
  });

  it("StatusIcon her durum için kendi rengini, Bar değeri sınırlar, Stat alt satırı isteğe bağlı", () => {
    const statuses = ["running", "done", "error", "stalled", "waiting", "idle", "pending"] as const;
    const { container } = render(
      <div>
        {statuses.map((s) => (
          <StatusIcon key={s} status={s} />
        ))}
        <Bar value={150} />
        <Bar value={-5} tone="bg-ok" className="x" />
        <Stat label="L" value="V" />
        <Stat label="L2" value="V2" sub="alt" />
      </div>,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(statuses.length);
    expect(icons[0]!.getAttribute("class")).toContain("animate-spin");
    expect(icons[1]!.getAttribute("class")).toContain("text-ok");
    expect(icons[6]!.getAttribute("class")).toContain("text-muted");
    const bars = container.querySelectorAll<HTMLElement>("[style]");
    expect(bars[0]!.style.width).toBe("100%");
    expect(bars[1]!.style.width).toBe("0%");
    expect(bars[1]!.className).toContain("bg-ok");
    expect(screen.getByText("alt")).toBeTruthy();
  });
});
