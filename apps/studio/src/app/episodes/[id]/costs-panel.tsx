"use client";

import type { CostGroup } from "@ys/media-gateway";
import { AlertTriangle } from "lucide-react";
import type { EpisodeResponse } from "../../../lib/types";
import { useI18n } from "../../locale-provider";
import { Stat, StatusIcon, stageKey } from "./parts";

export function CostsTab({ data }: { data: EpisodeResponse }) {
  const { t, fmt } = useI18n();
  const { usd, duration, number } = fmt;
  const { state } = data;
  const est = data.estimates[state.input.motionMode ?? "mixed"];
  const actual = new Map<string, CostGroup>(data.actual.byStage.map((g) => [g.key, g]));
  const actualUsd = data.actual.byStage.reduce((n, g) => n + g.micros, 0) / 1_000_000;
  const actualSec = Object.values(state.stats ?? {}).reduce((n, s) => n + (s?.durationMs ?? 0), 0) / 1000;
  // Aynı aşamanın birden çok tahmin satırı olabilir (ör. vektör kareler + taslak denetimi); gerçek değer ilk satırda.
  const seen = new Set<string>();

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("ct.col.estUsd")} value={usd(est.totalUsd)} sub={`~${duration(est.totalSeconds)}`} />
        <Stat label={t("ct.col.actUsd")} value={usd(actualUsd)} sub={actualSec > 0 ? duration(actualSec) : "—"} />
        <Stat label={t("ct.remaining")} value={`~${usd(est.remainingUsd)}`} sub={`~${duration(est.remainingSeconds)}`} />
        <Stat label={t("ep.spentCap")} value={`${usd(data.spentUsd)} / ${usd(state.input.budgetUsd)}`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel-2/60 text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-2.5 font-medium">{t("ct.col.stage")}</th>
              <th className="px-3 py-2.5 font-medium">{t("ct.col.model")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("ct.col.qty")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("ct.col.estUsd")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("ct.col.actUsd")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("ct.col.estTime")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t("ct.col.actTime")}</th>
              <th className="px-3 py-2.5 font-medium">{t("ct.col.basis")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {est.rows.map((r, i) => {
              const first = !seen.has(r.stage);
              seen.add(r.stage);
              const a = first ? actual.get(r.stage) : undefined;
              const stat = first ? state.stats?.[r.stage] : undefined;
              const running = stat && !stat.endedAt;
              const over = a && a.micros / 1_000_000 > r.costUsd * 1.5 && a.micros > 10_000;
              return (
                <tr key={`${r.stage}-${r.providerId ?? ""}-${i}`} className="hover:bg-panel-2/40">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <StatusIcon status={r.done ? "done" : running ? "running" : "pending"} />
                      {t(stageKey(r.stage))}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{r.providerId ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted tabular-nums">
                    {r.quantity && r.unit ? `${number(r.quantity)} ${r.unit}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(r.costUsd)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${over ? "text-accent" : ""}`}
                    title={
                      a
                        ? t("ct.calls", {
                            calls: a.calls,
                            cache: a.cacheHits,
                            fail: a.failures,
                          })
                        : ""
                    }
                  >
                    {a ? (
                      <span className="inline-flex items-center gap-1">
                        {over && <AlertTriangle size={12} />}
                        {usd(a.micros / 1_000_000)}
                        {a.failures > 0 && <span className="text-bad">{t("ct.failures", { n: a.failures })}</span>}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{duration(r.seconds)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {stat?.durationMs !== undefined ? duration(stat.durationMs / 1000) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{r.basis}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {est.warnings.length > 0 && (
        <ul className="grid gap-1 rounded-xl border border-bad/40 bg-bad/8 px-4 py-3 text-sm text-bad">
          {est.warnings.map((w) => (
            <li key={w} className="flex items-center gap-2">
              <AlertTriangle size={14} /> {w}
            </li>
          ))}
        </ul>
      )}

      {data.actual.byProvider.length > 0 && (
        <div className="grid gap-2">
          <div className="label">{t("costs.byProvider")}</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {data.actual.byProvider.map((g) => (
              <span key={g.key} className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-muted">
                {g.key}: <span className="font-medium text-white">{usd(g.micros / 1_000_000)}</span> · {t("ct.callCount", { n: g.calls })}
                {g.calls > 0 &&
                  g.durationMs > 0 &&
                  t("ct.avg", {
                    time: duration(g.durationMs / g.calls / 1000),
                  })}
                {g.cacheHits > 0 && t("ct.cache", { n: g.cacheHits })}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
