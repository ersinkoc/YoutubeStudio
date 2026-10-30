"use client";

import type { EpisodeState, PlannedShotState } from "@ys/pipeline/light";
import { QUALITY_GATE } from "@ys/core/rules";
import { stylePackOf } from "@ys/core/styles";
import { Check, CheckSquare, ChevronLeft, ChevronRight, Clapperboard, Mic, RefreshCw, Square, Undo2, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MessageKey } from "../../../lib/i18n";
import type { EpisodeResponse, QuotaView } from "../../../lib/types";
import { VOICES } from "../../../lib/voices";
import { useI18n } from "../../locale-provider";
import { AFTER_CONCEPT, AFTER_SCRIPT, approved as isApproved, asset, costOf, type Act, modeOf } from "./parts";

const MODES = ["animated", "mixed", "still", "vector"] as const;

// ---------------- senaryo ----------------

export function ScriptTab({ data, busy, act }: { data: EpisodeResponse; busy: boolean; act: Act }) {
  const { t, fmt } = useI18n();
  const { duration, number } = fmt;
  const { state } = data;
  const est = data.estimates[modeOf(state.input)];
  const approved = isApproved(state, "script");
  if (!state.script) {
    return (
      <Empty>
        {busy ? t("script.writing") : t("script.none")}
        {!busy && (
          <button className="btn-primary" onClick={() => act({ type: "generate-script" })}>
            <Wand2 size={16} /> {t("script.generate")}
          </button>
        )}
      </Empty>
    );
  }
  const words = state.script.scenes.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
  const chars = state.script.scenes.reduce((n, s) => n + s.narration.length, 0);
  return (
    <div className="grid gap-5">
      {state.story && (
        <div className="grid gap-4 rounded-xl border border-line bg-panel-2/50 p-4 text-sm md:grid-cols-2">
          <div>
            <div className="label">{t("script.logline")}</div>
            <p className="leading-relaxed">{state.story.logline}</p>
          </div>
          <div>
            <div className="label">{t("script.hook")}</div>
            <p className="leading-relaxed text-muted">{state.story.hook}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {t("script.stats", {
            scenes: state.script.scenes.length,
            words: number(words),
            chars: number(chars),
          })}
        </span>
        {!approved && (
          <button className="btn-primary" disabled={busy} onClick={() => act({ type: "approve-script" })}>
            <Check size={16} /> {t("script.approve")} <span className="font-normal opacity-70">({costOf(est, AFTER_SCRIPT, fmt)})</span>
          </button>
        )}
        {approved && state.approvals?.script && !state.approvals?.concept && !state.input.autoApprove && (
          <button className="btn-ghost" disabled={busy} onClick={() => act({ type: "revoke-script" })}>
            <Undo2 size={16} /> {t("script.revoke")}
          </button>
        )}
      </div>
      <ol className="grid gap-3">
        {state.script.scenes.map((scene, i) => {
          const voice = state.voice?.[scene.id];
          return (
            <li key={scene.id} className="grid gap-3 rounded-xl border border-line bg-panel-2/30 p-3 md:grid-cols-[150px_1fr]">
              <div className="text-xs text-muted">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-panel-2 text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="font-mono">{scene.id}</span>
                </div>
                <div className="mt-2 leading-snug">{scene.location}</div>
                <div className="mt-1 italic">{scene.emotion}</div>
                {voice && (
                  <div className="mt-2 inline-flex items-center gap-1 text-ok">
                    <Mic size={11} /> {duration(voice.durationMs / 1000)}
                  </div>
                )}
              </div>
              <textarea
                className="field min-h-24 leading-relaxed"
                rows={Math.min(8, Math.ceil(scene.narration.length / 110) + 1)}
                defaultValue={scene.narration}
                disabled={approved || busy}
                onBlur={(e) => {
                  if (e.target.value.trim() !== scene.narration)
                    void act({
                      type: "edit-narration",
                      sceneId: scene.id,
                      narration: e.target.value,
                    });
                }}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------- oyuncular ve konsept ----------------

function QuotaBox({ q }: { q: QuotaView }) {
  const { t, fmt } = useI18n();
  const left = q.quota.limit - q.quota.used;
  const enough = left >= q.needed;
  return (
    <div className={`rounded-xl border p-3 text-sm ${enough ? "border-line bg-panel-2" : "border-bad/50 bg-bad/10"}`}>
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          {t("quota.left", {
            provider: q.providerId,
            plan: q.quota.plan ?? "plan",
            left: fmt.number(left),
            limit: fmt.number(q.quota.limit),
          })}
        </span>
        <span className={enough ? "text-ok" : "text-bad"}>
          {t("quota.needed", { n: fmt.number(q.needed) })} {enough ? "✓" : t("quota.notEnough")}
        </span>
      </div>
      {q.quota.resetsAt && <div className="mt-1 text-xs text-muted">{t("quota.resets", { date: fmt.day(q.quota.resetsAt) })}</div>}
    </div>
  );
}

export function ConceptTab({ data, busy, act }: { data: EpisodeResponse; busy: boolean; act: Act }) {
  const { t, fmt, locale } = useI18n();
  const { usd, duration } = fmt;
  const { state } = data;
  const { cast, concept, style } = state;
  const approved = isApproved(state, "concept");
  if (!cast || !concept) {
    return (
      <Empty>
        {busy ? t("concept.preparing") : t("concept.none")}
        {!busy && cast && (
          <button className="btn-primary" onClick={() => act({ type: "regenerate-concept" })}>
            <Wand2 size={16} /> {t("concept.generate")}
          </button>
        )}
      </Empty>
    );
  }
  const entities = [
    ...cast.characters.map((c) => ({
      id: c.id,
      name: c.name,
      sub: c.role,
      desc: c.visualDescription,
      kind: t("concept.character"),
      character: true,
    })),
    ...cast.locations.map((l) => ({
      id: l.id,
      name: l.name,
      sub: "",
      desc: l.visualDescription,
      kind: t("concept.location"),
      character: false,
    })),
  ];
  const missing = entities.filter((e) => !concept.selected[e.id]).length;
  const mode = modeOf(state.input);
  const est = data.estimates[mode];
  const quotaShort = data.quota && data.quota.quota.limit - data.quota.quota.used < data.quota.needed;
  const locked = approved || busy;

  return (
    <div className="grid gap-6">
      {style && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel-2/50 p-4 text-sm">
          <div className="min-w-0 flex-1">
            <div className="label">{t("concept.style")}</div>
            <div className="leading-relaxed">
              {stylePackOf(style.pack) ? <span className="font-medium">{stylePackOf(style.pack)!.name[locale]} · </span> : null}
              {style.artStyle}
            </div>
          </div>
          <div className="flex gap-1">
            {style.palette.map((c) => (
              <span key={c} title={c} className="h-7 w-7 rounded-md border border-line" style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {entities.map((e) => (
          <div key={e.id} className="rounded-xl border border-line bg-panel-2/30 p-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-muted">{e.kind}</span>
              <span className="font-medium">{e.name}</span>
              {e.sub && <span className="truncate text-sm text-muted">· {e.sub}</span>}
            </div>
            <p className="mb-3 line-clamp-2 text-xs text-muted" title={e.desc}>
              {e.desc}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(concept.candidates[e.id] ?? []).map((c, i) => {
                const selected = concept.selected[e.id]?.key === c.key;
                return (
                  <button
                    key={c.key}
                    disabled={locked}
                    onClick={() => act({ type: "select", entityId: e.id, index: i })}
                    className={`relative overflow-hidden rounded-lg border-2 bg-panel-2 transition ${selected ? "border-accent" : "border-transparent enabled:hover:border-line"} ${locked && !selected ? "opacity-50" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset(c.key)}
                      alt={t("concept.candidate", { name: e.name, n: i + 1 })}
                      className={`aspect-video w-full ${c.mimeType === "image/svg+xml" ? "object-contain p-1" : "object-cover"}`}
                    />
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink">
                        <Check size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {e.character && !locked && <ReuseFromLibrary data={data} castId={e.id} act={act} />}
          </div>
        ))}
      </div>

      {!approved && (
        <div className="flex flex-wrap gap-3">
          <button className="btn-ghost" disabled={busy} onClick={() => act({ type: "regenerate-concept" })}>
            <RefreshCw size={16} /> {t("concept.regenerate")}
          </button>
          {mode !== "vector" && (
            <button className="btn-ghost" disabled={busy || missing > 0} onClick={() => act({ type: "preview" })}>
              <Wand2 size={16} /> {t("concept.preview")}
            </button>
          )}
          {missing > 0 && <span className="self-center text-sm text-muted">{t("concept.missing", { n: missing })}</span>}
        </div>
      )}

      <QualityGate state={state} busy={busy} act={act} />

      {concept.previews && concept.previews.length > 0 && (
        <div>
          <div className="label">{t("concept.previews")}</div>
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-2">
          <div className="label">{t("concept.voice")}</div>
          <select
            className="field"
            value={state.input.voiceId ?? ""}
            disabled={busy || Boolean(state.done.voice)}
            onChange={(e) => act({ type: "change-voice", voiceId: e.target.value })}
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {t(v.label)}
              </option>
            ))}
          </select>
          {data.quota && <QuotaBox q={data.quota} />}
        </div>
        <div>
          <div className="label">{t("concept.motion")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.filter((m) => data.estimates[m]).map((m) => {
              const e = data.estimates[m];
              return (
                <button
                  key={m}
                  disabled={locked}
                  onClick={() => act({ type: "set-motion", motionMode: m })}
                  className={`rounded-xl border p-3 text-left transition ${mode === m ? "border-accent bg-accent/10" : "border-line bg-panel-2 enabled:hover:border-muted"} ${locked && mode !== m ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-between font-medium">
                    {t(`motion.${m}`)}
                    <span className="text-sm text-muted tabular-nums">~{usd(e.totalUsd)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{t(`motion.${m}.hint`)}</div>
                  <div className="mt-2 text-xs text-muted">{t("concept.prodTime", { time: duration(e.totalSeconds) })}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!approved && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          {quotaShort && <span className="text-sm text-bad">{t("concept.quotaShort")}</span>}
          <button
            className="btn-primary"
            disabled={busy || missing > 0 || Boolean(quotaShort)}
            onClick={() => act({ type: "approve-concept" })}
          >
            <Clapperboard size={16} /> {t("concept.approve")}{" "}
            <span className="font-normal opacity-70">({costOf(est, AFTER_CONCEPT, fmt)})</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- kalite kapısı ----------------

/**
 * Her SVG'nin kapı sonucu: reddedilenler önce. Çizim (reddedildiyse en iyi deneme) ve internetten bulunan referanslar
 * yan yana; adı bilmeyen denetçinin tahmini, puanlar, kusurlar ve kaynaklar.
 */
/** Kütüphanedeki (aynı stilde) onaylı bir karakteri bu kadro üyesi için kullan: yeniden çizilmez, para harcanmaz. */
function ReuseFromLibrary({ data, castId, act }: { data: EpisodeResponse; castId: string; act: Act }) {
  const { t } = useI18n();
  const taken = new Set((data.state.concept?.candidates[castId] ?? []).map((r) => r.key));
  const options = data.library.filter((l) => !taken.has(l.key));
  if (!options.length) return null;
  return (
    <select
      className="field mt-2 py-1 text-xs"
      value=""
      title={t("concept.reuseHint")}
      onChange={(e) => e.target.value && act({ type: "reuse-character", castId, key: e.target.value })}
    >
      <option value="">{t("concept.reuse", { n: options.length })}</option>
      {options.map((l) => (
        <option key={l.key} value={l.key}>
          {l.name}
          {l.episodes.length ? ` (${t("concept.reuseUsed", { n: l.episodes.length })})` : ""}
        </option>
      ))}
    </select>
  );
}

function QualityGate({ state, busy, act }: { state: EpisodeState; busy: boolean; act: Act }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const realism = state.input.realism !== false;
  const checks = Object.entries(state.assetChecks ?? {}).sort(([, a], [, b]) => Number(a.passed) - Number(b.passed));
  if (!checks.length) return null;
  const rejected = checks.filter(([, c]) => !c.passed).length;
  const shown = all ? checks : checks.slice(0, Math.max(4, rejected));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="label">{t("gate.title")}</div>
          <p className="text-xs text-muted">{t("gate.intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs" title={t("form.realism.hint")}>
            <input type="checkbox" checked={realism} disabled={busy} onChange={(e) => act({ type: "set-realism", enabled: e.target.checked })} />
            {t("gate.realismToggle")}
          </label>
          <span className={`text-xs font-medium ${rejected ? "text-bad" : "text-ok"}`}>{t("gate.summary", { passed: checks.length - rejected, rejected })}</span>
        </div>
      </div>
      {!realism && <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">{t("gate.realismOff")}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map(([key, c]) => {
          const tone = (v: number, min: number) => (v >= min ? "text-ok" : "text-bad");
          return (
            <div key={key} className={`grid gap-2 rounded-xl border p-3 ${c.passed ? "border-line bg-panel-2/30" : "border-bad/60 bg-bad/8"}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {c.name} <span className="text-xs font-normal text-muted">· {t(`gate.kind.${c.kind}` as MessageKey)}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.passed ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad"}`}>
                  {c.override ? t(c.override.decision === "accepted" ? "gate.humanAccepted" : "gate.humanRejected") : c.passed ? t("gate.passed") : t("gate.rejected")}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs tabular-nums">
                <span className={tone(c.recognizable, QUALITY_GATE.recognizableMin[c.kind])}>{t("gate.recognizable", { score: c.recognizable })}</span>
                {c.fidelity !== undefined && <span className={tone(c.fidelity, QUALITY_GATE.fidelityMin)}>{t("gate.fidelity", { score: c.fidelity })}</span>}
                <span className="text-muted">{t("gate.attempts", { n: c.attempts })}</span>
              </div>
              {c.guess && <div className="text-xs text-muted">{t("gate.guess", { guess: c.guess })}</div>}
              <div className="grid grid-cols-4 gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset(c.rejectedKey ?? key)}
                  alt={c.name}
                  className={`aspect-square w-full rounded-md border bg-white object-contain p-1 ${c.passed ? "border-accent/50" : "border-bad"}`}
                />
                {c.refs.slice(0, 3).map((r, i) => (
                  <a key={r} href={c.sources[i]?.url} target="_blank" rel="noreferrer noopener" title={c.sources[i]?.title}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset(r)} alt={c.sources[i]?.title ?? ""} className="aspect-square w-full rounded-md bg-panel-2 object-cover" />
                  </a>
                ))}
              </div>
              {c.defects.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-muted">
                  {c.defects.slice(0, 4).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              {c.plan && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer hover:text-white">{t("gate.plan")}</summary>
                  <div className="mt-1 grid gap-0.5">
                    <div className="text-white/90">{c.plan.subject}</div>
                    {c.plan.cues.length > 0 && <div>{t("gate.planCues", { items: c.plan.cues.join(" · ") })}</div>}
                    {c.plan.moved.length > 0 && <div className="text-accent">{t("gate.planMoved", { items: c.plan.moved.join(" · ") })}</div>}
                  </div>
                </details>
              )}
              {c.override?.note && <div className="text-xs text-accent">{t("gate.note", { note: c.override.note })}</div>}
              <HumanDecision checkKey={key} passed={c.passed} human={c.override?.decision} busy={busy} act={act} />
              {c.sources.length > 0 && (
                <div className="text-[11px] text-muted">
                  {t("gate.sources")}
                  {c.query && ` ("${c.query}")`}:{" "}
                  {c.sources.map((src, i) => (
                    <span key={src.url}>
                      {i > 0 && " · "}
                      <a className="underline decoration-line hover:text-white" href={src.url} target="_blank" rel="noreferrer noopener">
                        {src.title}
                      </a>
                      {src.license && ` (${src.license})`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {checks.length > shown.length && (
        <button className="justify-self-start text-xs text-muted hover:text-white" onClick={() => setAll(true)}>
          {t("gate.showAll", { n: checks.length })}
        </button>
      )}
    </div>
  );
}

/** Kalite kapısı kartında insan kararı: reddedileni kabul et, ya da (geçmiş olsa da) notla reddet ve yeniden çizdir. */
function HumanDecision({
  checkKey,
  passed,
  human,
  busy,
  act,
}: {
  checkKey: string;
  passed: boolean;
  human?: "accepted" | "rejected";
  busy: boolean;
  act: Act;
}) {
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  if (rejecting) {
    return (
      <div className="grid gap-2">
        <textarea className="field min-h-16 text-xs" placeholder={t("gate.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2">
          <button
            className="btn-primary py-1 text-xs"
            disabled={busy}
            onClick={async () => {
              if (!(await act({ type: "reject-asset", key: checkKey, note }))) return;
              setRejecting(false);
            }}
          >
            {t("gate.rejectConfirm")}
          </button>
          <button className="btn-ghost py-1 text-xs" onClick={() => setRejecting(false)}>
            {t("gate.cancel")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {!passed && human !== "rejected" && (
        <button className="btn-primary py-1 text-xs" disabled={busy} onClick={() => act({ type: "accept-asset", key: checkKey })}>
          <Check size={14} /> {t("gate.accept")}
        </button>
      )}
      {human !== "rejected" && (
        <button className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => setRejecting(true)}>
          <X size={14} /> {passed ? t("gate.rejectPassed") : t("gate.redrawWithNote")}
        </button>
      )}
    </div>
  );
}

// ---------------- çekimler ----------------

/** Çekimin küçük resmi: görsel modda üretilen kare, vektör modda inceleme aşamasının render karesi. */
const thumbOf = (state: EpisodeState, id: string) => state.keyframes?.[id] ?? state.stills?.[id];

const scoreOf = (state: EpisodeState, id: string) => {
  const qa = state.qa?.[id];
  if (qa && !qa.skipped) return { score: qa.score, issues: qa.issues, bad: !qa.passed };
  const rv = state.review?.shots[id];
  return rv
    ? {
        score: rv.score,
        issues: rv.issues,
        bad: rv.score < 6 || rv.issues.length > 0,
      }
    : undefined;
};

export function ShotsTab({ data, busy, act }: { data: EpisodeResponse; busy: boolean; act: Act }) {
  const { t, fmt } = useI18n();
  const { usd } = fmt;
  const { state } = data;
  const shots = state.shots ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string>();
  const [weakOnly, setWeakOnly] = useState(false);
  const imageMode = (modeOf(state.input)) !== "vector";
  const failedQa = shots.filter((s) => state.qa?.[s.id] && !state.qa[s.id]!.passed).map((s) => s.id);
  const kfRow = data.estimates[modeOf(state.input)].rows.find((r) => r.stage === "keyframes");
  const perFrame = kfRow && kfRow.quantity ? kfRow.costUsd / kfRow.quantity : 0;
  if (!shots.length) return <Empty>{t("shots.empty")}</Empty>;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const visible = weakOnly ? shots.filter((s) => scoreOf(state, s.id)?.bad) : shots;
  const current = open ? shots.find((s) => s.id === open) : undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{t("shots.count", { n: shots.length })}</span>
        <button className={`chip ${weakOnly ? "chip-on" : ""}`} onClick={() => setWeakOnly(!weakOnly)}>
          {t("shots.weakOnly")}
        </button>
        {state.draftReview && (
          <span className="text-xs text-muted">
            {t("prod.draft", {
              avg: state.draftReview.avg.toFixed(1),
              n: state.draftReview.revisedScenes.length,
            })}
          </span>
        )}
        {imageMode && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {failedQa.length > 0 && (
              <button className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => setPicked(new Set(failedQa))}>
                {t("prod.pickFailed")} ({failedQa.length})
              </button>
            )}
            {picked.size > 0 && (
              <>
                <button className="btn-ghost py-1 text-xs" onClick={() => setPicked(new Set())}>
                  {t("prod.clear")}
                </button>
                <button
                  className="btn-primary py-1 text-xs"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await act({ type: "redraw", shotIds: [...picked] }))) return;
                    setPicked(new Set());
                  }}
                >
                  <RefreshCw size={14} />{" "}
                  {t("prod.redraw", {
                    n: picked.size,
                    usd: usd(perFrame * picked.size),
                  })}
                </button>
              </>
            )}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {visible.map((s) => (
          <ShotCard
            key={s.id}
            state={state}
            shot={s}
            index={shots.indexOf(s)}
            active={open === s.id}
            picked={picked.has(s.id)}
            onOpen={() => setOpen(open === s.id ? undefined : s.id)}
            onPick={imageMode && state.keyframes?.[s.id] && !busy ? () => toggle(s.id) : undefined}
          />
        ))}
      </div>

      {current && (
        <ShotDetail
          state={state}
          shot={current}
          index={shots.indexOf(current)}
          total={shots.length}
          onClose={() => setOpen(undefined)}
          onMove={(d) => setOpen(shots[(shots.indexOf(current) + d + shots.length) % shots.length]!.id)}
        />
      )}
    </div>
  );
}

function ShotCard({
  state,
  shot,
  index,
  active,
  picked,
  onOpen,
  onPick,
}: {
  state: EpisodeState;
  shot: PlannedShotState;
  index: number;
  active: boolean;
  picked: boolean;
  onOpen: () => void;
  onPick?: () => void;
}) {
  const { t } = useI18n();
  const thumb = thumbOf(state, shot.id);
  const sc = scoreOf(state, shot.id);
  const clip = state.clips?.[shot.id];
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border bg-panel-2 transition ${active ? "border-accent" : picked ? "border-accent/70" : sc?.bad ? "border-bad/60" : "border-line hover:border-muted"}`}
    >
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset(thumb.key)} alt={shot.id} loading="lazy" className="aspect-video w-full object-cover" />
        ) : (
          <div className="grid aspect-video place-items-center text-xs text-muted">{shot.id}</div>
        )}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
          <span className="truncate text-muted">
            <span className="font-semibold text-white">#{index + 1}</span> · {shot.sceneId}
          </span>
          <span className="shrink-0 text-muted tabular-nums">
            {((shot.endMs - shot.startMs) / 1000).toFixed(1)} {t("unit.sec")}
          </span>
        </div>
      </button>
      {sc && (
        <span
          className={`absolute top-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${sc.bad ? "text-bad" : "text-ok"}`}
        >
          {sc.score}/10{sc.issues.length ? ` · ${sc.issues.length}!` : ""}
        </span>
      )}
      {clip && (
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] text-run">
          ▶ {clip.durationSec} {t("unit.sec")}
        </span>
      )}
      {onPick && (
        <button
          type="button"
          onClick={onPick}
          aria-label={shot.id}
          className={`absolute bottom-9 left-1.5 rounded bg-black/70 p-0.5 ${picked ? "text-accent" : "text-white/70 opacity-0 group-hover:opacity-100"}`}
        >
          {picked ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
      )}
    </div>
  );
}

function ShotDetail({
  state,
  shot,
  index,
  total,
  onClose,
  onMove,
}: {
  state: EpisodeState;
  shot: PlannedShotState;
  index: number;
  total: number;
  onClose: () => void;
  onMove: (delta: number) => void;
}) {
  const { t, fmt } = useI18n();
  // Klavye: Esc kapatır, oklar önceki/sonraki çekime geçer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onMove(1);
      else if (e.key === "ArrowLeft") onMove(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onMove]);
  const thumb = thumbOf(state, shot.id);
  const qa = state.qa?.[shot.id];
  const rv = state.review?.shots[shot.id];
  const issues = [...(qa?.issues ?? []), ...(rv?.issues ?? [])];
  const scene = state.script?.scenes.find((s) => s.id === shot.sceneId);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="grid max-h-[92vh] w-full max-w-6xl gap-4 overflow-auto rounded-2xl border border-line bg-panel p-4 shadow-2xl lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        onClick={(e) => e.stopPropagation()}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset(thumb.key)} alt={shot.id} className="w-full rounded-lg bg-black" />
        ) : (
          <div className="grid aspect-video place-items-center rounded-lg bg-panel-2 text-sm text-muted">{shot.id}</div>
        )}
        <div className="grid content-start gap-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold">#{index + 1}</span>
              <span className="text-muted"> / {total} · </span>
              <span className="font-mono text-xs text-muted">{shot.id}</span>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onMove(-1)} aria-label="←">
                <ChevronLeft size={14} />
              </button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onMove(1)} aria-label="→">
                <ChevronRight size={14} />
              </button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>
                <X size={14} /> {t("shots.close")}
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-muted">{t("shots.scene")}</dt>
            <dd>
              {shot.sceneId}
              {scene && <span className="text-muted"> · {scene.location}</span>}
            </dd>
            <dt className="text-muted">{t("shots.time")}</dt>
            <dd className="tabular-nums">
              {fmt.duration(shot.startMs / 1000)} → {fmt.duration(shot.endMs / 1000)}
            </dd>
            <dt className="text-muted">{t("shots.camera")}</dt>
            <dd>
              {shot.camera}
              {shot.ambience && shot.ambience !== "none" && (
                <span className="text-muted"> · {t("prod.effect", { name: shot.ambience })}</span>
              )}
            </dd>
            {(qa || rv) && (
              <>
                <dt className="text-muted">{t("shots.score")}</dt>
                <dd className="tabular-nums">
                  {qa && !qa.skipped && t("prod.qa", { score: qa.score, n: qa.attempts })}
                  {qa && !qa.skipped && rv && " · "}
                  {rv && t("prod.review", { score: rv.score })}
                </dd>
              </>
            )}
          </dl>
          <div>
            <div className="label">{t("shots.desc")}</div>
            <p className="leading-relaxed text-muted">{shot.description}</p>
          </div>
          {issues.length > 0 && (
            <div>
              <div className="label">{t("shots.issues")}</div>
              <ul className="grid gap-1.5">
                {issues.map((i, n) => (
                  <li key={n} className="rounded-lg bg-bad/10 px-2.5 py-1.5 text-[13px]">
                    <span className="font-mono text-[11px] text-bad">{i.type}</span> <span className="text-muted">— {i.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-6 text-sm text-muted">{children}</div>
  );
}
