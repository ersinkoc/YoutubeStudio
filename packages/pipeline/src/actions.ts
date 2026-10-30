import { VectorAssetMeta } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";
import { libraryIdOf, noteCharacterUse } from "./library.ts";
import { cleanSeries } from "./series.ts";
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
    // Okunamayan (bozuk) tek durum dosyası tüm listeyi düşürmesin.
    const states = await Promise.all(keys.map((k) => getJson<EpisodeState>(this.store, k).catch(() => null)));
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
  // Eski ses yeni metni okumaz.
  delete state.voice?.[sceneId];
}

export function setMotion(state: EpisodeState, motionMode: MotionMode, aiClipRatio?: number): void {
  if (state.approvals?.concept) throw new Error("Konsept onaylandı; hareket modu değiştirilemez");
  // Görsel ve vektör modlarının konsept varlıkları farklıdır (PNG/JPEG ↔ SVG); geçişte konsept yeniden üretilir.
  const wasVector = state.input.motionMode === "vector";
  if (wasVector !== (motionMode === "vector") && state.concept) {
    delete state.concept;
    invalidateFrom(state, "concept");
  }
  state.input.motionMode = motionMode;
  if (aiClipRatio !== undefined) state.input.aiClipRatio = aiClipRatio;
}

/**
 * Seçilen çekimlerin karelerini (ve varsa kliplerini) siler; sonraki çalıştırmada yeniden çizilir.
 * Her yeniden çizim yeni bir seed alır, yoksa aynı istek önbellekten aynı kareyi döndürürdü.
 */
export function redrawShots(state: EpisodeState, shotIds: string[]): void {
  const known = new Set(state.shots?.map((s) => s.id));
  const ids = shotIds.filter((id) => known.has(id));
  if (ids.length === 0) throw new Error("Yeniden çizilecek çekim yok");
  state.redraws ??= {};
  for (const id of ids) {
    state.redraws[id] = (state.redraws[id] ?? 0) + 1;
    delete state.keyframes?.[id];
    delete state.qa?.[id];
    delete state.clips?.[id];
  }
  delete state.lastError;
  invalidateFrom(state, "keyframes");
}

/**
 * Anlatıcı sesini değiştirir. Bölüm tek sesle anlatıldığı için tüm sahneler yeniden seslendirilir;
 * zamanlama değiştiği için çekim planı ve sonrası da yeniden üretilir.
 */
export function changeVoice(state: EpisodeState, voiceId: string | undefined): void {
  if (state.done.render) throw new Error("Video render edildi; ses değiştirmek için yeni bölüm aç");
  state.input.voiceId = voiceId || undefined;
  delete state.voice;
  delete state.voiceProviderId;
  delete state.lastError;
  invalidateFrom(state, "voice");
}
// ---------------- kalite kapısında insan kararı ----------------

/** Kaydın sahibi: kimlik; eski kayıtlarda (kimliksiz) kadro adı ya da nesne kimliği olan ad. */
function ownerOf(state: EpisodeState, check: { entityId?: string; name: string }): string | undefined {
  if (check.entityId) return check.entityId;
  const cast = [...(state.cast?.characters ?? []), ...(state.cast?.locations ?? [])].find((e) => e.name === check.name);
  return cast?.id ?? (state.vectorProps?.[check.name] ? check.name : undefined);
}

/** Varlığı sahibine bağlar: kadro varlığı konsepte aday ve seçim olur, nesne çekimlere girer. */
function attach(state: EpisodeState, entityId: string | undefined, key: string): void {
  if (!entityId) return;
  const isCast = [...(state.cast?.characters ?? []), ...(state.cast?.locations ?? [])].some((e) => e.id === entityId);
  if (isCast && state.concept) {
    const ref = { key, mimeType: "image/svg+xml" };
    const list = (state.concept.candidates[entityId] ??= []);
    if (!list.some((r) => r.key === key)) list.push(ref);
    state.concept.selected[entityId] = ref;
    return;
  }
  const prop = state.vectorProps?.[entityId];
  if (prop) {
    prop.key = key;
    // Nesne çizildiyse sahneler zaten onu kullanıyor; yalnız kurgu ve render yenilenir.
    if (state.done.timeline) invalidateFrom(state, "timeline");
  }
}

/** Varlığı sahibinden ayırır; yeniden çizilmesi için ilgili aşama açılır. */
function detach(state: EpisodeState, entityId: string | undefined, key: string): void {
  if (!entityId) return;
  const isCast = [...(state.cast?.characters ?? []), ...(state.cast?.locations ?? [])].some((e) => e.id === entityId);
  if (isCast && state.concept) {
    state.concept.candidates[entityId] = (state.concept.candidates[entityId] ?? []).filter((r) => r.key !== key);
    if (state.concept.selected[entityId]?.key === key) delete state.concept.selected[entityId];
    if (state.approvals?.concept) delete state.approvals.concept;
    if (state.done.concept) invalidateFrom(state, "concept");
    return;
  }
  const prop = state.vectorProps?.[entityId];
  if (prop?.key === key) {
    delete prop.key;
    if (state.done.keyframes) invalidateFrom(state, "keyframes");
  }
}

/**
 * İnsan, kalite kapısının reddettiği çizimi kabul eder: en iyi deneme kütüphaneye onaylı olarak yazılır ve varlık
 * sahibine bağlanır (kadro → konsept seçimi, nesne → çekimler).
 */
export async function acceptAsset(store: AssetStore, state: EpisodeState, key: string): Promise<void> {
  const check = state.assetChecks?.[key];
  if (!check) throw new Error(`Kapı kaydı yok: ${key}`);
  const override = { decision: "accepted" as const, at: new Date().toISOString() };
  const next = { ...check, passed: true, override };
  if (check.rejectedKey) {
    const svg = await store.get(check.rejectedKey);
    if (!svg) throw new Error("Reddedilen çizim depoda yok");
    const meta = VectorAssetMeta.parse((await getJson(store, `${check.rejectedKey}.json`)) ?? {});
    await store.put(key, svg, "image/svg+xml");
    await putJson(store, `${key}.json`, { ...meta, check: next });
  } else {
    const meta = VectorAssetMeta.parse((await getJson(store, `${key}.json`)) ?? {});
    await putJson(store, `${key}.json`, { ...meta, check: next });
  }
  (state.assetChecks ??= {})[key] = next;
  attach(state, ownerOf(state, check), key);
  // Kapı yüzünden duran aşama artık devam edebilir.
  if (state.lastError?.message.includes("Kalite kapısı")) delete state.lastError;
}

/**
 * İnsan bir çizimi (kapı geçirmiş olsa da) reddeder: kütüphanede kullanılmaz olarak işaretlenir, sahibinden ayrılır;
 * sonraki çalıştırmada not tasarımcıya düzeltme olarak iletilip yeniden çizilir.
 */
export async function rejectAsset(store: AssetStore, state: EpisodeState, key: string, note?: string): Promise<void> {
  const check = state.assetChecks?.[key];
  if (!check) throw new Error(`Kapı kaydı yok: ${key}`);
  const override = { decision: "rejected" as const, note: note?.trim() || undefined, at: new Date().toISOString() };
  const next = { ...check, passed: false, override };
  // Kütüphaneden tekrar kullanılan karakter: "bu kişi değil" kararı yalnız bu bölümü ilgilendirir; paylaşılan kayıt
  // değişmezse başka bölümler ve seriler onu kullanmaya devam eder. Bu bölümde yeniden çizilir.
  const reused = state.cast?.characters.find((c) => c.reuse && c.reuse === libraryIdOf(key));
  if (reused) {
    delete reused.reuse;
    (state.assetChecks ??= {})[key] = next;
    detach(state, reused.id, key);
    return;
  }
  const meta = await getJson<VectorAssetMeta>(store, `${key}.json`);
  if (meta) await putJson(store, `${key}.json`, { ...meta, check: next });
  (state.assetChecks ??= {})[key] = next;
  detach(state, ownerOf(state, check), key);
}

/**
 * Kadrodaki karaktere kütüphanedeki onaylı bir karakteri atar (Stüdyo → Konsept → "Kütüphaneden kullan"): yeniden
 * çizilmez, aday olarak eklenir ve seçilir.
 */
export async function reuseCharacter(store: AssetStore, state: EpisodeState, castId: string, key: string): Promise<void> {
  const character = state.cast?.characters.find((c) => c.id === castId);
  if (!character || !state.concept) throw new Error(`Kadroda yok: ${castId}`);
  const meta = VectorAssetMeta.parse((await getJson(store, `${key}.json`)) ?? {});
  if (!meta.identity || !meta.check?.passed || meta.check.override?.decision === "rejected") throw new Error("Kütüphanede onaylı karakter değil");
  if (state.input.realism !== false && meta.check.fidelitySkipped && meta.check.override?.decision !== "accepted") {
    throw new Error("Bu karakter gerçeklik denetimi kapalıyken geçti; gerçeklik açık bölümde kullanılamaz");
  }
  const ref = { key, mimeType: "image/svg+xml" };
  const list = (state.concept.candidates[castId] ??= []);
  if (!list.some((r) => r.key === key)) list.push(ref);
  state.concept.selected[castId] = ref;
  (state.assetChecks ??= {})[key] = { ...meta.check, entityId: castId };
  character.reuse = libraryIdOf(key);
  await noteCharacterUse(store, key, state.id);
}

/** Bölümün serisini değiştirir (boş: seriden çıkar). Üretimi etkilemez; stil zaten seçildiyse değişmez. */
export function setSeries(state: EpisodeState, name: string | undefined): void {
  state.input.series = cleanSeries(name);
}

/** Gerçeklik (referansa sadakat) denetimini bölüm için açar/kapatır; tanınırlık denetimi her zaman açıktır. */
export function setRealism(state: EpisodeState, enabled: boolean): void {
  state.input.realism = enabled;
}
