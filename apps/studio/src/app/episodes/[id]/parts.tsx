"use client";

import type { EpisodeEstimate, EpisodeState, RunStatus, Stage } from "@ys/pipeline/light";
import { AlertTriangle, Check, CircleDashed, Hourglass, Loader2, PauseCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Formatters, MessageKey } from "../../../lib/i18n";

export const asset = (key: string) => `/api/assets/${key}`;
export const stageKey = (s: string) => `stage.${s}` as MessageKey;

/**
 * Onay kapısı geçildi mi (CLI'dan otomatik onaylı bölümler dahil). Pipeline'daki isApproved'ın istemci kopyası:
 * istemci paketi @ys/pipeline/light'ın çalışma kodunu (node:fs kullanan modüller) içeremez.
 */
export const approved = (state: EpisodeState, gate: "script" | "concept") => Boolean(state.input.autoApprove || state.approvals?.[gate]);

export type Act = (action: Record<string, unknown>) => Promise<void>;

export type Tab = "overview" | "script" | "concept" | "shots" | "costs" | "activity";
export const TABS: Tab[] = ["overview", "script", "concept", "shots", "costs", "activity"];

/** Aşama şeridindeki gruplar: senaryo ve konsept onay kapılarıyla ayrılır. */
export const STAGE_GROUPS: { key: "pre" | "prod" | "post"; stages: Stage[] }[] = [
  { key: "pre", stages: ["style", "story", "script", "cast", "concept"] },
  {
    key: "prod",
    stages: ["voice", "shots", "keyframes", "clips", "timeline", "render"],
  },
  { key: "post", stages: ["review"] },
];

export const AFTER_SCRIPT: Stage[] = ["cast", "concept"];
export const AFTER_CONCEPT: Stage[] = ["voice", "shots", "keyframes", "clips", "timeline", "render", "review"];

/** Verilen aşamaların tahmini toplamı: "~$1.20 · ~4 dk". */
export function costOf(est: EpisodeEstimate, stages: Stage[], { usd, duration }: Formatters): string {
  const rows = est.rows.filter((r) => stages.includes(r.stage));
  const cost = rows.reduce((n, r) => n + r.costUsd, 0);
  const sec = rows.reduce((n, r) => n + r.seconds, 0);
  return `~${usd(cost)} · ~${duration(sec)}`;
}

/** Aşama ya da bölüm durumunun rengi ve simgesi; her yerde aynı dil. */
export const STATUS_TONE: Record<RunStatus | "pending", { text: string; bg: string; border: string }> = {
  running: { text: "text-run", bg: "bg-run/12", border: "border-run/50" },
  stalled: { text: "text-bad", bg: "bg-bad/12", border: "border-bad/50" },
  error: { text: "text-bad", bg: "bg-bad/12", border: "border-bad/50" },
  waiting: {
    text: "text-accent",
    bg: "bg-accent/12",
    border: "border-accent/50",
  },
  done: { text: "text-ok", bg: "bg-ok/12", border: "border-ok/40" },
  idle: { text: "text-muted", bg: "bg-panel-2", border: "border-line" },
  pending: { text: "text-muted", bg: "bg-panel-2", border: "border-line" },
};

export function StatusIcon({ status, size = 14 }: { status: RunStatus | "pending"; size?: number }) {
  const cls = STATUS_TONE[status].text;
  switch (status) {
    case "running":
      return <Loader2 size={size} className={`animate-spin ${cls}`} />;
    case "done":
      return <Check size={size} className={cls} />;
    case "error":
    case "stalled":
      return <AlertTriangle size={size} className={cls} />;
    case "waiting":
      return <PauseCircle size={size} className={cls} />;
    case "idle":
      return <Hourglass size={size} className={cls} />;
    default:
      return <CircleDashed size={size} className={cls} />;
  }
}

export function Badge({ status, children }: { status: RunStatus; children: ReactNode }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.text} ${tone.bg} ${tone.border}`}
    >
      <StatusIcon status={status} size={12} />
      {children}
    </span>
  );
}

export function Bar({ value, tone = "bg-accent", className = "" }: { value: number; tone?: string; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-panel-2 ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-2.5">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
