"use client";

import { STYLE_PACKS, stylePackOf } from "@ys/core/styles";
import type { LibraryCharacter } from "@ys/pipeline/light";
import { useEffect, useState } from "react";
import { useI18n } from "../locale-provider";

/** Bankanın iş durumu (API'nin JobView'ının istemcinin kullandığı kısmı). */
export interface BankJob {
  status: "running" | "done" | "error";
  log: string[];
}

const LINES = ["outline", "flat", "sketch", "ink"] as const;

export function CharacterBank({ initial, series, initialJob }: { initial: LibraryCharacter[]; series: string[]; initialJob: BankJob | null }) {
  const { t, locale } = useI18n();
  const [characters, setCharacters] = useState(initial);
  const [job, setJob] = useState<BankJob | null>(initialJob);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState("");
  const running = job?.status === "running";

  const reload = async () => {
    const res = await fetch("/api/characters");
    const body = (await res.json()) as { characters: LibraryCharacter[]; job: BankJob | null };
    setCharacters(body.characters);
    setJob(body.job);
  };

  // Çizim sürerken iki saniyede bir durum sorulur; bitince liste yenilenir.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [running]);

  const post = async (url: string, body: object) => {
    setError(undefined);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setError(await res.text());
      return false;
    }
    return true;
  };

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await post("/api/characters", {
      name: f.get("name"),
      description: f.get("description"),
      role: f.get("role"),
      pack: f.get("pack"),
      lineStyle: f.get("lineStyle") || undefined,
      reference: f.get("reference"),
    });
    if (ok) await reload();
  };

  const mascot = async (id: string, name: string, on: boolean) => {
    if (name.trim() && (await post("/api/characters/mascot", { id, series: name, on }))) await reload();
  };

  const packName = (id?: string) => (id && stylePackOf(id)?.name[locale]) || t("bank.custom");
  const shown = filter ? characters.filter((c) => c.pack === filter) : characters;

  return (
    <div className="grid gap-6">
      <form onSubmit={add} className="card grid gap-3">
        <h2 className="font-semibold">{t("bank.add.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="bank-name">{t("bank.add.name")}</label>
            <input id="bank-name" name="name" required maxLength={80} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="bank-role">{t("bank.add.role")}</label>
            <input id="bank-role" name="role" maxLength={80} placeholder={t("bank.add.role.hint")} className="field" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="bank-description">{t("bank.add.desc")}</label>
          <textarea id="bank-description" name="description" required maxLength={800} rows={3} className="field" />
          <p className="mt-1 text-xs text-muted">{t("bank.add.desc.hint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="bank-pack">{t("bank.add.pack")}</label>
            <select id="bank-pack" name="pack" className="field">
              {STYLE_PACKS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name[locale]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bank-line">{t("bank.add.line")}</label>
            <select id="bank-line" name="lineStyle" className="field">
              <option value="">{t("bank.add.line.pack")}</option>
              {LINES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bank-reference">{t("bank.add.reference")}</label>
            <input id="bank-reference" name="reference" maxLength={200} className="field" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn" disabled={running}>
            {t("bank.add.submit")}
          </button>
          <span className="text-xs text-muted">{t("bank.add.cost")}</span>
        </div>
        {job && (
          <div className={`text-sm ${job.status === "error" ? "text-bad" : job.status === "done" ? "text-ok" : "text-muted"}`} role="status">
            {t(job.status === "running" ? "bank.job.running" : job.status === "done" ? "bank.job.done" : "bank.job.error")}
            {job.status !== "done" && job.log.length > 0 && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs">{job.log.slice(-6).join("\n")}</pre>}
          </div>
        )}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      </form>

      <div className="flex items-center gap-3">
        <select aria-label={t("bank.add.pack")} className="field max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">{t("bank.filter.all")}</option>
          {[...new Set(characters.map((c) => c.pack).filter((p): p is string => Boolean(p)))].map((p) => (
            <option key={p} value={p}>
              {packName(p)}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t("bank.empty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((c) => (
            <CharacterCard key={c.id} c={c} series={series} packName={packName(c.pack)} onMascot={mascot} />
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterCard({
  c,
  series,
  packName,
  onMascot,
}: {
  c: LibraryCharacter;
  series: string[];
  packName: string;
  onMascot: (id: string, series: string, on: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  return (
    <div className="card grid gap-2 p-3">
      <img src={`/api/assets/${c.key}`} alt={c.name} className="h-40 w-full rounded bg-panel-2 object-contain" />
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <span className="font-medium">{c.name}</span>
        <span className="text-xs text-muted">{t("bank.episodes", { n: c.episodes.length })}</span>
      </div>
      {c.role && <div className="text-xs text-accent">{c.role}</div>}
      <div className="text-xs text-muted">
        {packName} · {c.lineStyle}
        {c.bank && <span className="ml-1 rounded bg-panel-2 px-1">{t("bank.badge.bank")}</span>}
        <span className="ml-1 font-mono">{c.id.slice(0, 8)}</span>
      </div>
      <p className="line-clamp-3 text-xs text-muted">{c.description}</p>
      {c.mascotOf.map((s) => (
        <button key={s} className="btn-ghost py-0.5 text-left text-xs" title={t("bank.mascot.remove", { series: s })} onClick={() => void onMascot(c.id, s, false)}>
          {t("bank.mascot", { series: s })} ✕
        </button>
      ))}
      {c.pack && (
        <div className="flex gap-1">
          <input
            list={`series-${c.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("bank.mascot.placeholder")}
            aria-label={t("bank.mascot.placeholder")}
            className="field min-w-0 py-1 text-xs"
          />
          <datalist id={`series-${c.id}`}>
            {series.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className="btn-ghost shrink-0 py-1 text-xs" onClick={() => void onMascot(c.id, name, true).then(() => setName(""))}>
            {t("bank.mascot.add")}
          </button>
        </div>
      )}
    </div>
  );
}
