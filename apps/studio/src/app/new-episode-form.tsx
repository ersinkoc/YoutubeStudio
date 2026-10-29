"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** ElevenLabs hazır sesleri (v3 ile çok dilli). Boş = Gemini TTS (en ucuz, zamanlama tahmini). */
const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George — sıcak hikâye anlatıcısı" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian — derin, sakin" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel — haber spikeri" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice — eğitmen" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda — profesyonel" },
  { id: "", name: "Gemini TTS — en ucuz" },
];

const LANGS = ["tr", "en", "es", "pt-BR", "de", "fr", "ar", "hi", "ja", "id"];

export function NewEpisodeForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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

  return (
    <form action={submit} className="card grid gap-4">
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
            <option value="still">Hareketli resim (ucuz)</option>
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
        <select id="voiceId" name="voiceId" className="field" defaultValue={VOICES[0]!.id}>
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
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn-primary justify-center" disabled={busy}>
        <Sparkles size={16} /> {busy ? "Oluşturuluyor…" : "Senaryoyu yaz"}
      </button>
    </form>
  );
}
