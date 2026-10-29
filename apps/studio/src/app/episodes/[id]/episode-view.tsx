"use client";

import type { CostGroup } from "@ys/media-gateway";
import type { EpisodeEstimate, EpisodeState, MotionMode, Stage } from "@ys/pipeline/light";
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  RefreshCw,
  ScrollText,
  Square,
  Undo2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { duration, number, usd } from "../../../lib/format";
import type { EpisodeResponse, JobView, QuotaView } from "../../../lib/types";
import { VOICES } from "../../../lib/voices";

const asset = (key: string) => `/api/assets/${key}`;

const MOTION: Record<MotionMode, { title: string; hint: string }> = {
  animated: { title: "Tamamen animasyon", hint: "Her çekim gerçek hareket. En tutarlı his." },
  mixed: { title: "Karışık", hint: "Önemli anlar animasyon, gerisi hareketli resim." },
  still: { title: "Canlı resim + efekt", hint: "Zoom/pan ve yağmur, sis, toz, ışık gibi ücretsiz atmosfer katmanları. En ucuz." },
};

const AFTER_SCRIPT: Stage[] = ["cast", "concept"];
const AFTER_CONCEPT: Stage[] = ["voice", "shots", "keyframes", "clips", "timeline", "render"];
const PRODUCTION: Stage[] = AFTER_CONCEPT;

/** Verilen aşamaların tahmini toplamı: "~$1.20 · ~4 dk". */
function costOf(est: EpisodeEstimate, stages: Stage[]): string {
  const rows = est.rows.filter((r) => stages.includes(r.stage));
  const cost = rows.reduce((n, r) => n + r.costUsd, 0);
  const sec = rows.reduce((n, r) => n + r.seconds, 0);
  return `~${usd(cost)} · ~${duration(sec)}`;
}

export function EpisodeView({ id }: { id: string }) {
  const [data, setData] = useState<EpisodeResponse>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/episodes/${id}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as EpisodeResponse);
  }, [id]);

  const running = data?.job?.status === "running";
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), running ? 1500 : 5000);
    return () => clearInterval(t);
  }, [refresh, running]);

  const act = useCallback(
    async (action: Record<string, unknown>) => {
      setPending(true);
      setError(undefined);
      const res = await fetch(`/api/episodes/${id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? "İşlem başarısız");
      await refresh();
      setPending(false);
    },
    [id, refresh],
  );

  if (!data) return <p className="text-muted">Yükleniyor…</p>;
  const { state, job } = data;
  const busy = pending || running;
  const mode = state.input.motionMode ?? "mixed";
  const est = data.estimates[mode];

  return (
    <div className="grid gap-6">
      <Header data={data} />
      {job && <JobBar job={job} data={data} onCancel={() => act({ type: "cancel" })} />}
      {state.lastError && !running && <ErrorBanner state={state} busy={busy} act={act} />}
      {error && <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      <CostTimePanel data={data} />

      <Step n={1} title="Senaryo" icon={<ScrollText size={18} />} done={Boolean(state.approvals?.script)}>
        <ScriptStep state={state} busy={busy} act={act} nextCost={costOf(est, AFTER_SCRIPT)} />
      </Step>

      {state.approvals?.script && (
        <Step n={2} title="Konsept" icon={<ImageIcon size={18} />} done={Boolean(state.approvals?.concept)}>
          <ConceptStep data={data} busy={busy} act={act} />
        </Step>
      )}

      {state.approvals?.concept && (
        <Step n={3} title="Üretim" icon={<Clapperboard size={18} />} done={Boolean(state.done.render)}>
          <ProductionStep data={data} />
        </Step>
      )}

      {state.render && (
        <Step n={4} title="Video" icon={<Film size={18} />} done>
          <VideoStep data={data} />
        </Step>
      )}
    </div>
  );
}

// ---------------- üst kısım ----------------

function Header({ data }: { data: EpisodeResponse }) {
  const { state, spentUsd } = data;
  const mode = state.input.motionMode ?? "mixed";
  const pct = Math.min(100, (spentUsd / state.input.budgetUsd) * 100);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{state.story?.title ?? state.input.topic}</h1>
        <p className="mt-1 text-sm text-muted">
          {state.input.lang.toUpperCase()} · {Math.round(state.input.targetSec / 60)} dk · {MOTION[mode].title} ·{" "}
          {state.input.tier}
        </p>
      </div>
      <div className="w-56 text-right text-sm">
        <div className="text-muted">Harcanan / tavan</div>
        <div className="font-medium">
          {usd(spentUsd)} / {usd(state.input.budgetUsd)}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div className={`h-full ${pct > 90 ? "bg-bad" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function JobBar({ job, data, onCancel }: { job: JobView; data: EpisodeResponse; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const last = job.log.filter((l) => !l.startsWith("$ ")).slice(-1)[0];
  const p = job.status === "running" ? data.progress : null;
  const tone = job.status === "error" ? "border-bad/50" : job.status === "done" ? "border-ok/40" : "border-accent/50";
  const elapsed = ((job.endedAt ? Date.parse(job.endedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000;
  return (
    <div className={`card ${tone} py-3`}>
      <div className="flex items-center gap-3">
        {job.status === "running" ? (
          <Loader2 size={18} className="animate-spin text-accent" />
        ) : job.status === "done" ? (
          <Check size={18} className="text-ok" />
        ) : (
          <Square size={18} className="text-bad" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {job.label}
            {job.status === "done" && " — tamamlandı"}
            {job.status === "error" && " — hata"}
            <span className="ml-2 font-normal text-muted">{duration(elapsed)}</span>
          </div>
          {p && p.total > 0 ? (
            <div className="mt-1.5">
              <div className="flex justify-between text-xs text-muted">
                <span>
                  {p.label}: {p.done}/{p.total}
                </span>
                {p.etaSec !== undefined && <span>~{duration(p.etaSec)} kaldı</span>}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-accent transition-all" style={{ width: `${(p.done / p.total) * 100}%` }} />
              </div>
            </div>
          ) : (
            last && <div className="truncate text-xs text-muted">{last}</div>
          )}
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={() => setOpen(!open)}>
          {open ? "Gizle" : "Kayıt"}
        </button>
        {job.status === "running" && (
          <button className="btn-ghost py-1 text-xs" onClick={onCancel}>
            Durdur
          </button>
        )}
      </div>
      {open && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-ink p-3 text-xs leading-relaxed text-muted">
          {job.log.join("\n")}
        </pre>
      )}
    </div>
  );
}

function ErrorBanner({ state, busy, act }: { state: EpisodeState; busy: boolean; act: Act }) {
  const err = state.lastError!;
  const quota = /kota/i.test(err.message);
  return (
    <div className="card border-bad/50 bg-bad/5">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">&quot;{err.stage}&quot; aşaması durdu</div>
          <p className="mt-1 break-words text-muted">{err.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {quota && (
              <button className="btn-primary" disabled={busy} onClick={() => act({ type: "change-voice", voiceId: "" })}>
                <Mic size={16} /> Sesi Gemini TTS&apos;e çevir (kota yok, ~$0.03/1000 karakter)
              </button>
            )}
            <button className="btn-ghost" disabled={busy} onClick={() => act({ type: "resume" })}>
              <RefreshCw size={16} /> Kaldığı yerden devam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- maliyet ve süre ----------------

function CostTimePanel({ data }: { data: EpisodeResponse }) {
  const [open, setOpen] = useState(true);
  const { state } = data;
  const est = data.estimates[state.input.motionMode ?? "mixed"];
  const actual = new Map<string, CostGroup>(data.actual.byStage.map((g) => [g.key, g]));
  const actualUsd = data.actual.byStage.reduce((n, g) => n + g.micros, 0) / 1_000_000;
  const actualSec = Object.values(state.stats ?? {}).reduce((n, s) => n + (s?.durationMs ?? 0), 0) / 1000;

  return (
    <section className="card">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <h2 className="text-lg font-semibold">Maliyet ve süre</h2>
        <span className="text-sm text-muted">
          Tahmin {usd(est.totalUsd)} · {duration(est.totalSeconds)} &nbsp;|&nbsp; Gerçek {usd(actualUsd)}
          {actualSec > 0 && ` · ${duration(actualSec)}`}{" "}
          &nbsp;|&nbsp; Kalan ~{usd(est.remainingUsd)} · ~{duration(est.remainingSeconds)}
        </span>
      </button>
      {open && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Aşama</th>
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 text-right font-medium">Miktar</th>
                <th className="py-2 pr-3 text-right font-medium">Tahmin $</th>
                <th className="py-2 pr-3 text-right font-medium">Gerçek $</th>
                <th className="py-2 pr-3 text-right font-medium">Tahmin süre</th>
                <th className="py-2 pr-3 text-right font-medium">Gerçek süre</th>
                <th className="py-2 font-medium">Dayanak</th>
              </tr>
            </thead>
            <tbody>
              {est.rows.map((r) => {
                const a = actual.get(r.stage);
                const stat = state.stats?.[r.stage];
                const running = stat && !stat.endedAt;
                return (
                  <tr key={r.stage} className="border-b border-line/50">
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        {r.done ? (
                          <Check size={14} className="text-ok" />
                        ) : running ? (
                          <Loader2 size={14} className="animate-spin text-accent" />
                        ) : (
                          <CircleDashed size={14} className="text-muted" />
                        )}
                        {r.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted">{r.providerId ?? "—"}</td>
                    <td className="py-2 pr-3 text-right text-muted">
                      {r.quantity && r.unit ? `${number(r.quantity)} ${r.unit}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">{usd(r.costUsd)}</td>
                    <td className="py-2 pr-3 text-right" title={a ? `${a.calls} çağrı · ${a.cacheHits} önbellek · ${a.failures} hata` : ""}>
                      {a ? (
                        <>
                          {usd(a.micros / 1_000_000)}
                          {a.failures > 0 && <span className="ml-1 text-bad">({a.failures} hata)</span>}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{duration(r.seconds)}</td>
                    <td className="py-2 pr-3 text-right">{stat?.durationMs !== undefined ? duration(stat.durationMs / 1000) : "—"}</td>
                    <td className="py-2 text-xs text-muted">{r.basis}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {est.warnings.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm text-bad">
              {est.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {data.actual.byProvider.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {data.actual.byProvider.map((g) => (
                <span key={g.key} className="rounded-lg bg-panel-2 px-2.5 py-1 text-muted">
                  {g.key}: <span className="text-white">{usd(g.micros / 1_000_000)}</span> · {g.calls} çağrı
                  {g.calls > 0 && g.durationMs > 0 && ` · ort. ${duration(g.durationMs / g.calls / 1000)}`}
                  {g.cacheHits > 0 && ` · ${g.cacheHits} önbellek`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------- adımlar ----------------

function Step({ n, title, icon, done, children }: { n: number; title: string; icon: ReactNode; done?: boolean; children: ReactNode }) {
  return (
    <section className="card">
      <div className="mb-4 flex items-center gap-3">
        <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-semibold ${done ? "bg-ok/20 text-ok" : "bg-accent/15 text-accent"}`}>
          {done ? <Check size={16} /> : n}
        </span>
        <span className="text-muted">{icon}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

type Act = (action: Record<string, unknown>) => Promise<void>;

function ScriptStep({ state, busy, act, nextCost }: { state: EpisodeState; busy: boolean; act: Act; nextCost: string }) {
  const approved = Boolean(state.approvals?.script);
  if (!state.script) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        {busy ? "Stil, hikâye ve senaryo yazılıyor… (1–2 dk)" : "Senaryo henüz yok."}
        {!busy && (
          <button className="btn-primary" onClick={() => act({ type: "generate-script" })}>
            <Wand2 size={16} /> Senaryoyu üret
          </button>
        )}
      </div>
    );
  }
  const words = state.script.scenes.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
  const chars = state.script.scenes.reduce((n, s) => n + s.narration.length, 0);
  return (
    <div className="grid gap-4">
      {state.story && (
        <div className="rounded-xl bg-panel-2 p-4 text-sm">
          <div className="mb-1 text-xs text-muted uppercase">Logline</div>
          <p>{state.story.logline}</p>
          <div className="mt-3 mb-1 text-xs text-muted uppercase">Açılış (hook)</div>
          <p className="text-muted">{state.story.hook}</p>
        </div>
      )}
      <div className="grid gap-3">
        {state.script.scenes.map((scene) => (
          <div key={scene.id} className="grid gap-2 md:grid-cols-[120px_1fr]">
            <div className="text-xs text-muted">
              <div className="font-medium text-white">{scene.id}</div>
              <div>{scene.location}</div>
              <div>{scene.emotion}</div>
              {state.voice?.[scene.id] && <div className="mt-1 text-ok">{duration(state.voice[scene.id]!.durationMs / 1000)} ses</div>}
            </div>
            <textarea
              className="field min-h-28 leading-relaxed"
              defaultValue={scene.narration}
              disabled={approved || busy}
              onBlur={(e) => {
                if (e.target.value.trim() !== scene.narration) {
                  void act({ type: "edit-narration", sceneId: scene.id, narration: e.target.value });
                }
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {state.script.scenes.length} sahne · {number(words)} kelime · {number(chars)} karakter
        </span>
        {approved ? (
          !state.approvals?.concept && (
            <button className="btn-ghost" disabled={busy} onClick={() => act({ type: "revoke-script" })}>
              <Undo2 size={16} /> Onayı geri al
            </button>
          )
        ) : (
          <button className="btn-primary" disabled={busy} onClick={() => act({ type: "approve-script" })}>
            <Check size={16} /> Senaryo tamam → Konsepte geç <span className="font-normal opacity-70">({nextCost})</span>
          </button>
        )}
      </div>
    </div>
  );
}

function QuotaBox({ q }: { q: QuotaView }) {
  const left = q.quota.limit - q.quota.used;
  const enough = left >= q.needed;
  return (
    <div className={`rounded-xl border p-3 text-sm ${enough ? "border-line bg-panel-2" : "border-bad/50 bg-bad/10"}`}>
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          {q.providerId} kotası ({q.quota.plan ?? "plan"}): <b>{number(left)}</b> / {number(q.quota.limit)} karakter kaldı
        </span>
        <span className={enough ? "text-ok" : "text-bad"}>
          Bu bölüm için gereken: {number(q.needed)} {enough ? "✓" : "— yetmiyor"}
        </span>
      </div>
      {q.quota.resetsAt && (
        <div className="mt-1 text-xs text-muted">Yenilenme: {new Date(q.quota.resetsAt).toLocaleDateString("tr-TR")}</div>
      )}
    </div>
  );
}

function ConceptStep({ data, busy, act }: { data: EpisodeResponse; busy: boolean; act: Act }) {
  const { state } = data;
  const { cast, concept, style } = state;
  const approved = Boolean(state.approvals?.concept);
  if (!cast || !concept) {
    return <p className="text-sm text-muted">{busy ? "Karakterler, mekânlar ve aday görseller hazırlanıyor…" : "Konsept henüz yok."}</p>;
  }
  const entities = [
    ...cast.characters.map((c) => ({ id: c.id, name: c.name, sub: c.role, desc: c.visualDescription, kind: "Karakter" })),
    ...cast.locations.map((l) => ({ id: l.id, name: l.name, sub: "", desc: l.visualDescription, kind: "Mekân" })),
  ];
  const missing = entities.filter((e) => !concept.selected[e.id]).length;
  const mode = state.input.motionMode ?? "mixed";
  const est = data.estimates[mode];
  const quotaShort = data.quota && data.quota.quota.limit - data.quota.quota.used < data.quota.needed;

  return (
    <div className="grid gap-6">
      {style && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-panel-2 p-4 text-sm">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted uppercase">Stil</div>
            <div>{style.artStyle}</div>
          </div>
          <div className="flex gap-1">
            {style.palette.map((c) => (
              <span key={c} title={c} className="h-6 w-6 rounded-md border border-line" style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5">
        {entities.map((e) => (
          <div key={e.id}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="rounded-md bg-panel-2 px-2 py-0.5 text-xs text-muted">{e.kind}</span>
              <span className="font-medium">{e.name}</span>
              {e.sub && <span className="text-sm text-muted">· {e.sub}</span>}
            </div>
            <p className="mb-2 line-clamp-2 text-xs text-muted" title={e.desc}>{e.desc}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(concept.candidates[e.id] ?? []).map((c, i) => {
                const selected = concept.selected[e.id]?.key === c.key;
                return (
                  <button
                    key={c.key}
                    disabled={approved || busy}
                    onClick={() => act({ type: "select", entityId: e.id, index: i })}
                    className={`relative overflow-hidden rounded-xl border-2 transition ${selected ? "border-accent" : "border-transparent hover:border-line"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset(c.key)} alt={`${e.name} aday ${i + 1}`} className="aspect-video w-full object-cover" />
                    {selected && (
                      <span className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-ink">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!approved && (
        <div className="flex flex-wrap gap-3">
          <button className="btn-ghost" disabled={busy} onClick={() => act({ type: "regenerate-concept" })}>
            <RefreshCw size={16} /> Yeni adaylar üret
          </button>
          <button className="btn-ghost" disabled={busy || missing > 0} onClick={() => act({ type: "preview" })}>
            <Wand2 size={16} /> Seçimlerle deneme kareleri üret
          </button>
          {missing > 0 && <span className="self-center text-sm text-muted">{missing} seçim eksik</span>}
        </div>
      )}

      {concept.previews && concept.previews.length > 0 && (
        <div>
          <div className="label">Deneme kareleri</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {concept.previews.map((p) => (
              <figure key={p.key} className="overflow-hidden rounded-xl bg-panel-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset(p.key)} alt="" className="aspect-video w-full object-cover" />
                <figcaption className="line-clamp-2 p-2 text-xs text-muted">{p.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <div className="label">Anlatıcı sesi</div>
        <select
          className="field max-w-md"
          value={state.input.voiceId ?? ""}
          disabled={busy || Boolean(state.done.render)}
          onChange={(e) => act({ type: "change-voice", voiceId: e.target.value })}
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {data.quota && <QuotaBox q={data.quota} />}
      </div>

      <div>
        <div className="label">Hareket</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(MOTION) as MotionMode[]).map((m) => {
            const e = data.estimates[m];
            return (
              <button
                key={m}
                disabled={approved || busy}
                onClick={() => act({ type: "set-motion", motionMode: m })}
                className={`rounded-xl border p-3 text-left transition ${mode === m ? "border-accent bg-accent/10" : "border-line bg-panel-2 hover:border-muted"}`}
              >
                <div className="flex items-center justify-between font-medium">
                  {MOTION[m].title}
                  <span className="text-sm text-muted">~{usd(e.totalUsd)}</span>
                </div>
                <div className="mt-1 text-xs text-muted">{MOTION[m].hint}</div>
                <div className="mt-2 text-xs text-muted">Üretim süresi ~{duration(e.totalSeconds)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {!approved && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {quotaShort && <span className="text-sm text-bad">Ses kotası yetmiyor — sesi değiştir</span>}
          <button className="btn-primary" disabled={busy || missing > 0 || Boolean(quotaShort)} onClick={() => act({ type: "approve-concept" })}>
            <Clapperboard size={16} /> Konsept tamam → Videoyu üret{" "}
            <span className="font-normal opacity-70">({costOf(est, AFTER_CONCEPT)})</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProductionStep({ data }: { data: EpisodeResponse }) {
  const { state } = data;
  const shots = state.shots ?? [];
  const actual = new Map(data.actual.byStage.map((g) => [g.key, g]));
  return (
    <div className="grid gap-5">
      <ol className="flex flex-wrap gap-2">
        {PRODUCTION.map((key) => {
          const stat = state.stats?.[key];
          const a = actual.get(key);
          return (
            <li
              key={key}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${state.done[key] ? "bg-ok/15 text-ok" : stat && !stat.endedAt ? "bg-accent/15 text-accent" : "bg-panel-2 text-muted"}`}
            >
              {state.done[key] ? <Check size={12} /> : stat && !stat.endedAt ? <Loader2 size={12} className="animate-spin" /> : <CircleDashed size={12} />}
              {data.estimates[state.input.motionMode ?? "mixed"].rows.find((r) => r.stage === key)?.label}
              {stat?.durationMs !== undefined && <span className="opacity-70">· {duration(stat.durationMs / 1000)}</span>}
              {a && a.micros > 0 && <span className="opacity-70">· {usd(a.micros / 1_000_000)}</span>}
            </li>
          );
        })}
      </ol>
      {shots.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
          {shots.map((s) => {
            const kf = state.keyframes?.[s.id];
            const clip = state.clips?.[s.id];
            return (
              <div key={s.id} className="relative overflow-hidden rounded-lg bg-panel-2" title={`${s.id} · ${duration((s.endMs - s.startMs) / 1000)}${s.ambience && s.ambience !== "none" ? ` · efekt: ${s.ambience}` : ""} · ${s.description}`}>
                {kf ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset(kf.key)} alt={s.id} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="grid aspect-video place-items-center text-xs text-muted">{s.id}</div>
                )}
                <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 text-[10px] text-white">
                  {((s.endMs - s.startMs) / 1000).toFixed(1)} sn
                </span>
                {clip && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[10px] text-accent">▶ {clip.durationSec} sn</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VideoStep({ data }: { data: EpisodeResponse }) {
  const { state } = data;
  const render = state.render!;
  const src = `/api/episodes/${state.id}/video?v=${encodeURIComponent(render.at)}`;
  const poster = state.shots?.[0] && state.keyframes?.[state.shots[0].id]?.key;
  const videoSec = Object.values(state.voice ?? {}).reduce((n, v) => n + v.durationMs, 0) / 1000;
  const totalUsd = data.actual.byStage.reduce((n, g) => n + g.micros, 0) / 1_000_000;
  const prodSec = Object.values(state.stats ?? {}).reduce((n, s) => n + (s?.durationMs ?? 0), 0) / 1000;
  return (
    <div className="grid gap-3">
      <video src={src} poster={poster ? asset(poster) : undefined} controls className="w-full rounded-xl bg-black" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Stat label="Video" value={duration(videoSec)} />
          <Stat label="Toplam maliyet" value={usd(totalUsd)} />
          <Stat label="Dakika başı" value={videoSec > 0 ? usd(totalUsd / (videoSec / 60)) : "—"} />
          <Stat label="Üretim süresi" value={duration(prodSec)} />
        </div>
        <a className="btn-ghost" href={`${src}&download`}>
          <Download size={16} /> MP4 indir
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-xl bg-panel-2 px-3 py-2">
      <span className="text-muted">{label}: </span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
