"use client";

import { formatText } from "@ys/core/messages";
import type { ActivityEntry, Stage } from "@ys/pipeline/light";
import { AlertTriangle, ChevronRight, CircleAlert, Play } from "lucide-react";
import { useMemo, useState } from "react";
import type { Locale, MessageKey, Translate } from "../../../lib/i18n";
import type { JobView } from "../../../lib/types";
import { useI18n } from "../../locale-provider";
import { stageKey } from "./parts";

const LEVEL_STYLE: Record<ActivityEntry["level"], string> = {
  stage: "text-white font-medium",
  info: "text-muted",
  warn: "text-accent",
  error: "text-bad",
};

function LevelIcon({ level }: { level: ActivityEntry["level"] }) {
  if (level === "stage") return <Play size={11} className="mt-1 shrink-0 text-run" />;
  if (level === "warn") return <AlertTriangle size={11} className="mt-1 shrink-0 text-accent" />;
  if (level === "error") return <CircleAlert size={11} className="mt-1 shrink-0 text-bad" />;
  return <ChevronRight size={11} className="mt-1 shrink-0 text-line" />;
}

/** Pipeline'ın makine dilindeki aşama satırlarını ("▶ script", "✓ story (29 sn)") arayüz diline çevirir. */
function readable(entry: ActivityEntry, t: Translate, duration: (s: number) => string, locale: Locale): string {
  if (entry.text) return formatText(locale, entry.text);
  const start = /^▶ (\w+)/.exec(entry.msg);
  if (start) return t("act.started", { stage: t(stageKey(start[1]!)) });
  const done = /^✓ (\w+)(?: \((\d+) sn\))?/.exec(entry.msg);
  if (done) return t("act.finished", { stage: t(stageKey(done[1]!)), time: done[2] ? ` · ${duration(Number(done[2]))}` : "" });
  const wait = /^⏸ onay bekleniyor: (\w+)/.exec(entry.msg);
  if (wait) return t("act.waiting", { gate: t(wait[1] === "concept" ? "step.concept" : "step.script") });
  return entry.msg;
}

/** Tek satır: saat · aşama · mesaj. Hem canlı panelde hem günlük sekmesinde kullanılır. */
export function ActivityLine({ entry, showStage = true }: { entry: ActivityEntry; showStage?: boolean }) {
  const { t, fmt, locale } = useI18n();
  return (
    <li className="flex items-start gap-2 py-1 text-[13px] leading-snug">
      <span className="w-[70px] shrink-0 font-mono text-[11px] leading-5 text-muted/70 tabular-nums">{fmt.time(entry.at)}</span>
      <LevelIcon level={entry.level} />
      {showStage && entry.stage && entry.level !== "stage" && (
        <span className="shrink-0 rounded bg-panel-2 px-1.5 text-[11px] leading-5 text-muted">{t(stageKey(entry.stage))}</span>
      )}
      <span className={`min-w-0 break-words whitespace-pre-wrap ${LEVEL_STYLE[entry.level]}`}>{readable(entry, t, fmt.duration, locale)}</span>
    </li>
  );
}

export function ActivityTab({
  activity,
  job,
  stage,
  onStage,
}: {
  activity: ActivityEntry[];
  job: JobView | null;
  stage?: Stage;
  onStage: (s: Stage | undefined) => void;
}) {
  const { t } = useI18n();
  const [warnOnly, setWarnOnly] = useState(false);
  const stages = useMemo(() => [...new Set(activity.map((a) => a.stage).filter((s): s is Stage => Boolean(s)))], [activity]);
  const rows = activity
    .filter((a) => !stage || a.stage === stage)
    .filter((a) => !warnOnly || a.level === "warn" || a.level === "error")
    .slice()
    .reverse();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={`chip ${!stage ? "chip-on" : ""}`} onClick={() => onStage(undefined)}>
          {t("act.all")}
        </button>
        {stages.map((s) => (
          <button key={s} className={`chip ${stage === s ? "chip-on" : ""}`} onClick={() => onStage(s)}>
            {t(stageKey(s))}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <button className={`chip ${warnOnly ? "chip-on" : ""}`} onClick={() => setWarnOnly(!warnOnly)}>
          <AlertTriangle size={12} /> {t("act.warn")}
        </button>
        <span className="ml-auto text-xs text-muted">{t("act.count", { n: rows.length })}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("act.empty")}</p>
      ) : (
        <ul className="max-h-[560px] divide-y divide-line/40 overflow-auto rounded-xl border border-line bg-ink/60 px-3 py-1">
          {rows.map((e, i) => (
            <ActivityLine key={`${e.at}-${i}`} entry={e} showStage={!stage} />
          ))}
        </ul>
      )}
      {job && job.log.length > 0 && (
        <details className="rounded-xl border border-line bg-panel-2/40">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted">
            {t("act.raw")} · {job.label.startsWith("job.") ? t(job.label as MessageKey) : job.label}
          </summary>
          <pre className="max-h-80 overflow-auto border-t border-line px-4 py-3 font-mono text-xs leading-relaxed text-muted">
            {job.log.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
