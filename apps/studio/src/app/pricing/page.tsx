import { formatText, msg, type Msg } from "@ys/core/messages";
import { describePrice, measuredLatency, type ProviderAdapter, type Quota } from "@ys/media-gateway";
import type { MessageKey } from "../../lib/i18n";
import { getI18n } from "../../lib/locale";
import { catalog, ledgerEntries, quotaOf } from "../../lib/server";

export const dynamic = "force-dynamic";

const QUOTA_UNIT: Record<Quota["unit"], Msg> = { chars: msg("unit.chars"), credits: msg("unit.credits"), usd: msg("unit.usd") };

export default async function PricingPage() {
  const { providers, skipped } = catalog();
  const { t, fmt, locale } = await getI18n();
  const { duration, number } = fmt;
  const latency = measuredLatency(await ledgerEntries());
  const quotas = new Map<string, Quota | undefined>(
    await Promise.all(
      providers.filter((p) => p.quota).map(async (p) => [p.id, await quotaOf(p.id).catch(() => undefined)] as const),
    ),
  );

  // Yetenek başına grupla; her grupta ucuzdan pahalıya.
  const groups = new Map<string, ProviderAdapter[]>();
  for (const p of providers) {
    const key = p.capabilities[0] ?? "—";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("pricing.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("pricing.intro")}</p>
      </div>

      {[...groups.entries()].map(([cap, list]) => (
        <section key={cap} className="card overflow-x-auto">
          <h2 className="mb-3 text-lg font-semibold">{t(`cap.${cap}` as MessageKey)}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">{t("pricing.col.provider")}</th>
                <th className="py-2 pr-3 font-medium">{t("pricing.col.caps")}</th>
                <th className="py-2 pr-3 font-medium">{t("pricing.col.price")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("pricing.col.quality")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("pricing.col.latency")}</th>
                <th className="py-2 pr-3 font-medium">{t("pricing.col.quota")}</th>
                <th className="py-2 font-medium">{t("pricing.col.source")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const lat = latency[p.id];
                const q = quotas.get(p.id);
                return (
                  <tr key={p.id} className="border-b border-line/50 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{p.id}</div>
                      {p.local && <span className="text-xs text-ok">{t("pricing.local")}</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">{p.capabilities.join(", ")}</td>
                    <td className="py-2 pr-3">{formatText(locale, describePrice(p.price))}</td>
                    <td className="py-2 pr-3 text-right">
                      <QualityBar value={p.qualityPrior} />
                    </td>
                    <td className="py-2 pr-3 text-right text-muted">
                      {lat ? (
                        <span title={t("pricing.measurements", { n: lat.n })}>
                          {duration(lat.avgMs / 1000)} <span className="text-xs">({lat.n})</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {q ? (
                        <span className={q.used >= q.limit ? "text-bad" : "text-muted"}>
                          {number(q.limit - q.used)} / {number(q.limit)} {formatText(locale, QUOTA_UNIT[q.unit])}
                          {q.plan && ` · ${q.plan}`}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-muted">
                      {p.priceSource ? (
                        <>
                          <a href={p.priceSource.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                            {new URL(p.priceSource.url).hostname}
                          </a>{" "}
                          · {p.priceSource.checked}
                          {p.priceSource.note && <div>{formatText(locale, p.priceSource.note)}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {skipped.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg font-semibold">{t("pricing.disabled")}</h2>
          <p className="mb-2 text-sm text-muted">{t("pricing.disabled.hint")}</p>
          <ul className="grid gap-1 text-sm text-muted">
            {skipped
              .map((s) => formatText(locale, s))
              .map((s) => (
                <li key={s}>{s}</li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QualityBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full bg-accent" style={{ width: `${value * 100}%` }} />
      </span>
      {value.toFixed(2)}
    </span>
  );
}
