CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text,
	"request_hash" text NOT NULL,
	"kind" text NOT NULL,
	"provider_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"request" jsonb,
	"qa_score" real,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"source_lang" text NOT NULL,
	"target_langs" text[] DEFAULT '{}' NOT NULL,
	"default_tier" text DEFAULT 'economy' NOT NULL,
	"publish_mode" text DEFAULT 'multi_audio' NOT NULL,
	"style_bible" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"identity" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" timestamp with time zone NOT NULL,
	"episode_id" text,
	"stage" text,
	"provider_id" text NOT NULL,
	"capability" text NOT NULL,
	"estimate_micros" bigint NOT NULL,
	"actual_micros" bigint,
	"cache_hit" boolean NOT NULL,
	"request_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"title" text NOT NULL,
	"mode" text DEFAULT 'original' NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"budget_tier" text DEFAULT 'economy' NOT NULL,
	"budget_cap_micros" bigint,
	"target_duration_sec" integer DEFAULT 720 NOT NULL,
	"source_lang" text NOT NULL,
	"target_langs" text[] DEFAULT '{}' NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_prices" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"unit" text NOT NULL,
	"usd" real NOT NULL,
	"source" text,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_episode_idx" ON "assets" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "assets_hash_idx" ON "assets" USING btree ("request_hash");--> statement-breakpoint
CREATE INDEX "cost_episode_idx" ON "cost_entries" USING btree ("episode_id");