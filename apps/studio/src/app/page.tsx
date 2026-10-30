import Link from "next/link";
import { statusLabel } from "../lib/status";
import { runStatusOf, STAGES, type EpisodeState, type RunStatus } from "@ys/pipeline/light";
import { Film } from "lucide-react";
import type { MessageKey } from "../lib/i18n";
import { getI18n } from "../lib/locale";
import { ledgerEntries, repo } from "../lib/server";
import { Badge } from "./episodes/[id]/parts";
import { AutoRefresh } from "./auto-refresh";
import { NewEpisodeForm } from "./new-episode-form";

export const dynamic = "force-dynamic";

/** Kartın küçük resmi: ilk çekimin karesi, yoksa seçilen ilk konsept görseli. */
function thumbOf(e: EpisodeState): string | undefined {
  const first = e.shots?.[0]?.id;
  const ref = (first && (e.keyframes?.[first] ?? e.stills?.[first])) || Object.values(e.concept?.selected ?? {})[0];
  return ref ? `/api/assets/${ref.key}` : undefined;
}

const SEGMENT: Record<RunStatus | "pending", string> = {
  running: "bg-run animate-pulse",
  stalled: "bg-bad",
  error: "bg-bad",
  waiting: "bg-accent",
  done: "bg-ok",
  idle: "bg-panel-2",
  pending: "bg-panel-2",
};

export default async function Home() {
  const [all, entries, { t, fmt }] = await Promise.all([repo().list(), ledgerEntries(), getI18n()]);
  const episodes = all.filter((e) => e.input.topic !== "render demo");
  const spent = new Map<string, number>();
  for (const e of entries) if (e.episodeId && !e.cacheHit) spent.set(e.episodeId, (spent.get(e.episodeId) ?? 0) + e.estimateMicros);
  const statuses = new Map(episodes.map((e) => [e.id, runStatusOf(e)]));
  const totalUsd = [...spent.values()].reduce((n, m) => n + m, 0) / 1_000_000;
  const running = [...statuses.values()].filter((s) => s.status === "running").length;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="grid content-start gap-5">
        <AutoRefresh everyMs={running ? 4000 : 30_000} />
        <h1 className="text-2xl font-semibold tracking-tight">{t("home.title")}</h1>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label={t("home.kpi.episodes")} value={fmt.number(episodes.length)} />
          <Kpi label={t("home.kpi.videos")} value={fmt.number(episodes.filter((e) => e.render).length)} />
          <Kpi label={t("home.kpi.spent")} value={fmt.usd(totalUsd)} />
          <Kpi label={t("home.kpi.running")} value={fmt.number(running)} tone={running ? "text-run" : undefined} />
        </div>
        {episodes.length === 0 && <p className="text-muted">{t("home.empty")}</p>}
        <ul className="grid gap-3">
          {episodes.map((e) => {
            const st = statuses.get(e.id)!;
            const thumb = thumbOf(e);
            const usd = (spent.get(e.id) ?? 0) / 1_000_000;
            return (
              <li key={e.id}>
                <Link href={`/episodes/${e.id}`} className="card flex gap-4 p-3 transition hover:border-muted">
                  <div className="relative hidden aspect-video w-44 shrink-0 overflow-hidden rounded-lg bg-panel-2 sm:block">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <Film size={22} className="absolute inset-0 m-auto text-muted/40" />
                    )}
                  </div>
                  <div className="grid min-w-0 flex-1 content-between gap-2 py-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.story?.title ?? e.input.topic}</div>
                        <div className="mt-1 text-xs text-muted">
                          {e.input.lang.toUpperCase()} · {fmt.duration(e.input.targetSec)} · {t(`motion.${e.input.motionMode ?? "mixed"}` as MessageKey)} ·{" "}
                          {fmt.date(e.createdAt)}
                        </div>
                      </div>
                      <Badge status={st.status}>{statusLabel(t, st)}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <ol className="flex flex-1 gap-0.5" aria-label={t("home.stages", { done: Object.keys(e.done).length, total: STAGES.length })}>
                        {STAGES.map((s) => (
                          <li
                            key={s}
                            title={t(`stage.${s}` as MessageKey)}
                            className={`h-1.5 flex-1 rounded-full ${e.done[s] ? SEGMENT.done : st.stage === s ? SEGMENT[st.status] : SEGMENT.pending}`}
                          />
                        ))}
                      </ol>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {Object.keys(e.done).length}/{STAGES.length} · {fmt.usd(usd)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <aside>
        <NewEpisodeForm />
      </aside>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
