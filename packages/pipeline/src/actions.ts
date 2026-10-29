import { getJson, putJson, type AssetStore } from "@ys/storage";
import { GATES, STAGES, type EpisodeInput, type EpisodeState, type Gate, type MotionMode } from "./state.ts";

/*
 * İnsan kararları: onay, seçim, düzenleme. Ağır bağımlılık (Remotion, Agent SDK) içermez;
 * Stüdyo bunları doğrudan çağırır, üretim işleri ise ayrı süreçte (CLI/Trigger.dev) çalışır.
 */

export const stateKey = (id: string) => `episodes/${id}/state.json`;

const slug = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFKD")
    // ç → c + birleşik çengel; işaret silinmezse "bekc-isi" gibi kimlikler çıkıyordu.
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "bolum";

export function newEpisodeState(input: EpisodeInput): EpisodeState {
  const rand = Math.random().toString(16).slice(2, 8);
  const id = `${new Date().toISOString().slice(0, 10)}-${slug(input.topic)}-${rand}`;
  return { id, createdAt: new Date().toISOString(), input, done: {}, agentCostUsd: 0 };
}

export class EpisodeRepo {
  constructor(private readonly store: AssetStore) {}

  async load(id: string): Promise<EpisodeState> {
    const state = await getJson<EpisodeState>(this.store, stateKey(id));
    if (!state) throw new Error(`Bölüm bulunamadı: ${id}`);
    return state;
  }

  async save(state: EpisodeState): Promise<void> {
    await putJson(this.store, stateKey(state.id), state);
  }

  async list(): Promise<EpisodeState[]> {
    const keys = (await this.store.list("episodes/")).filter((k) => k.endsWith("/state.json"));
    const states = await Promise.all(keys.map((k) => getJson<EpisodeState>(this.store, k)));
    return states
      .filter((s): s is EpisodeState => s !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async update(id: string, fn: (state: EpisodeState) => void): Promise<EpisodeState> {
    const state = await this.load(id);
    fn(state);
    await this.save(state);
    return state;
  }
}

/** Bu aşamadan sonraki tüm aşamaların "bitti" işaretini kaldırır (çıktılar yeniden üretilecek). */
export function invalidateFrom(state: EpisodeState, stage: (typeof STAGES)[number]): void {
  for (const s of STAGES.slice(STAGES.indexOf(stage))) delete state.done[s];
}

export function approve(state: EpisodeState, gate: Gate): void {
  if (gate === "script" && !state.script) throw new Error("Önce senaryo üretilmeli");
  if (gate === "concept") {
    const missing = missingSelections(state);
    if (missing.length) throw new Error(`Seçim yapılmamış: ${missing.join(", ")}`);
  }
  state.approvals = { ...state.approvals, [gate]: new Date().toISOString() };
  if (state.waitingFor === gate) delete state.waitingFor;
}

export function revokeApproval(state: EpisodeState, gate: Gate): void {
  if (state.approvals) delete state.approvals[gate];
  invalidateFrom(state, GATES[gate]);
}

export function missingSelections(state: EpisodeState): string[] {
  const ids = [...(state.cast?.characters ?? []), ...(state.cast?.locations ?? [])].map((e) => e.id);
  return ids.filter((id) => !state.concept?.selected[id]);
}

export function selectCandidate(state: EpisodeState, entityId: string, index: number): void {
  const candidate = state.concept?.candidates[entityId]?.[index];
  if (!state.concept || !candidate) throw new Error(`Aday yok: ${entityId}#${index}`);
  state.concept.selected[entityId] = candidate;
  // Referans değişince eski deneme kareleri artık temsil edici değil.
  delete state.concept.previews;
}

/** Onaydan önce anlatım metni düzenlenebilir. */
export function editNarration(state: EpisodeState, sceneId: string, narration: string): void {
  if (state.approvals?.script) throw new Error("Senaryo onaylandı; düzenlemek için önce onayı geri al");
  const scene = state.script?.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Sahne yok: ${sceneId}`);
  scene.narration = narration.trim();
}

export function setMotion(state: EpisodeState, motionMode: MotionMode, aiClipRatio?: number): void {
  if (state.approvals?.concept) throw new Error("Konsept onaylandı; hareket modu değiştirilemez");
  state.input.motionMode = motionMode;
  if (aiClipRatio !== undefined) state.input.aiClipRatio = aiClipRatio;
}

// ---------------- maliyet tahmini ----------------

/** Tahmini birim fiyatlar (plan §10, §18; 29 Eki faturalarıyla uyumlu). */
const PRICE = {
  imageStandard: 0.067, // Nano Banana 2
  imageEconomy: 0.025, // FLUX dev
  clipPerSecond: 0.05, // Kling 2.1 standart, sessiz
  ttsPer1kChars: 0.1, // ElevenLabs v3 (Gemini TTS ~0.03)
  agents: 0.5,
} as const;

export interface CostEstimate {
  shots: number;
  keyframesUsd: number;
  clipsUsd: number;
  voiceUsd: number;
  agentsUsd: number;
  conceptUsd: number;
  totalUsd: number;
}

export function estimateCost(input: EpisodeInput, opts: { shots?: number; castSize?: number } = {}): CostEstimate {
  const shots = opts.shots ?? Math.max(1, Math.round(input.targetSec / 5.5));
  const image = input.tier === "economy" || input.tier === "ultra" ? PRICE.imageEconomy : PRICE.imageStandard;
  const mode = input.motionMode ?? (input.aiClipRatio > 0 ? "mixed" : "still");
  const clipShare = mode === "animated" ? 1 : mode === "mixed" ? input.aiClipRatio : 0;
  // Klipler 5 veya 10 sn faturalanıyor; ortalama ~7 sn.
  const clipsUsd = shots * clipShare * 7 * PRICE.clipPerSecond;
  const keyframesUsd = shots * image;
  const voiceUsd = ((input.targetSec / 60) * 900 * PRICE.ttsPer1kChars) / 1000;
  const conceptUsd = (opts.castSize ?? 6) * 3 * PRICE.imageStandard + 3 * PRICE.imageStandard;
  const totalUsd = keyframesUsd + clipsUsd + voiceUsd + PRICE.agents + conceptUsd;
  return { shots, keyframesUsd, clipsUsd, voiceUsd, agentsUsd: PRICE.agents, conceptUsd, totalUsd };
}
