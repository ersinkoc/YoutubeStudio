import type { MessageLocale } from "@ys/core/messages";
import { groupCosts, unitText, type CostGroup } from "@ys/media-gateway";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Formatters, MessageKey, Translate } from "../../lib/i18n";
import { getI18n } from "../../lib/locale";
import { ledgerEntries, repo } from "../../lib/server";
import { quantityText } from "../../lib/text";

export const dynamic = "force-dynamic";

const dollars = (g: CostGroup) => g.micros / 1_000_000;
const byCost = (a: CostGroup, b: CostGroup) => b.micros - a.micros;

export default async function CostsPage() {
  const [entries, episodes, { t, fmt, locale }] = await Promise.all([ledgerEntries(), repo().list(), getI18n()]);
  const { usd, duration, number } = fmt;
  const stageName = (k: string) => (k.startsWith("cli:") || k === "—" ? k : t(`stage.${k}` as MessageKey));
  const total = groupCosts(entries, () => "total")[0];
  const byProvider = groupCosts(entries, (e) => e.providerId).sort(byCost);
  const byStage = groupCosts(entries, (e) => e.stage ?? "—")
    .sort(byCost)
    .map((g) => ({ ...g, key: stageName(g.key) }));
  const byDay = groupCosts(entries, (e) => e.at.slice(0, 10)).sort((a, b) => b.key.localeCompare(a.key));
  const byEpisode = new Map(groupCosts(entries, (e) => e.episodeId ?? "—").map((g) => [g.key, g]));

  // Bitmiş videoların dakika başı maliyeti: asıl verimlilik ölçüsü.
  const finished = episodes
    .filter((e) => e.render && e.input.topic !== "render demo")
    .map((e) => {
      const sec = Object.values(e.voice ?? {}).reduce((n, v) => n + v.durationMs, 0) / 1000;
      return { sec, usd: (byEpisode.get(e.id)?.micros ?? 0) / 1_000_000 };
    })
    .filter((f) => f.sec > 0);
  const finishedSec = finished.reduce((n, f) => n + f.sec, 0);
  const finishedUsd = finished.reduce((n, f) => n + f.usd, 0);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("costs.title")}</h1>

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label={t("costs.total")} value={usd(total ? dollars(total) : 0)} />
        <Tile
          label={t("costs.paidCalls")}
          value={number(total?.calls ?? 0)}
          sub={t("costs.cacheFail", { cache: number(total?.cacheHits ?? 0), fail: number(total?.failures ?? 0) })}
        />
        <Tile label={t("costs.finished")} value={duration(finishedSec)} sub={t("costs.episodes", { n: finished.length })} />
        <Tile label={t("costs.perMinute")} value={finishedSec > 0 ? usd(finishedUsd / (finishedSec / 60)) : "—"} />
      </div>

      <Section title={t("costs.byProvider")}>
        <GroupTable t={t} fmt={fmt} locale={locale} groups={byProvider} keyLabel={t("costs.col.provider")} units />
      </Section>

      <Section title={t("costs.byStage")}>
        <GroupTable t={t} fmt={fmt} locale={locale} groups={byStage} keyLabel={t("costs.col.stage")} />
      </Section>

      <Section title={t("costs.byEpisode")}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">{t("costs.col.episode")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("costs.col.calls")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("costs.col.video")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("costs.col.cost")}</th>
              <th className="py-2 text-right font-medium">{t("costs.col.perMin")}</th>
            </tr>
          </thead>
          <tbody>
            {episodes
              .filter((e) => byEpisode.has(e.id))
              .map((e) => {
                const g = byEpisode.get(e.id)!;
                const sec = Object.values(e.voice ?? {}).reduce((n, v) => n + v.durationMs, 0) / 1000;
                return (
                  <tr key={e.id} className="border-b border-line/50">
                    <td className="py-2 pr-3">
                      <Link href={`/episodes/${e.id}`} className="hover:text-accent">
                        {e.story?.title ?? e.input.topic}
                      </Link>
                      {e.render && <span className="ml-2 text-xs text-ok">{t("costs.videoReady")}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right text-muted">{g.calls}</td>
                    <td className="py-2 pr-3 text-right text-muted">{sec > 0 ? duration(sec) : "—"}</td>
                    <td className="py-2 pr-3 text-right">{usd(dollars(g))}</td>
                    <td className="py-2 text-right">{e.render && sec > 0 ? usd(dollars(g) / (sec / 60)) : "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Section>

      <Section title={t("costs.byDay")}>
        <GroupTable t={t} fmt={fmt} locale={locale} groups={byDay} keyLabel={t("costs.col.day")} />
      </Section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-x-auto">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Birim sütunu yalnız sağlayıcı tablosunda anlamlı; diğerlerinde birimler (görsel, saniye, karakter) karışık. */
function GroupTable({
  t,
  fmt,
  locale,
  groups,
  keyLabel,
  units,
}: {
  t: Translate;
  fmt: Formatters;
  locale: MessageLocale;
  groups: CostGroup[];
  keyLabel: string;
  units?: boolean;
}) {
  const { usd, duration, number } = fmt;
  if (groups.length === 0) return <p className="text-sm text-muted">{t("costs.empty")}</p>;
  const max = Math.max(...groups.map((g) => g.micros), 1);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted uppercase">
        <tr className="border-b border-line">
          <th className="py-2 pr-3 font-medium">{keyLabel}</th>
          <th className="py-2 pr-3 text-right font-medium">{t("costs.col.paid")}</th>
          <th className="py-2 pr-3 text-right font-medium">{t("costs.col.cache")}</th>
          <th className="py-2 pr-3 text-right font-medium">{t("costs.col.fail")}</th>
          {units && <th className="py-2 pr-3 text-right font-medium">{t("costs.col.units")}</th>}
          <th className="py-2 pr-3 text-right font-medium">{t("costs.col.avg")}</th>
          <th className="py-2 pr-3 text-right font-medium">{t("costs.col.cost")}</th>
          <th className="w-32 py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          return (
            <tr key={g.key} className="border-b border-line/50">
              <td className="py-2 pr-3">{g.key}</td>
              <td className="py-2 pr-3 text-right text-muted">{g.calls}</td>
              <td className="py-2 pr-3 text-right text-muted">{g.cacheHits || "—"}</td>
              <td className={`py-2 pr-3 text-right ${g.failures ? "text-bad" : "text-muted"}`}>{g.failures || "—"}</td>
              {units && <td className="py-2 pr-3 text-right text-muted">{g.units ? quantityText(locale, g.units, unitText(g.unitLabel ?? ""), number) : "—"}</td>}
              <td className="py-2 pr-3 text-right text-muted">{g.calls > 0 && g.durationMs > 0 ? duration(g.durationMs / g.calls / 1000) : "—"}</td>
              <td className="py-2 pr-3 text-right">{usd(dollars(g))}</td>
              <td className="py-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full bg-accent" style={{ width: `${(g.micros / max) * 100}%` }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
