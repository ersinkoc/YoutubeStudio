"use client";

import { formatText } from "@ys/core/messages";
import type { EpisodeEstimate, LibraryCharacter, MotionMode, SeriesSummary } from "@ys/pipeline/light";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { STYLE_AUTO, STYLE_CUSTOM, STYLE_PACKS, stylePackOf } from "@ys/core/styles";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { MessageKey } from "../lib/i18n";
import { VOICES } from "../lib/voices";
import { errorKey } from "../lib/errors";
import { providerText } from "../lib/text";
import { useI18n } from "./locale-provider";

const LANGS = ["tr", "en", "es", "pt-BR", "de", "fr", "ar", "hi", "ja", "id"];

const MODES: MotionMode[] = ["animated", "mixed", "still", "vector"];

type Estimates = Record<MotionMode, EpisodeEstimate>;

/** Formdaki tahmine etki eden alanlar. */
function estimateInput(form: HTMLFormElement) {
  const f = new FormData(form);
  return {
    lang: f.get("lang"),
    minutes: Number(f.get("minutes")),
    tier: f.get("tier"),
    motionMode: f.get("motionMode"),
    voiceId: f.get("voiceId"),
    budgetUsd: Number(f.get("budgetUsd")),
    vertical: f.get("vertical") === "on",
    qa: f.get("qa") === "on",
    realism: f.get("realism") === "on",
    sideViews: f.get("sideViews") === "on",
  };
}

/**
 * Yeni bölüm formu (kendi sayfasında, tam genişlik): solda başlıklı ayar bölümleri, sağda kayarken yerinde duran
 * maliyet tahmini ve gönder düğmesi. Hareket modu, her modun tahmini fiyatını gösteren kartlarla seçilir.
 */
export function NewEpisodeForm({
  series = [],
  initialSeries,
  bank = [],
}: {
  series?: SeriesSummary[];
  initialSeries?: string;
  /** Karakter bankası: yalnız bugünkü bir stil paketiyle çizilmiş (stili kurulabilen, seçilebilir) karakterler. */
  bank?: LibraryCharacter[];
}) {
  const router = useRouter();
  const { t, fmt, locale } = useI18n();
  const [pack, setPack] = useState<string>(STYLE_AUTO);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [estimates, setEstimates] = useState<Estimates>();
  const [mode, setMode] = useState<MotionMode>("animated");
  const [presenter, setPresenter] = useState("");
  const [bankCast, setBankCast] = useState<string[]>([]);
  const [budget, setBudget] = useState(20);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const findSeries = (name: string) => series.find((s) => s.name.trim().toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"));
  const [matched, setMatched] = useState<SeriesSummary | undefined>(() => (initialSeries ? findSeries(initialSeries) : undefined));

  // Var olan bir seri seçilince ayarlar serinin son bölümünden doldurulur (dil, süre, mod, paket, ses, bütçe).
  function applySeries(name: string) {
    const s = findSeries(name);
    setMatched(s);
    const f = formRef.current;
    if (!s || !f) return;
    const d = s.defaults;
    const set = (field: string, value: string | number | undefined) => {
      const el = f.elements.namedItem(field) as HTMLInputElement | HTMLSelectElement | null;
      if (el && value !== undefined) el.value = String(value);
    };
    set("lang", d.lang);
    set("minutes", d.minutes);
    set("tier", d.tier);
    set("voiceId", d.voiceId);
    set("budgetUsd", d.budgetUsd);
    // Mod kartları denetimli (state): seçili kart state'ten gelir.
    if (d.motionMode) setMode(d.motionMode);
    if (d.stylePack) setPack(d.stylePack);
    scheduleEstimate();
  }

  // Form değiştikçe (400 ms gecikmeyle) maliyet/süre tahminini yenile. Para harcamaz.
  function scheduleEstimate() {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      // Savunma: form kaldırılınca zamanlayıcı temizlendiği için burada form hep bağlıdır.
      /* v8 ignore next */
      if (!formRef.current) return;
      const input = estimateInput(formRef.current);
      setMode(input.motionMode as MotionMode);
      setBudget(input.budgetUsd);
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) setEstimates((await res.json()) as Estimates);
    }, 400);
  }

  useEffect(() => {
    // Seri sayfasından açıldıysa ayarlar o serinin son bölümünden doldurulur.
    if (initialSeries) applySeries(initialSeries);
    scheduleEstimate();
    return () => clearTimeout(timer.current);
  }, []);

  async function submit(form: FormData) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: form.get("topic"),
          lang: form.get("lang"),
          minutes: Number(form.get("minutes")),
          tier: form.get("tier"),
          motionMode: form.get("motionMode"),
          voiceId: form.get("voiceId"),
          styleHint: form.get("styleHint"),
          series: form.get("series"),
          budgetUsd: Number(form.get("budgetUsd")),
          vertical: form.get("vertical") === "on",
          qa: form.get("qa") === "on",
          realism: form.get("realism") === "on",
          sideViews: form.get("sideViews") === "on",
          captions: form.get("captions") === "on",
          lineStyle: form.get("lineStyle") || undefined,
          stylePack: form.get("stylePack"),
          ...(mode === "vector" && presenter ? { presenter } : {}),
          ...(mode === "vector" && bankCast.length ? { bankCast } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        const known = body.error ? errorKey(body.error) : undefined;
        setError(known ? t(known.key, known.vars) : (body.error ?? t("form.failed")));
        setBusy(false);
        return;
      }
      router.push(`/episodes/${body.id}`);
    } catch {
      setError(t("form.failed"));
      setBusy(false);
    }
  }

  const est = estimates?.[mode];
  const overBudget = est && est.totalUsd > budget;

  return (
    <form ref={formRef} action={submit} onChange={scheduleEstimate} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-6">
        <Section title={t("form.section.topic")}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <label className="label" htmlFor="series">{t("series.field")}</label>
              <input
                id="series"
                name="series"
                list="series-list"
                maxLength={80}
                defaultValue={initialSeries}
                className="field"
                placeholder={t("series.placeholder")}
                onChange={(e) => applySeries(e.target.value)}
              />
              <datalist id="series-list">
                {series.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-muted">{matched ? t("series.inherit", { n: matched.episodes }) : t("series.hint")}</p>
            </div>
            <div>
              <label className="label" htmlFor="topic">{t("form.topic")}</label>
              <textarea id="topic" name="topic" required rows={4} className="field" placeholder={t("form.topic.placeholder")} />
            </div>
          </div>
        </Section>

        <Section title={t("form.section.look")}>
          <div role="radiogroup" aria-label={t("form.motion")} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {MODES.map((m) => (
              <label
                key={m}
                className={`cursor-pointer rounded-xl border p-3 transition ${mode === m ? "border-accent bg-accent/10" : "border-line bg-panel-2 hover:border-muted"}`}
              >
                <input type="radio" id={`motionMode-${m}`} name="motionMode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
                  <span className={mode === m ? "text-accent" : ""}>{t(`motion.${m}`)}</span>
                  {estimates?.[m] && <span className="shrink-0 text-xs text-muted tabular-nums">{fmt.usd(estimates[m].totalUsd)}</span>}
                </span>
                <span className="mt-1 block text-xs text-muted">{t(`motion.${m}.hint`)}</span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="stylePack">{t("form.stylePack")}</label>
              <div className="flex items-center gap-2">
                <select id="stylePack" name="stylePack" className="field" value={pack} onChange={(e) => setPack(e.target.value)}>
                  <option value={STYLE_AUTO}>{t("form.stylePack.auto")}</option>
                  {STYLE_PACKS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name[locale]}
                    </option>
                  ))}
                  <option value={STYLE_CUSTOM}>{t("form.stylePack.custom")}</option>
                </select>
                {stylePackOf(pack)?.palette.map((c) => (
                  <span key={c} title={c} className="h-6 w-6 shrink-0 rounded border border-line" style={{ background: c }} />
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">
                {stylePackOf(pack)
                  ? t("form.stylePack.line", { line: t(`line.${stylePackOf(pack)!.lineStyle}` as MessageKey) })
                  : t(pack === STYLE_CUSTOM ? "form.stylePack.customHint" : "form.stylePack.autoHint")}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="styleHint">{t("form.style")}</label>
              <input id="styleHint" name="styleHint" className="field" placeholder={t("form.style.placeholder")} />
            </div>
            {mode === "vector" && (
              <div>
                <label className="label" htmlFor="lineStyle">{t("form.lineStyle")}</label>
                <select id="lineStyle" name="lineStyle" className="field" defaultValue="">
                  <option value="">{t("line.pack")}</option>
                  {(["outline", "flat", "sketch", "ink"] as const).map((s) => (
                    <option key={s} value={s}>{t(`line.${s}`)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {mode === "vector" && bank.length > 0 && (
            <BankPicker bank={bank} presenter={presenter} setPresenter={setPresenter} cast={bankCast} setCast={setBankCast} />
          )}
        </Section>

        <Section title={t("form.section.voice")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="label" htmlFor="lang">{t("form.lang")}</label>
              <select id="lang" name="lang" className="field" defaultValue="tr">
                {LANGS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="minutes">{t("form.minutes")}</label>
              <input id="minutes" name="minutes" type="number" min={1} max={20} step={0.5} defaultValue={3} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="voiceId">{t("form.voice")}</label>
              <select id="voiceId" name="voiceId" className="field" defaultValue={VOICES[0]?.id}>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{t(v.label)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tier">{t("form.tier")}</label>
              <select id="tier" name="tier" className="field" defaultValue="standard">
                <option value="economy">{t("form.tier.economy")}</option>
                <option value="standard">{t("form.tier.standard")}</option>
                <option value="premium">{t("form.tier.premium")}</option>
              </select>
            </div>
          </div>
        </Section>

        <Section title={t("form.section.checks")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="budgetUsd">{t("form.budget")}</label>
              <input id="budgetUsd" name="budgetUsd" type="number" min={1} defaultValue={20} className="field" />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="vertical" /> {t("form.vertical")}
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Toggle name="captions" label={t("form.captions")} hint={t("form.captions.hint")} />
            <Toggle name="qa" defaultChecked label={t("form.qa")} hint={t("form.qa.hint")} />
            <Toggle name="realism" defaultChecked label={t("form.realism")} hint={t("form.realism.hint")} />
            <Toggle name="sideViews" label={t("form.sideViews")} hint={t("form.sideViews.hint")} />
          </div>
        </Section>
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        {est && estimates ? (
          <div className={`card grid gap-1 text-sm ${overBudget ? "border-bad/50 bg-bad/10" : ""}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-muted">{t("form.estCost")}</span>
              <span className="text-2xl font-semibold tabular-nums">{fmt.usd(est.totalUsd)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted">{t("form.estTime")}</span>
              <span>~{fmt.duration(est.totalSeconds)}</span>
            </div>
            <ul className="mt-2 grid gap-0.5 border-t border-line pt-2 text-xs text-muted">
              {est.rows
                .filter((r) => r.costUsd > 0)
                // Aynı aşama iki satır olabilir (vektörde kareler: çizim + taslak denetimi).
                .map((r, i) => (
                  <li key={`${r.stage}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">
                      {t(`stage.${r.stage}` as MessageKey)} · {providerText(locale, r)}
                    </span>
                    <span>{fmt.usd(r.costUsd)}</span>
                  </li>
                ))}
            </ul>
            {overBudget && <p className="mt-2 text-xs text-bad">{t("form.overBudget")}</p>}
            {est.warnings
              .map((w) => formatText(locale, w))
              .map((w) => (
                <p key={w} className="mt-1 text-xs text-bad">⚠ {w}</p>
              ))}
          </div>
        ) : (
          <div className="card text-sm text-muted">{t("form.estPending")}</div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <SubmitButton busy={busy} />
      </aside>
    </form>
  );
}

/** Formun başlıklı bölümü. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card grid gap-4">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Açıklamalı onay kutusu. */
function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm transition hover:border-muted">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
      <span>
        {label}
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Gönder düğmesi. Form eylemi bir geçiş (transition) içinde çalışır: eylemin içindeki setBusy(true) eylem bitene dek
 * ekrana yansımaz. Gönderim sürerken düğmeyi kilitlemek için formun kendi durumu (useFormStatus) da okunur.
 */
function SubmitButton({ busy }: { busy: boolean }) {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  const locked = busy || pending;
  return (
    <button className="btn-primary justify-center py-3 text-base" disabled={locked}>
      <Sparkles size={16} /> {locked ? t("form.submitting") : t("form.submit")}
    </button>
  );
}

/** Karakter bankasından sunucu ve kadro seçimi; seçilenlerin stili bölüme uygulanır (sunucu tarafı da denetler). */
function BankPicker({
  bank,
  presenter,
  setPresenter,
  cast,
  setCast,
}: {
  bank: LibraryCharacter[];
  presenter: string;
  setPresenter: (id: string) => void;
  cast: string[];
  setCast: (ids: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const chosen = bank.filter((c) => c.id === presenter || cast.includes(c.id));
  const styles = new Set(chosen.map((c) => `${c.pack}|${c.lineStyle}`));
  const first = chosen[0];
  return (
    <fieldset className="grid gap-2 rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-medium">{t("form.bank.title")}</legend>
      <p className="text-xs text-muted">{t("form.bank.hint")}</p>
      <div>
        <label className="label" htmlFor="presenter">{t("form.bank.presenter")}</label>
        <select id="presenter" className="field max-w-sm" value={presenter} onChange={(e) => setPresenter(e.target.value)}>
          <option value="">{t("form.bank.none")}</option>
          {bank.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.role ? ` · ${c.role}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="text-sm">{t("form.bank.cast")}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {bank
          .filter((c) => c.id !== presenter)
          .map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={cast.includes(c.id)}
                onChange={(e) => setCast(e.target.checked ? [...cast, c.id] : cast.filter((id) => id !== c.id))}
              />
              {c.name}
            </label>
          ))}
      </div>
      {styles.size > 1 ? (
        <p className="text-xs text-bad">{t("form.bank.mixed")}</p>
      ) : (
        first && (
          <p className="text-xs text-accent">
            {t("form.bank.style", { pack: stylePackOf(first.pack!)!.name[locale], line: t(`line.${first.lineStyle}` as MessageKey) })}
          </p>
        )
      )}
    </fieldset>
  );
}
