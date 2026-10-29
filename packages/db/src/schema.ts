import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const channels = pgTable("channels", {
  id: id(),
  name: text("name").notNull(),
  niche: text("niche").notNull(),
  sourceLang: text("source_lang").notNull(),
  targetLangs: text("target_langs").array().notNull().default([]),
  defaultTier: text("default_tier").notNull().default("economy"),
  publishMode: text("publish_mode").notNull().default("multi_audio"),
  styleBible: jsonb("style_bible"),
  createdAt: createdAt(),
});

export const characters = pgTable("characters", {
  id: id(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  name: text("name").notNull(),
  identity: jsonb("identity").notNull(), // @ys/core Character
  createdAt: createdAt(),
});

export const episodes = pgTable("episodes", {
  id: id(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  title: text("title").notNull(),
  mode: text("mode").notNull().default("original"),
  status: text("status").notNull().default("idea"),
  budgetTier: text("budget_tier").notNull().default("economy"),
  budgetCapMicros: bigint("budget_cap_micros", { mode: "number" }),
  targetDurationSec: integer("target_duration_sec").notNull().default(720),
  sourceLang: text("source_lang").notNull(),
  targetLangs: text("target_langs").array().notNull().default([]),
  data: jsonb("data"), // story, script, shots: aşama çıktıları
  createdAt: createdAt(),
});

export const assets = pgTable(
  "assets",
  {
    id: id(),
    episodeId: text("episode_id").references(() => episodes.id),
    requestHash: text("request_hash").notNull(),
    kind: text("kind").notNull(), // keyframe | clip | voice | music | sfx | thumbnail…
    providerId: text("provider_id").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    request: jsonb("request"), // referanslar hariç üretim isteği
    qaScore: real("qa_score"),
    approved: boolean("approved").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("assets_episode_idx").on(t.episodeId), index("assets_hash_idx").on(t.requestHash)],
);

export const costEntries = pgTable(
  "cost_entries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    episodeId: text("episode_id"),
    stage: text("stage"),
    providerId: text("provider_id").notNull(),
    capability: text("capability").notNull(),
    estimateMicros: bigint("estimate_micros", { mode: "number" }).notNull(),
    actualMicros: bigint("actual_micros", { mode: "number" }),
    cacheHit: boolean("cache_hit").notNull(),
    requestHash: text("request_hash").notNull(),
    refId: text("ref_id"),
    durationMs: integer("duration_ms"),
    units: real("units"),
    unitLabel: text("unit_label"),
    error: text("error"),
  },
  (t) => [index("cost_episode_idx").on(t.episodeId)],
);

/** Kodda sabit duran tahmini fiyatları ezen güncel fiyat tablosu. */
export const providerPrices = pgTable("provider_prices", {
  providerId: text("provider_id").primaryKey(),
  unit: text("unit").notNull(),
  usd: real("usd").notNull(),
  source: text("source"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});
