import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://ys:ys@localhost:5433/youtube_studio" },
});
