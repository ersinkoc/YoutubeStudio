import { groupCosts, type CostGroup } from "@ys/media-gateway";
import Link from "next/link";
import type { ReactNode } from "react";
import { duration, number, usd } from "../../lib/format";
import { ledgerEntries, repo } from "../../lib/server";

export const dynamic = "force-dynamic";

const dollars = (g: CostGroup) => g.micros / 1_000_000;
const byCost = (a: CostGroup, b: CostGroup) => b.micros - a.micros;

export default async function CostsPage() {
  const [entries, episodes] = await Promise.all([ledgerEntries(), repo().list()]);
  const total = groupCosts(entries, () => "toplam")[0];
  const byProvider = groupCosts(entries, (e) => e.providerId).sort(byCost);
  const byStage = groupCosts(entries, (e) => e.stage ?? "—").sort(byCost);
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
      <h1 className="text-2xl font-semibold">Maliyetler</h1>

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Toplam harcama" value={usd(total ? dollars(total) : 0)} />
        <Tile label="Ücretli API çağrısı" value={number(total?.calls ?? 0)} sub={`${number(total?.cacheHits ?? 0)} önbellekten · ${number(total?.failures ?? 0)} hata`} />
        <Tile label="Bitmiş video" value={duration(finishedSec)} sub={`${finished.length} bölüm`} />
        <Tile label="Video dakikası başına" value={finishedSec > 0 ? usd(finishedUsd / (finishedSec / 60)) : "—"} />
      </div>

      <Section title="Sağlayıcıya göre">
        <GroupTable groups={byProvider} keyLabel="Sağlayıcı" units />
      </Section>

      <Section title="Aşamaya göre">
        <GroupTable groups={byStage} keyLabel="Aşama" />
      </Section>

      <Section title="Bölüme göre">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Bölüm</th>
              <th className="py-2 pr-3 text-right font-medium">Çağrı</th>
              <th className="py-2 pr-3 text-right font-medium">Video</th>
              <th className="py-2 pr-3 text-right font-medium">Maliyet</th>
              <th className="py-2 text-right font-medium">Dakika başı</th>
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
                      {e.render && <span className="ml-2 text-xs text-ok">video hazır</span>}
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

      <Section title="Güne göre">
        <GroupTable groups={byDay} keyLabel="Gün" />
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
function GroupTable({ groups, keyLabel, units }: { groups: CostGroup[]; keyLabel: string; units?: boolean }) {
  if (groups.length === 0) return <p className="text-sm text-muted">Henüz kayıt yok.</p>;
  const max = Math.max(...groups.map((g) => g.micros), 1);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted uppercase">
        <tr className="border-b border-line">
          <th className="py-2 pr-3 font-medium">{keyLabel}</th>
          <th className="py-2 pr-3 text-right font-medium">Ücretli çağrı</th>
          <th className="py-2 pr-3 text-right font-medium">Önbellek</th>
          <th className="py-2 pr-3 text-right font-medium">Hata</th>
          {units && <th className="py-2 pr-3 text-right font-medium">Birim</th>}
          <th className="py-2 pr-3 text-right font-medium">Ort. süre</th>
          <th className="py-2 pr-3 text-right font-medium">Maliyet</th>
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
              {units && <td className="py-2 pr-3 text-right text-muted">{g.units ? `${number(g.units)} ${g.unitLabel ?? ""}` : "—"}</td>}
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
