"use client";

import type { EpisodeEstimate, MotionMode } from "@ys/pipeline/light";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { duration, usd } from "../lib/format";
import { VOICES } from "../lib/voices";

const LANGS = ["tr", "en", "es", "pt-BR", "de", "fr", "ar", "hi", "ja", "id"];

const MODE_LABELS: Record<MotionMode, string> = {
  animated: "Tamamen animasyon",
  mixed: "Karışık",
  still: "Canlı resim",
};

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
      }),
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !body.id) {
      setError(body.error ?? "Oluşturulamadı");
      setBusy(false);
      return;
    }
    router.push(`/episodes/${body.id}`);
  }

  const est = estimates?.[mode];
  const overBudget = est && est.totalUsd > budget;

  return (
    <form ref={formRef} action={submit} onChange={scheduleEstimate} className="card grid gap-4">
      <h2 className="text-lg font-semibold">Yeni bölüm</h2>
      <div>
        <label className="label" htmlFor="topic">Konu</label>
        <textarea id="topic" name="topic" required rows={3} className="field" placeholder="Örn. Osmanlı'da kahvehanelerin yasaklanma hikâyesi" />
      </div>
      <div>
        <label className="label" htmlFor="styleHint">Stil ipucu (isteğe bağlı)</label>
        <input id="styleHint" name="styleHint" className="field" placeholder="Örn. Ghibli tarzı suluboya" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="lang">Dil</label>
          <select id="lang" name="lang" className="field" defaultValue="tr">
            {LANGS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="minutes">Süre (dk)</label>
          <input id="minutes" name="minutes" type="number" min={1} max={20} step={0.5} defaultValue={3} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="motionMode">Hareket</label>
          <select id="motionMode" name="motionMode" className="field" defaultValue="animated">
            <option value="animated">Tamamen animasyon</option>
            <option value="mixed">Karışık</option>
            <option value="still">Canlı resim + efekt (en ucuz)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tier">Kalite</label>
          <select id="tier" name="tier" className="field" defaultValue="standard">
            <option value="economy">Ekonomi</option>
            <option value="standard">Standart</option>
            <option value="premium">Premium</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="voiceId">Anlatıcı sesi</label>
        <select id="voiceId" name="voiceId" className="field" defaultValue={VOICES[0].id}>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <div>
          <label className="label" htmlFor="budgetUsd">Bütçe tavanı ($)</label>
          <input id="budgetUsd" name="budgetUsd" type="number" min={1} defaultValue={20} className="field" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="vertical" /> Dikey (9:16)
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="qa" defaultChecked className="mt-1" />
        <span>
          Kare kontrolü
          <span className="block text-xs text-muted">
            Her kareyi görsel model denetler; yazı, kolaj, çift karakter varsa bir kez yeniden çizer. Hatalı kareye
            animasyon parası ödenmez.
          </span>
        </span>
      </label>

      {est && estimates && (
        <div className={`rounded-xl border p-3 text-sm ${overBudget ? "border-bad/50 bg-bad/10" : "border-line bg-panel-2"}`}>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Tahmini maliyet</span>
            <span className="text-lg font-semibold">{usd(est.totalUsd)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Tahmini üretim süresi</span>
            <span>~{duration(est.totalSeconds)}</span>
          </div>
          <ul className="mt-2 grid gap-0.5 text-xs text-muted">
            {est.rows
              .filter((r) => r.costUsd > 0)
              .map((r) => (
                <li key={r.stage} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.label} · {r.providerId ?? "—"}
                  </span>
                  <span>{usd(r.costUsd)}</span>
                </li>
              ))}
          </ul>
          <div className="mt-2 flex gap-2 border-t border-line pt-2 text-xs text-muted">
            {(Object.keys(MODE_LABELS) as MotionMode[]).map((m) => (
              <span key={m} className={m === mode ? "text-white" : ""}>
                {MODE_LABELS[m]}: {usd(estimates[m].totalUsd)}
              </span>
            ))}
          </div>
          {overBudget && <p className="mt-2 text-xs text-bad">Tahmin bütçe tavanını aşıyor; üretim tavanda durur.</p>}
          {est.warnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-bad">⚠ {w}</p>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn-primary justify-center" disabled={busy}>
        <Sparkles size={16} /> {busy ? "Oluşturuluyor…" : "Senaryoyu yaz"}
      </button>
    </form>
  );
}
