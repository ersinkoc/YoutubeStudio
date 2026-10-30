import { z } from "zod";

/**
 * Claude ajanlarının model seçimi. Her ajanın kodda bir varsayılan sınıfı var (creative/fast/cheap, plan §1.5);
 * kullanıcı Stüdyo'nun Modeller sayfasından ajan başına başka bir model seçebilir. Seçim depoda
 * (`settings/models.json`) durur ve bir sonraki çalıştırmada geçerli olur.
 */
export const MODEL_CHOICES = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

export type ModelTier = "creative" | "fast" | "cheap";

export const DEFAULT_TIER_MODEL: Record<ModelTier, ModelChoice> = {
  creative: "claude-opus-5-5",
  fast: "claude-sonnet-5-5",
  cheap: "claude-haiku-5-5",
};

/** Ajan anahtarı → varsayılan sınıf. Anahtar ajan çağrısının adıdır (günlükte ve maliyet dökümünde görünen). */
export const AGENT_ROLES = {
  "style-picker": "cheap",
  "art-director": "fast",
  "story-architect": "creative",
  screenwriter: "creative",
  "script-doctor": "creative",
  "casting-director": "fast",
  director: "fast",
  "frame-inspector": "cheap",
  "vector-director": "fast",
  "asset-planner": "fast",
  "vector-designer:character": "creative",
  "vector-designer:background": "fast",
  "vector-designer:prop": "fast",
  "vector-designer:redraw": "fast",
  "prop-physics": "cheap",
  "asset-guess": "cheap",
  "asset-gate": "cheap",
  "scene-critic": "cheap",
  "lesson-curator": "cheap",
} as const satisfies Record<string, ModelTier>;
export type AgentRole = keyof typeof AGENT_ROLES;

export const ModelSettings = z.record(z.string(), z.string());
export type ModelSettings = Partial<Record<AgentRole, ModelChoice>>;

/** Geçerli seçimleri süzer: bilinmeyen ajan ya da model sessizce atılır (eski ayar dosyası çalışmayı bozmaz). */
export function cleanModelSettings(raw: unknown): ModelSettings {
  const parsed = ModelSettings.safeParse(raw);
  if (!parsed.success) return {};
  const out: ModelSettings = {};
  for (const [role, model] of Object.entries(parsed.data)) {
    if (Object.hasOwn(AGENT_ROLES, role) && (MODEL_CHOICES as readonly string[]).includes(model)) out[role as AgentRole] = model as ModelChoice;
  }
  return out;
}

/**
 * Çağrının modeli: önce tam ad ("vector-designer:prop"), sonra ön ek ("asset-planner:character" → "asset-planner")
 * için kullanıcı seçimi; yoksa ajanın kendi varsayılanı.
 */
export function modelFor(name: string, fallback: string, settings: ModelSettings | undefined): string {
  if (!settings) return fallback;
  const own = (key: string) => (Object.hasOwn(settings, key) ? settings[key as AgentRole] : undefined);
  return own(name) ?? own(name.split(":")[0]!) ?? fallback;
}
