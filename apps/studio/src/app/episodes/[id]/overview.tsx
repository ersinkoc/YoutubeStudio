"use client";

import { Download, Film, GraduationCap, Stethoscope } from "lucide-react";
import { useState, type ReactNode } from "react";
import { stylePackOf } from "@ys/core/styles";
import type { MessageKey } from "../../../lib/i18n";
import type { EpisodeResponse } from "../../../lib/types";
import { VOICES } from "../../../lib/voices";
import { useI18n } from "../../locale-provider";
import { asset, Bar, Stat, modeOf } from "./parts";

export function OverviewTab({ data }: { data: EpisodeResponse }) {
  const { t, fmt } = useI18n();
  const { usd, duration } = fmt;
  const { state } = data;
  const videoSec = Object.values(state.voice ?? {}).reduce((n, v) => n + v.durationMs, 0) / 1000;
  const totalUsd = data.actual.byStage.reduce((n, g) => n + g.micros, 0) / 1_000_000;
  const prodSec = Object.values(state.stats ?? {}).reduce((n, s) => n + (s?.durationMs ?? 0), 0) / 1000;
  const firstShot = state.shots?.[0]?.id;
  const poster = firstShot && (state.keyframes?.[firstShot] ?? state.stills?.[firstShot])?.key;
  const src = state.render ? `/api/episodes/${state.id}/video?v=${encodeURIComponent(state.render.at)}` : undefined;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-4">
        {src ? (
          <video
            src={src}
            poster={poster ? asset(poster) : undefined}
            controls
            className="aspect-video w-full rounded-xl border border-line bg-black"
          />
        ) : (
          <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-line bg-panel-2/30 p-6 text-center text-sm text-muted">
            <div>
              <Film size={28} className="mx-auto mb-2 opacity-50" />
              {t("ov.noVideo")}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("video.length")} value={videoSec ? duration(videoSec) : "—"} />
          <Stat label={t("video.total")} value={usd(totalUsd)} />
          <Stat label={t("video.perMin")} value={videoSec > 0 ? usd(totalUsd / (videoSec / 60)) : "—"} />
          <Stat label={t("video.prodTime")} value={prodSec ? duration(prodSec) : "—"} />
        </div>
        {src && (
          <div>
            <a className="btn-ghost" href={`${src}&download`}>
              <Download size={16} /> {t("video.download")}
            </a>
          </div>
        )}
        <Review data={data} />
      </div>
      <Facts data={data} />
    </div>
  );
}

const LESSON_PREVIEW = 5;

function Review({ data }: { data: EpisodeResponse }) {
  const { t } = useI18n();
  const [allLessons, setAllLessons] = useState(false);
  const { state } = data;
  const review = state.review;
  if (!review) {
    return (
      <Panel icon={<GraduationCap size={16} />} title={t("ov.review")}>
        <p className="text-sm text-muted">{t("ov.noReview")}</p>
      </Panel>
    );
  }
  const shots = Object.values(review.shots);
  const avg = shots.length ? shots.reduce((n, s) => n + s.score, 0) / shots.length : 0;
  const weak = shots.filter((s) => s.score < 6).length;
  const counts = new Map<string, number>();
  for (const s of shots) for (const i of s.issues) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top[0]?.[1] ?? 1;
  return (
    <Panel icon={<GraduationCap size={16} />} title={t("ov.review")}>
      <div className="grid gap-5 md:grid-cols-[180px_1fr]">
        <div className="grid content-start gap-3">
          <div>
            <div className="label">{t("ov.avg")}</div>
            <div className={`text-3xl font-semibold tabular-nums ${avg >= 7 ? "text-ok" : avg >= 5 ? "text-accent" : "text-bad"}`}>
              {avg.toFixed(1)}
              <span className="text-base text-muted">/10</span>
            </div>
            <Bar value={avg * 10} tone={avg >= 7 ? "bg-ok" : avg >= 5 ? "bg-accent" : "bg-bad"} className="mt-2" />
          </div>
          <div className="text-sm text-muted">
            {t("ov.weak")}: <span className="font-medium text-white">{weak}</span> / {shots.length}
          </div>
          {state.draftReview && (
            <div className="text-xs text-muted">
              {t("prod.draft", {
                avg: state.draftReview.avg.toFixed(1),
                n: state.draftReview.revisedScenes.length,
              })}
            </div>
          )}
        </div>
        <div>
          <div className="label">{t("ov.issues")}</div>
          <ul className="grid gap-1.5">
            {top.map(([type, n]) => (
              <li key={type} className="grid grid-cols-[150px_1fr_32px] items-center gap-2 text-[13px]">
                <span className="truncate font-mono text-xs text-muted">{type}</span>
                <Bar value={(n / max) * 100} tone="bg-bad/70" />
                <span className="text-right text-xs tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {review.lessons.length > 0 && (
        <div className="mt-5">
          <div className="label">
            {t("ov.lessons")} ({review.lessons.length})
          </div>
          <ul className="grid gap-1.5 text-sm">
            {(allLessons ? review.lessons : review.lessons.slice(0, LESSON_PREVIEW)).map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 h-fit shrink-0 rounded bg-panel-2 px-1.5 text-[11px] text-muted">
                  {t(`lessons.target.${l.target}` as MessageKey)}
                </span>
                <span className="leading-snug">{l.rule}</span>
              </li>
            ))}
          </ul>
          {review.lessons.length > LESSON_PREVIEW && (
            <button className="mt-2 text-xs text-muted hover:text-white" onClick={() => setAllLessons(!allLessons)}>
              {allLessons ? t("ov.less") : t("ov.more", { n: review.lessons.length - LESSON_PREVIEW })}
            </button>
          )}
        </div>
      )}
      {state.scriptNotes && state.scriptNotes.length > 0 && (
        <details className="mt-5">
          <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <Stethoscope size={14} /> {t("ov.scriptNotes")} ({state.scriptNotes.length})
          </summary>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted">
            {state.scriptNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function Facts({ data }: { data: EpisodeResponse }) {
  const { t, fmt, locale } = useI18n();
  const { state } = data;
  const { input } = state;
  const mode = modeOf(input);
  const pack = stylePackOf(state.style?.pack);
  const voice = VOICES.find((v) => v.id === (input.voiceId ?? ""));
  const rows: [string, ReactNode][] = [
    [t("fact.topic"), input.topic],
    [t("fact.lang"), input.lang.toUpperCase()],
    [t("fact.target"), fmt.duration(input.targetSec)],
    [t("fact.motion"), t(`motion.${mode}` as MessageKey)],
    ...(pack ? [[t("fact.pack"), pack.name[locale]] as [string, ReactNode]] : []),
    ...(mode === "vector" ? [[t("fact.line"), t(`line.${input.lineStyle ?? pack?.lineStyle ?? "outline"}` as MessageKey)] as [string, ReactNode]] : []),
    [t("fact.tier"), t(`form.tier.${input.tier}` as MessageKey)],
    [t("fact.voice"), voice ? t(voice.label) : (state.voiceProviderId ?? "—")],
    [t("fact.created"), fmt.date(state.createdAt)],
    [
      t("fact.id"),
      <span key="id" className="font-mono text-[11px] break-all">
        {state.id}
      </span>,
    ],
  ];
  return (
    <Panel title={t("ov.facts")}>
      <dl className="grid gap-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[100px_1fr] gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {state.style && (
        <div className="mt-4 flex gap-1">
          {state.style.palette.map((c) => (
            <span key={c} title={c} className="h-5 flex-1 rounded border border-line" style={{ background: c }} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="h-fit rounded-xl border border-line bg-panel-2/30 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon && <span className="text-muted">{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}
