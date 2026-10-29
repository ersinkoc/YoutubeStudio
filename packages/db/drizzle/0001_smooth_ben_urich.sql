ALTER TABLE "cost_entries" ADD COLUMN "ref_id" text;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "units" real;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "unit_label" text;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD COLUMN "error" text;