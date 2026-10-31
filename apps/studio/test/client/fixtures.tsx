// İstemci bileşeni testleri için ortak yardımcılar: gerçekçi bölüm durumu, tahmin, API yanıtı ve dil sağlayıcısı.
import type { EpisodeEstimate, EpisodeInput, EpisodeState, EstimateRow, MotionMode } from "@ys/pipeline/light";
import { newEpisodeState } from "@ys/pipeline/light";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { formatters, translator, type Locale } from "../../src/lib/i18n.ts";
import type { EpisodeResponse } from "../../src/lib/types.ts";
import { LocaleProvider } from "../../src/app/locale-provider.tsx";

export const tr = translator("tr");
export const en = translator("en");
export const fmtTr = formatters("tr");
export const fmtEn = formatters("en");

export function renderIn(ui: ReactNode, locale: Locale = "tr") {
  return render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);
}

export function makeInput(over: Partial<EpisodeInput> = {}): EpisodeInput {
  return {
    topic: "Kahvehanelerin yasaklanması",
    lang: "tr",
    targetSec: 180,
    tier: "standard",
    aiClipRatio: 0,
    budgetUsd: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    ...over,
  };
}

export function makeState(over: Partial<EpisodeState> = {}, input: Partial<EpisodeInput> = {}): EpisodeState {
  const base = newEpisodeState(makeInput(input));
  return { ...base, id: "2026-10-31-kahve-abc123", createdAt: "2026-10-31T10:00:00.000Z", ...over };
}

export function row(over: Partial<EstimateRow> & Pick<EstimateRow, "stage">): EstimateRow {
  return { label: over.stage, quantity: 1, unit: "adet", costUsd: 0.5, seconds: 60, done: false, basis: "varsayılan", ...over };
}

export function makeEstimate(mode: MotionMode, over: Partial<EpisodeEstimate> = {}): EpisodeEstimate {
  const rows = over.rows ?? [
    row({ stage: "script", providerId: "claude", costUsd: 0.1, seconds: 90 }),
    row({ stage: "cast", costUsd: 0.2, seconds: 30 }),
    row({ stage: "concept", providerId: "fal:flux", costUsd: 0.3, seconds: 60 }),
    row({ stage: "voice", providerId: "elevenlabs", costUsd: 0.4, seconds: 40 }),
    row({ stage: "keyframes", providerId: "fal:flux", quantity: 10, unit: "kare", costUsd: 1, seconds: 120 }),
  ];
  return {
    mode,
    videoSec: 180,
    shots: 10,
    rows,
    totalUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    totalSeconds: rows.reduce((n, r) => n + r.seconds, 0),
    remainingUsd: 1.5,
    remainingSeconds: 200,
    warnings: [],
    ...over,
  };
}

export function makeEstimates(): Record<MotionMode, EpisodeEstimate> {
  return {
    animated: makeEstimate("animated", { totalUsd: 9 }),
    mixed: makeEstimate("mixed", { totalUsd: 5 }),
    still: makeEstimate("still"),
    vector: makeEstimate("vector", { totalUsd: 0.8 }),
  };
}

export function makeData(state: EpisodeState, over: Partial<EpisodeResponse> = {}): EpisodeResponse {
  return {
    state,
    library: [],
    job: null,
    spentUsd: 2,
    claudeUsd: 0.75,
    estimates: makeEstimates(),
    actual: { byStage: [], byProvider: [] },
    progress: null,
    status: { status: "idle", stage: "style" },
    quota: null,
    ...over,
  };
}

/** Eylem sahtesi: sunucu kabul etti/etmedi. */
export const okAct = () => vi.fn(async (_action: Record<string, unknown>) => true);

/** Basit JSON yanıtı. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
