"use client";

import { statusLabel } from "../../../lib/status";
import type { Stage } from "@ys/pipeline/light";
import { ArrowLeft, Mic, Play, RefreshCw, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MessageKey } from "../../../lib/i18n";
import type { EpisodeResponse } from "../../../lib/types";
import { useI18n } from "../../locale-provider";
import { ActivityLine, ActivityTab } from "./activity";
import { CostsTab } from "./costs-panel";
import { OverviewTab } from "./overview";
import { Badge, Bar, STAGE_GROUPS, STATUS_TONE, StatusIcon, stageKey, TABS, type Act, type Tab } from "./parts";
import { ConceptTab, ScriptTab, ShotsTab } from "./steps";

export function EpisodeView({ id }: { id: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<EpisodeResponse>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [tab, setTabState] = useState<Tab>();
  const [logStage, setLogStage] = useState<Stage>();
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/episodes/${id}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as EpisodeResponse);
  }, [id]);

  const live = data?.status.status === "running";
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), live ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [refresh, live]);
  // "x sn önce" ve geçen süre her saniye güncellensin.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sekme adres çubuğunda (#shots) tutulur: yenilemede ve paylaşılan bağlantıda aynı yer açılır.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.includes(h)) setTabState(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    history.replaceState(null, "", `#${next}`);
  };

  const act: Act = useCallback(
    async (action) => {
      setPending(true);
      setError(undefined);
      const res = await fetch(`/api/episodes/${id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? t("common.actionFailed"));
      await refresh();
      setPending(false);
    },
    [id, refresh, t],
  );

  if (!data) return <p className="text-muted">{t("common.loading")}</p>;
  const { state, status } = data;
  const busy = pending || status.status === "running" || data.job?.status === "running";
  // Sekme seçilmediyse bölümün durumuna göre en anlamlı olanı aç.
  const active: Tab =
    tab ??
    (status.status === "waiting"
      ? status.stage !== "voice"
        ? "script"
        : "concept"
      : status.status === "running"
        ? "activity"
        : "overview");
  const openStage = (s: Stage) => {
    setLogStage(s);
    setTab("activity");
  };

  return (
    <div className="grid gap-5">
      <Header data={data} />
      <PipelineRail data={data} onStage={openStage} />
      <LivePanel data={data} busy={busy} act={act} onTab={setTab} />
      {error && <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      <section className="card p-0">
        <nav className="flex gap-1 overflow-x-auto border-b border-line px-3" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={active === k}
              onClick={() => setTab(k)}
              className={`relative shrink-0 cursor-pointer px-3 py-3 text-sm transition ${active === k ? "text-white" : "text-muted hover:text-white"}`}
            >
              {t(`tab.${k}` as MessageKey)}
              {k === "shots" && state.shots && <span className="ml-1.5 text-xs text-muted">{state.shots.length}</span>}
              {k === "activity" && (state.activity?.length ?? 0) > 0 && (
                <span className="ml-1.5 text-xs text-muted">{state.activity!.length}</span>
              )}
              {active === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
        <div className="p-5">
          {active === "overview" && <OverviewTab data={data} />}
          {active === "script" && <ScriptTab data={data} busy={busy} act={act} />}
          {active === "concept" && <ConceptTab data={data} busy={busy} act={act} />}
          {active === "shots" && <ShotsTab data={data} busy={busy} act={act} />}
          {active === "costs" && <CostsTab data={data} />}
          {active === "activity" && <ActivityTab activity={state.activity ?? []} job={data.job} stage={logStage} onStage={setLogStage} />}
        </div>
      </section>
    </div>
  );
}

// ---------------- üst bilgi ----------------

function Header({ data }: { data: EpisodeResponse }) {
  const { t, fmt } = useI18n();
  const { state, spentUsd, claudeUsd, status } = data;
  const mode = state.input.motionMode ?? "mixed";
  const pct = Math.min(100, (spentUsd / state.input.budgetUsd) * 100);
  return (
    <div className="grid gap-3">
      <Link href="/" className="inline-flex w-fit items-center gap-1 text-xs text-muted hover:text-white">
        <ArrowLeft size={14} /> {t("nav.episodes")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{state.story?.title ?? state.input.topic}</h1>
            <Badge status={status.status}>{statusLabel(t, status)}</Badge>
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-muted">
            <span>{state.input.lang.toUpperCase()}</span>·<span>{fmt.duration(state.input.targetSec)}</span>·
            <span>{t(`motion.${mode}` as MessageKey)}</span>·<span>{t(`form.tier.${state.input.tier}` as MessageKey)}</span>
          </p>
        </div>
        <div className="w-60 text-right text-sm">
          <div className="text-xs text-muted">{t("ep.spentCap")}</div>
          <div className="font-semibold tabular-nums">
            {fmt.usd(spentUsd)} <span className="font-normal text-muted">/ {fmt.usd(state.input.budgetUsd)}</span>
          </div>
          <div className="text-[11px] text-muted" title={t("ep.claudeHint")}>
            {t("ep.claude", { usd: fmt.usd(claudeUsd) })}
          </div>
          <Bar value={pct} tone={pct > 90 ? "bg-bad" : "bg-accent"} className="mt-1.5" />
        </div>
      </div>
    </div>
  );
}

// ---------------- aşama şeridi ----------------

function PipelineRail({ data, onStage }: { data: EpisodeResponse; onStage: (s: Stage) => void }) {
  const { t, fmt } = useI18n();
  const { state, status, progress } = data;
  const est = data.estimates[state.input.motionMode ?? "mixed"];
  const actual = new Map(data.actual.byStage.map((g) => [g.key, g.micros / 1_000_000]));
  const estOf = (s: Stage) => est.rows.filter((r) => r.stage === s).reduce((n, r) => n + r.seconds, 0);

  const stageStatus = (s: Stage) => {
    if (state.done[s]) return "done" as const;
    if (status.stage === s && status.status !== "idle") return status.status;
    return "pending" as const;
  };

  return (
    <div className="card overflow-x-auto p-3">
      <div className="flex min-w-[1040px] gap-3">
        {STAGE_GROUPS.map((g) => (
          <div key={g.key} className="min-w-0" style={{ flex: g.stages.length }}>
            <div className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider text-muted/80 uppercase">
              {t(`group.${g.key}` as MessageKey)}
            </div>
            <ol className="flex gap-1.5">
              {g.stages.map((s) => {
                const st = stageStatus(s);
                const tone = STATUS_TONE[st];
                const stat = state.stats?.[s];
                const cost = actual.get(s);
                const p = progress && progress.stage === s && progress.total > 0 ? progress : undefined;
                const runningFor = st === "running" && stat ? (Date.now() - Date.parse(stat.startedAt)) / 1000 : undefined;
                return (
                  <li key={s} className="min-w-0 flex-1">
                    <button
                      onClick={() => onStage(s)}
                      title={t("pipe.open")}
                      className={`relative h-full w-full cursor-pointer overflow-hidden rounded-lg border px-2 py-1.5 text-left transition hover:brightness-125 ${tone.border} ${st === "pending" ? "bg-transparent" : tone.bg}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={st} size={12} />
                        <span
                          title={t(stageKey(s))}
                          className={`truncate text-xs font-medium ${st === "pending" ? "text-muted" : "text-white"}`}
                        >
                          {t(stageKey(s))}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted tabular-nums">
                        {runningFor !== undefined
                          ? fmt.duration(runningFor)
                          : stat?.durationMs !== undefined
                            ? fmt.duration(stat.durationMs / 1000)
                            : t("pipe.est", { v: fmt.duration(estOf(s)) })}
                      </div>
                      <div className="truncate text-[10px] text-muted tabular-nums">{cost ? fmt.usd(cost) : " "}</div>
                      {p && (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-run/20">
                          <span
                            className="block h-full bg-run transition-[width] duration-700"
                            style={{ width: `${(p.done / p.total) * 100}%` }}
                          />
                        </span>
                      )}
                      {st === "running" && !p && <span className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-run/60" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- canlı durum ----------------

function LivePanel({ data, busy, act, onTab }: { data: EpisodeResponse; busy: boolean; act: Act; onTab: (t: Tab) => void }) {
  const { t, fmt } = useI18n();
  const { state, status, progress, job } = data;
  const recent = (state.activity ?? []).slice(-6).reverse();
  const tone = STATUS_TONE[status.status];
  const stageName = status.stage ? t(stageKey(status.stage)) : "";
  const stat = status.stage ? state.stats?.[status.stage] : undefined;
  const studioJob = job?.status === "running";

  if (status.status === "done") return null;

  let headline: string;
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;
  switch (status.status) {
    case "running": {
      headline = t("live.now", { stage: stageName });
      const p = progress && progress.total > 0 ? progress : undefined;
      body = (
        <div className="grid gap-1.5">
          {status.stage && <p className="text-sm leading-snug text-muted">{t(`hint.${status.stage}` as MessageKey)}</p>}
          {p && (
            <>
              <div className="flex justify-between text-xs text-muted tabular-nums">
                <span>
                  {p.done}/{p.total}
                  {p.stage === "render" ? "%" : ""}
                </span>
                {p.etaSec !== undefined && <span>{t("live.left", { time: fmt.duration(p.etaSec) })}</span>}
              </div>
              <Bar value={(p.done / p.total) * 100} tone="bg-run" />
            </>
          )}
          <div className="flex flex-wrap gap-x-3 text-xs text-muted">
            {stat && (
              <span>
                {t("live.elapsed", {
                  time: fmt.duration((Date.now() - Date.parse(stat.startedAt)) / 1000),
                })}
              </span>
            )}
            {state.heartbeatAt && <span>{t("live.heartbeat", { ago: fmt.ago(state.heartbeatAt) })}</span>}
            {!studioJob && <span>{t("live.external")}</span>}
          </div>
        </div>
      );
      actions = studioJob && (
        <button className="btn-ghost py-1.5 text-xs" onClick={() => act({ type: "cancel" })}>
          <Square size={14} /> {t("ep.job.stop")}
        </button>
      );
      break;
    }
    case "stalled":
      headline = t("status.stalled");
      body = (
        <p className="text-sm text-muted">
          {t("live.stalled", {
            stage: stageName,
            ago: fmt.ago(state.heartbeatAt ?? stat?.startedAt ?? state.createdAt),
          })}
        </p>
      );
      actions = (
        <button className="btn-primary py-1.5 text-xs" disabled={busy && studioJob} onClick={() => act({ type: "resume" })}>
          <RefreshCw size={14} /> {t("ep.err.resume")}
        </button>
      );
      break;
    case "error": {
      const err = state.lastError!;
      const quota = /kota|quota/i.test(err.message);
      headline = t("ep.err.stopped", { stage: stageName });
      body = <p className="text-sm break-words text-muted">{err.message}</p>;
      actions = (
        <>
          {quota && (
            <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => act({ type: "change-voice", voiceId: "" })}>
              <Mic size={14} /> {t("ep.err.toGemini")}
            </button>
          )}
          <button className="btn-ghost py-1.5 text-xs" disabled={busy} onClick={() => act({ type: "resume" })}>
            <RefreshCw size={14} /> {t("ep.err.resume")}
          </button>
        </>
      );
      break;
    }
    case "waiting":
      headline = t("status.waiting");
      body = <p className="text-sm text-muted">{t(status.stage !== "voice" ? "live.waiting.script" : "live.waiting.concept")}</p>;
      actions = (
        <button className="btn-primary py-1.5 text-xs" onClick={() => onTab(status.stage !== "voice" ? "script" : "concept")}>
          {t("live.goApprove")}
        </button>
      );
      break;
    default:
      headline = t("live.idle", { stage: stageName });
      actions = state.script && (
        <button className="btn-ghost py-1.5 text-xs" disabled={busy} onClick={() => act({ type: "resume" })}>
          <Play size={14} /> {t("live.continue")}
        </button>
      );
  }

  return (
    <section className={`card grid gap-4 ${tone.border} md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`}>
      <div className="grid content-start gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={status.status} size={18} />
          <h2 className={`font-semibold ${tone.text}`}>{headline}</h2>
        </div>
        {body}
        {actions && <div className="mt-1 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">{t("live.recent")}</span>
          <button className="text-xs text-muted hover:text-white" onClick={() => onTab("activity")}>
            {t("live.allLog")} →
          </button>
        </div>
        {recent.length ? (
          <ul className="divide-y divide-line/40">
            {recent.map((e, i) => (
              <ActivityLine key={`${e.at}-${i}`} entry={e} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">{t("act.empty")}</p>
        )}
      </div>
    </section>
  );
}
