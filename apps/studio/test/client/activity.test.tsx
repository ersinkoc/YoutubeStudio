// @vitest-environment happy-dom
import type { ActivityEntry } from "@ys/pipeline/light";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityLine, ActivityTab } from "../../src/app/episodes/[id]/activity.tsx";
import { en, fmtTr, renderIn, tr } from "./fixtures.tsx";

afterEach(cleanup);

const at = "2026-10-31T10:00:00.000Z";
const entries: ActivityEntry[] = [
  { at, stage: "script", level: "stage", msg: "▶ script" },
  { at, stage: "story", level: "stage", msg: "✓ story (29 sn)" },
  { at, stage: "story", level: "stage", msg: "✓ story" },
  { at, stage: "script", level: "info", msg: "⏸ onay bekleniyor: script" },
  { at, stage: "concept", level: "warn", msg: "⏸ onay bekleniyor: concept" },
  { at, stage: "concept", level: "error", msg: "Sağlayıcı yanıt vermedi" },
  { at, level: "info", msg: "aşamasız satır" },
];

describe("ActivityLine", () => {
  it("makine dilindeki aşama satırlarını arayüz diline çevirir", () => {
    renderIn(
      <ul>
        {entries.map((e, i) => (
          <ActivityLine key={i} entry={e} />
        ))}
      </ul>,
    );
    expect(screen.getByText(tr("act.started", { stage: tr("stage.script") }))).toBeTruthy();
    expect(screen.getByText(tr("act.finished", { stage: tr("stage.story"), time: ` · ${fmtTr.duration(29)}` }))).toBeTruthy();
    expect(screen.getByText(tr("act.finished", { stage: tr("stage.story"), time: "" }))).toBeTruthy();
    expect(screen.getByText(tr("act.waiting", { gate: tr("step.script") }))).toBeTruthy();
    expect(screen.getByText(tr("act.waiting", { gate: tr("step.concept") }))).toBeTruthy();
    expect(screen.getByText("Sağlayıcı yanıt vermedi").className).toContain("text-bad");
    expect(screen.getByText("aşamasız satır")).toBeTruthy();
    // Aşama etiketi yalnız "stage" düzeyi dışındaki aşamalı satırlarda görünür.
    expect(screen.getAllByText(tr("stage.concept"))).toHaveLength(2);
    expect(screen.queryAllByText(tr("stage.story"))).toHaveLength(0);
  });

  it("showStage kapalıyken aşama etiketi yok; İngilizce çeviri", () => {
    renderIn(
      <ul>
        <ActivityLine entry={{ at, stage: "voice", level: "warn", msg: "▶ voice" }} showStage={false} />
      </ul>,
      "en",
    );
    expect(screen.getByText(en("act.started", { stage: en("stage.voice") }))).toBeTruthy();
    expect(screen.queryByText(en("stage.voice"))).toBeNull();
  });
});

describe("ActivityTab", () => {
  it("aşama çiplerini listeler, tıklayınca aşamayı seçer; uyarı süzgeci satırları azaltır", () => {
    const onStage = vi.fn();
    renderIn(<ActivityTab activity={entries} job={null} onStage={onStage} />);
    expect(screen.getByText(tr("act.count", { n: entries.length }))).toBeTruthy();
    expect(screen.getByRole("button", { name: tr("act.all") }).className).toContain("chip-on");
    fireEvent.click(screen.getByRole("button", { name: tr("stage.concept") }));
    expect(onStage).toHaveBeenCalledWith("concept");
    fireEvent.click(screen.getByRole("button", { name: tr("act.all") }));
    expect(onStage).toHaveBeenCalledWith(undefined);
    const warn = screen.getByRole("button", { name: tr("act.warn") });
    fireEvent.click(warn);
    expect(warn.className).toContain("chip-on");
    expect(screen.getByText(tr("act.count", { n: 2 }))).toBeTruthy();
  });

  it("seçili aşamaya göre süzer; satır yoksa boş mesajı", () => {
    const { rerender } = renderIn(<ActivityTab activity={entries} job={null} stage="story" onStage={() => {}} />);
    expect(screen.getByText(tr("act.count", { n: 2 }))).toBeTruthy();
    expect(screen.getByRole("button", { name: tr("stage.story") }).className).toContain("chip-on");
    rerender(<ActivityTab activity={[]} job={null} onStage={() => {}} />);
    // rerender sağlayıcısız olsa da bağlamın varsayılanı Türkçe.
    expect(screen.getByText(tr("act.empty"))).toBeTruthy();
  });

  it("işin ham çıktısını gösterir: sözlük etiketi çevrilir, düz etiket olduğu gibi", () => {
    const job = { label: "job.script", status: "running" as const, log: ["satır 1", "satır 2"], startedAt: at };
    const { rerender } = renderIn(<ActivityTab activity={[]} job={job} onStage={() => {}} />);
    expect(screen.getByText(`${tr("act.raw")} · ${tr("job.script")}`)).toBeTruthy();
    expect(screen.getByText(/satır 1\s+satır 2/)).toBeTruthy();
    rerender(<ActivityTab activity={[]} job={{ ...job, label: "Elle iş" }} onStage={() => {}} />);
    expect(screen.getByText(`${tr("act.raw")} · Elle iş`)).toBeTruthy();
    rerender(<ActivityTab activity={[]} job={{ ...job, log: [] }} onStage={() => {}} />);
    expect(screen.queryByText(new RegExp(tr("act.raw").replace(/[()]/g, "\\$&")))).toBeNull();
  });
});
