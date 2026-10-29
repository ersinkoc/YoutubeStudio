"use client";

import type { CostEstimate, EpisodeState, MotionMode } from "@ys/pipeline/light";
import {
  Check,
  CircleDashed,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ScrollText,
  Square,
  Undo2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

interface JobView {
  label: string;
  status: "running" | "done" | "error";
  log: string[];
  startedAt: string;
}

interface EpisodeResponse {
  state: EpisodeState;
  job: JobView | null;
  spentUsd: number;
  estimates: Record<MotionMode, CostEstimate>;
}

const asset = (key: string) => `/api/assets/${key}`;
const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;

const PRODUCTION_STAGES = [
  ["voice", "Seslendirme"],
  ["shots", "Çekim planı"],
  ["keyframes", "Kareler"],
  ["clips", "Animasyon"],
  ["timeline", "Kurgu"],
  ["render", "Render"],
] as const;

const MOTION: Record<MotionMode, { title: string; hint: string }> = {
  animated: { title: "Tamamen animasyon", hint: "Her çekim gerçek hareket. En tutarlı his." },
  mixed: { title: "Karışık", hint: "Önemli anlar animasyon, gerisi hareketli resim." },
  still: { title: "Hareketli resim", hint: "Zoom/pan ile canlandırılmış kareler. En ucuz." },
};

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

  return (
    <div className="grid gap-6">
      <Header data={data} />
      {job && <JobBar job={job} onCancel={() => act({ type: "cancel" })} onResume={() => act({ type: "resume" })} />}
      {error && <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      <Step n={1} title="Senaryo" icon={<ScrollText size={18} />} done={Boolean(state.approvals?.script)}>
        <ScriptStep state={state} busy={busy} act={act} />
      </Step>

      {state.approvals?.script && (
        <Step n={2} title="Konsept" icon={<ImageIcon size={18} />} done={Boolean(state.approvals?.concept)}>
          <ConceptStep state={state} busy={busy} act={act} estimates={data.estimates} />
        </Step>
      )}

      {state.approvals?.concept && (
        <Step n={3} title="Üretim" icon={<Clapperboard size={18} />} done={Boolean(state.done.render)}>
          <ProductionStep state={state} />
        </Step>
      )}

      {state.render && (
        <Step n={4} title="Video" icon={<Film size={18} />} done>
          <VideoStep
            id={id}
            renderedAt={state.render.at}
            poster={state.shots?.[0] && state.keyframes?.[state.shots[0].id]?.key}
          />
        </Step>
      )}
    </div>
  );
}

// ---------------- parçalar ----------------

function Header({ data }: { data: EpisodeResponse }) {
  const { state, spentUsd } = data;
  const mode = state.input.motionMode ?? "mixed";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{state.story?.title ?? state.input.topic}</h1>
        <p className="mt-1 text-sm text-muted">
          {state.input.lang.toUpperCase()} · {Math.round(state.input.targetSec / 60)} dk · {MOTION[mode].title} ·{" "}
          {state.input.tier}
        </p>
      </div>
      <div className="text-right text-sm">
        <div className="text-muted">Harcanan / tavan</div>
        <div className="font-medium">
          {usd(spentUsd)} / {usd(state.input.budgetUsd)}
        </div>
      </div>
    </div>
  );
}

function JobBar({ job, onCancel, onResume }: { job: JobView; onCancel: () => void; onResume: () => void }) {
  const [open, setOpen] = useState(false);
  const last = job.log.filter((l) => !l.startsWith("$ ")).slice(-1)[0];
  const tone = job.status === "error" ? "border-bad/50" : job.status === "done" ? "border-ok/40" : "border-accent/50";
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
          </div>
          {last && <div className="truncate text-xs text-muted">{last}</div>}
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={() => setOpen(!open)}>
          {open ? "Gizle" : "Kayıt"}
        </button>
        {job.status === "running" && (
          <button className="btn-ghost py-1 text-xs" onClick={onCancel}>
            Durdur
          </button>
        )}
        {job.status === "error" && (
          <button className="btn-ghost py-1 text-xs" onClick={onResume}>
            <RefreshCw size={14} /> Kaldığı yerden devam
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

function ScriptStep({ state, busy, act }: { state: EpisodeState; busy: boolean; act: Act }) {
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
          {state.script.scenes.length} sahne · {words} kelime
        </span>
        {approved ? (
          !state.approvals?.concept && (
            <button className="btn-ghost" disabled={busy} onClick={() => act({ type: "revoke-script" })}>
              <Undo2 size={16} /> Onayı geri al
            </button>
          )
        ) : (
          <button className="btn-primary" disabled={busy} onClick={() => act({ type: "approve-script" })}>
            <Check size={16} /> Senaryo tamam → Konsepte geç
          </button>
        )}
      </div>
    </div>
  );
}

function ConceptStep({
  state,
  busy,
  act,
  estimates,
}: {
  state: EpisodeState;
  busy: boolean;
  act: Act;
  estimates: Record<MotionMode, CostEstimate>;
}) {
  const { cast, concept, style } = state;
  const approved = Boolean(state.approvals?.concept);
  if (!cast || !concept) {
    return <p className="text-sm text-muted">{busy ? "Karakterler, mekânlar ve aday görseller hazırlanıyor… (2–4 dk)" : "Konsept henüz yok."}</p>;
  }
  const entities = [
    ...cast.characters.map((c) => ({ id: c.id, name: c.name, sub: c.role, desc: c.visualDescription, kind: "Karakter" })),
    ...cast.locations.map((l) => ({ id: l.id, name: l.name, sub: "", desc: l.visualDescription, kind: "Mekân" })),
  ];
  const missing = entities.filter((e) => !concept.selected[e.id]).length;
  const mode = state.input.motionMode ?? "mixed";

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

      <div>
        <div className="label">Hareket</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(MOTION) as MotionMode[]).map((m) => (
            <button
              key={m}
              disabled={approved || busy}
              onClick={() => act({ type: "set-motion", motionMode: m })}
              className={`rounded-xl border p-3 text-left transition ${mode === m ? "border-accent bg-accent/10" : "border-line bg-panel-2 hover:border-muted"}`}
            >
              <div className="flex items-center justify-between font-medium">
                {MOTION[m].title}
                <span className="text-sm text-muted">~{usd(estimates[m].totalUsd)}</span>
              </div>
              <div className="mt-1 text-xs text-muted">{MOTION[m].hint}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Tahmin: {estimates[mode].shots} çekim · kareler {usd(estimates[mode].keyframesUsd)} · animasyon{" "}
          {usd(estimates[mode].clipsUsd)} · ses {usd(estimates[mode].voiceUsd)}
        </p>
      </div>

      {!approved && (
        <div className="flex justify-end">
          <button className="btn-primary" disabled={busy || missing > 0} onClick={() => act({ type: "approve-concept" })}>
            <Clapperboard size={16} /> Konsept tamam → Videoyu üret
          </button>
        </div>
      )}
    </div>
  );
}

function ProductionStep({ state }: { state: EpisodeState }) {
  const shots = state.shots ?? [];
  return (
    <div className="grid gap-5">
      <ol className="flex flex-wrap gap-2">
        {PRODUCTION_STAGES.map(([key, label]) => (
          <li
            key={key}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${state.done[key] ? "bg-ok/15 text-ok" : "bg-panel-2 text-muted"}`}
          >
            {state.done[key] ? <Check size={12} /> : <CircleDashed size={12} />} {label}
          </li>
        ))}
      </ol>
      {shots.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
          {shots.map((s) => {
            const kf = state.keyframes?.[s.id];
            const clip = state.clips?.[s.id];
            return (
              <div key={s.id} className="relative overflow-hidden rounded-lg bg-panel-2" title={s.description}>
                {kf ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset(kf.key)} alt={s.id} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="grid aspect-video place-items-center text-xs text-muted">{s.id}</div>
                )}
                {clip && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[10px] text-accent">▶ animasyon</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VideoStep({ id, renderedAt, poster }: { id: string; renderedAt: string; poster?: string }) {
  const src = `/api/episodes/${id}/video?v=${encodeURIComponent(renderedAt)}`;
  return (
    <div className="grid gap-3">
      <video src={src} poster={poster && asset(poster)} controls className="w-full rounded-xl bg-black" />
      <div className="flex justify-end">
        <a className="btn-ghost" href={`${src}&download`}>
          <Download size={16} /> MP4 indir
        </a>
      </div>
    </div>
  );
}
