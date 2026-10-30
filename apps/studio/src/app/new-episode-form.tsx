"use client";

import type { EpisodeEstimate, MotionMode } from "@ys/pipeline/light";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "../lib/i18n";
import { VOICES } from "../lib/voices";
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
  };
}

export function NewEpisodeForm() {
  const router = useRouter();
  const { t, fmt } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [estimates, setEstimates] = useState<Estimates>();
  const [mode, setMode] = useState<MotionMode>("animated");
  const [budget, setBudget] = useState(20);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Form değiştikçe (400 ms gecikmeyle) maliyet/süre tahminini yenile. Para harcamaz.
  function scheduleEstimate() {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
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
    scheduleEstimate();
    return () => clearTimeout(timer.current);
  }, []);

  async function submit(form: FormData) {
    setBusy(true);
    setError(undefined);
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
        budgetUsd: Number(form.get("budgetUsd")),
        vertical: form.get("vertical") === "on",
        qa: form.get("qa") === "on",
        lineStyle: form.get("lineStyle") ?? undefined,
      }),
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !body.id) {
      setError(body.error ?? t("form.failed"));
      setBusy(false);
      return;
    }
    router.push(`/episodes/${body.id}`);
  }

  const est = estimates?.[mode];
  const overBudget = est && est.totalUsd > budget;

  return (
    <form ref={formRef} action={submit} onChange={scheduleEstimate} className="card grid gap-4">
      <h2 className="text-lg font-semibold">{t("form.title")}</h2>
      <div>
        <label className="label" htmlFor="topic">{t("form.topic")}</label>
        <textarea id="topic" name="topic" required rows={3} className="field" placeholder={t("form.topic.placeholder")} />
      </div>
      <div>
        <label className="label" htmlFor="styleHint">{t("form.style")}</label>
        <input id="styleHint" name="styleHint" className="field" placeholder={t("form.style.placeholder")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
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
          <label className="label" htmlFor="motionMode">{t("form.motion")}</label>
          <select id="motionMode" name="motionMode" className="field" defaultValue="animated">
            <option value="animated">{t("motion.animated")}</option>
            <option value="mixed">{t("motion.mixed")}</option>
            <option value="still">{t("motion.still")}</option>
            <option value="vector">{t("form.motion.vector")}</option>
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
      {mode === "vector" && (
        <div>
          <label className="label" htmlFor="lineStyle">{t("form.lineStyle")}</label>
          <select id="lineStyle" name="lineStyle" className="field" defaultValue="outline">
            {(["outline", "flat", "sketch", "ink"] as const).map((s) => (
              <option key={s} value={s}>{t(`line.${s}`)}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="label" htmlFor="voiceId">{t("form.voice")}</label>
        <select id="voiceId" name="voiceId" className="field" defaultValue={VOICES[0]?.id}>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{t(v.label)}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <div>
          <label className="label" htmlFor="budgetUsd">{t("form.budget")}</label>
          <input id="budgetUsd" name="budgetUsd" type="number" min={1} defaultValue={20} className="field" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="vertical" /> {t("form.vertical")}
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="qa" defaultChecked className="mt-1" />
        <span>
          {t("form.qa")}
          <span className="block text-xs text-muted">{t("form.qa.hint")}</span>
        </span>
      </label>

      {est && estimates && (
        <div className={`rounded-xl border p-3 text-sm ${overBudget ? "border-bad/50 bg-bad/10" : "border-line bg-panel-2"}`}>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">{t("form.estCost")}</span>
            <span className="text-lg font-semibold">{fmt.usd(est.totalUsd)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">{t("form.estTime")}</span>
            <span>~{fmt.duration(est.totalSeconds)}</span>
          </div>
          <ul className="mt-2 grid gap-0.5 text-xs text-muted">
            {est.rows
              .filter((r) => r.costUsd > 0)
              .map((r) => (
                <li key={r.stage} className="flex justify-between gap-2">
                  <span className="truncate">
                    {t(`stage.${r.stage}` as MessageKey)} · {r.providerId ?? "—"}
                  </span>
                  <span>{fmt.usd(r.costUsd)}</span>
                </li>
              ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-xs text-muted">
            {MODES.filter((m) => estimates[m]).map((m) => (
              <span key={m} className={m === mode ? "text-white" : ""}>
                {m === "vector" ? t("motion.vector.short") : t(`motion.${m}`)}: {fmt.usd(estimates[m].totalUsd)}
              </span>
            ))}
          </div>
          {overBudget && <p className="mt-2 text-xs text-bad">{t("form.overBudget")}</p>}
          {est.warnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-bad">⚠ {w}</p>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn-primary justify-center" disabled={busy}>
        <Sparkles size={16} /> {busy ? t("form.submitting") : t("form.submit")}
      </button>
    </form>
  );
}
