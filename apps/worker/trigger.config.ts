import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { puppeteer } from "@trigger.dev/build/extensions/puppeteer";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Trigger.dev Cloud'da (veya self-host'ta) proje oluşturunca verilen ref.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_youtube_studio",
  dirs: ["./src"],
  // 20 dakikalık bir bölümün tüm aşamaları + render saatler sürebilir.
  maxDuration: 6 * 60 * 60,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2, randomize: true },
  },
  build: {
    // Deploy imajında ffprobe (süre ölçümü) ve Chrome (Remotion render) gerekli.
    extensions: [ffmpeg(), puppeteer()],
    external: ["@remotion/renderer", "@remotion/bundler", "@remotion/compositor-linux-x64-gnu"],
  },
});
