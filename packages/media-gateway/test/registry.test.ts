import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ComfyUiAdapter,
  DEFAULT_COMFY_DIR,
  FAL_MODELS,
  createProvidersFromEnv as fromEnvTyped,
  geminiTtsPricePer1k,
} from "../src/index.ts";

/** Gerçek process.env yerine sahte değerlerle çağırır. */
const createProvidersFromEnv = (env: Record<string, string>, dir?: string) => fromEnvTyped(env as NodeJS.ProcessEnv, dir);

/** Geçici ComfyUI klasörü: bir workflow mevcut, biri eksik. */
function comfyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ys-comfy-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify([
      { id: "var", file: "var.json", capabilities: ["t2i"], qualityPrior: 0.6 },
      { id: "yok", file: "yok.json", capabilities: ["i2v"], qualityPrior: 0.5 },
    ]),
  );
  writeFileSync(join(dir, "var.json"), JSON.stringify({ "1": { class_type: "X", inputs: { t: "{{prompt}}" } } }));
  return dir;
}

const verifiedFal = FAL_MODELS.filter((m) => m.verified).map((m) => m.id);
const unverifiedFal = FAL_MODELS.filter((m) => !m.verified).map((m) => m.id);

describe("createProvidersFromEnv", () => {
  it("anahtar yoksa hiçbir sağlayıcı kurmaz ve nedenleri raporlar", () => {
    const empty = mkdtempSync(join(tmpdir(), "ys-comfy-bos-"));
    expect(createProvidersFromEnv({}, empty)).toEqual({
      providers: [],
      skipped: [
        "comfy:* (COMFYUI_URL veya manifest.json yok)",
        "fal:* (FAL_KEY yok)",
        "gemini:* (GEMINI_API_KEY yok)",
        "elevenlabs:* (ELEVENLABS_API_KEY yok)",
      ],
    });
  });

  it("COMFYUI_URL var ama manifest yoksa ComfyUI'ı atlar", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-comfy-bos-"));
    mkdirSync(join(dir, "alt"));
    const { skipped } = createProvidersFromEnv({ COMFYUI_URL: "http://localhost:8188" }, dir);
    expect(skipped[0]).toBe("comfy:* (COMFYUI_URL veya manifest.json yok)");
  });

  it("ComfyUI: dosyası olan workflow'u kurar, eksik olanı raporlar", () => {
    const { providers, skipped } = createProvidersFromEnv({ COMFYUI_URL: "http://gpu:8188" }, comfyDir());
    expect(providers.map((p) => p.id)).toEqual(["comfy:var"]);
    expect(providers[0]).toBeInstanceOf(ComfyUiAdapter);
    expect(skipped).toContain("comfy:yok (workflow dosyası yok: yok.json)");
  });

  it("fal: doğrulanmamış modelleri bayrak olmadan açmaz", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-comfy-bos-"));
    const off = createProvidersFromEnv({ FAL_KEY: "sahte" }, dir);
    expect(off.providers.map((p) => p.id)).toEqual(verifiedFal);
    expect(off.skipped).toEqual(expect.arrayContaining(unverifiedFal.map((id) => `${id} (doğrulanmadı; FAL_ENABLE_UNVERIFIED=1 ile aç)`)));
    const on = createProvidersFromEnv({ FAL_KEY: "sahte", FAL_ENABLE_UNVERIFIED: "1" }, dir);
    expect(on.providers.map((p) => p.id)).toEqual(FAL_MODELS.map((m) => m.id));
  });

  it("Gemini: dört sağlayıcıyı varsayılan modellerle, env ile ezilmiş modellerle kurar; Veo yalnız açıkça", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-comfy-bos-"));
    const ids = ["gemini:nano-banana-pro", "gemini:nano-banana-2.1", "gemini:nano-banana-2", "gemini:tts"];
    const def = createProvidersFromEnv({ GEMINI_API_KEY: "g" }, dir);
    expect(def.providers.map((p) => p.id)).toEqual(ids);
    // veo-3.1-generate-preview 22 Eki 2026'da kapandı: varsayılan kurulmaz, sıralamaya/tahmine girmez.
    expect(def.skipped).toContain("gemini:veo (veo-3.1-generate-preview kapandı; GEMINI_VEO_MODEL ile aç, doğrulanmadı)");

    // Model adının istek URL'sine yansıdığını sahte fetch ile doğrula.
    const urls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      // Veo gönderimi reddedilsin ki bekleme döngüsüne girilmesin.
      if (String(input).endsWith(":predictLongRunning")) return new Response("ret", { status: 400 });
      return new Response(JSON.stringify({ promptFeedback: { blockReason: "X" } }));
    }) as typeof globalThis.fetch;
    const custom = createProvidersFromEnv(
      {
        GEMINI_API_KEY: "g",
        GEMINI_IMAGE_MODEL: "m-pro",
        GEMINI_IMAGE_CHEAP_MODEL: "m-cheap",
        GEMINI_IMAGE_FAST_MODEL: "m-fast",
        GEMINI_TTS_MODEL: "m-tts",
      },
      dir,
    ).providers;
    for (const p of custom.slice(0, 4)) {
      await p.generate({ capability: p.id === "gemini:tts" ? "tts" : "t2i", quality: "draft", text: "a" }, { fetch }).catch(() => {});
    }
    expect(urls.map((u) => u.split("/models/")[1])).toEqual([
      "m-pro:generateContent",
      "m-cheap:generateContent",
      "m-fast:generateContent",
      "m-tts:generateContent",
    ]);
    const veo = createProvidersFromEnv({ GEMINI_API_KEY: "g", GEMINI_VEO_MODEL: "veo-x" }, dir).providers.at(-1)!;
    expect(veo.id).toBe("gemini:veo");
    expect(veo.price).toEqual({ unit: "per_second", usd: 0.4, stepSec: 2, minSec: 4 });
    await veo.generate({ capability: "t2v", quality: "draft" }, { fetch }).catch(() => {});
    expect(urls.at(-1)).toContain("/models/veo-x:predictLongRunning");
  });

  it("Gemini TTS fiyatı: 2026 sonuna kadar $9/1M ses tokeni, 2027'den $18 (1000 karakter başı)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-comfy-bos-"));
    const tts = (now: Date) =>
      fromEnvTyped({ GEMINI_API_KEY: "g" } as Record<string, string> as NodeJS.ProcessEnv, dir, now).providers.find((p) => p.id === "gemini:tts")!;
    expect(tts(new Date("2026-12-31T23:59:59Z")).price).toEqual({ unit: "per_1k_chars", usd: 0.017 });
    expect(tts(new Date("2027-01-01T00:00:00Z")).price).toEqual({ unit: "per_1k_chars", usd: 0.033 });
    expect(geminiTtsPricePer1k(new Date("2026-10-31"))).toBe(0.017);
  });

  it("ElevenLabs: TTS, SFX ve müzik; TTS modeli env ile seçilir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-comfy-bos-"));
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ audio_base64: "" }));
    }) as typeof globalThis.fetch;
    const req = { capability: "tts" as const, quality: "draft" as const, text: "a", voiceId: "v" };

    const def = createProvidersFromEnv({ ELEVENLABS_API_KEY: "e" }, dir).providers;
    expect(def.map((p) => p.id)).toEqual(["elevenlabs:tts", "elevenlabs:sfx", "elevenlabs:music"]);
    await def[0]!.generate(req, { fetch });
    const custom = createProvidersFromEnv({ ELEVENLABS_API_KEY: "e", ELEVENLABS_TTS_MODEL: "eleven_flash" }, dir).providers;
    await custom[0]!.generate(req, { fetch });
    expect(bodies.map((b) => b.model_id)).toEqual(["eleven_v3", "eleven_flash"]);
    // Müzik modeli açıkça gönderilir; env ile seçilir.
    const musicReq = { capability: "music" as const, quality: "draft" as const, prompt: "p" };
    await def[2]!.generate(musicReq, { fetch });
    const music = createProvidersFromEnv({ ELEVENLABS_API_KEY: "e", ELEVENLABS_MUSIC_MODEL: "music_v2_5" }, dir).providers[2]!;
    await music.generate(musicReq, { fetch });
    expect(bodies.slice(2).map((b) => b.model_id)).toEqual(["music_v1", "music_v2_5"]);
  });

  it("varsayılan ComfyUI klasörü paketin comfy-workflows dizinidir", () => {
    expect(DEFAULT_COMFY_DIR.replace(/\\/g, "/")).toMatch(/packages\/media-gateway\/comfy-workflows$/);
    // Varsayılan klasörde manifest var: COMFYUI_URL verilince ComfyUI atlanma nedeni manifest olmaz.
    const { skipped } = createProvidersFromEnv({ COMFYUI_URL: "http://gpu:8188" });
    expect(skipped).not.toContain("comfy:* (COMFYUI_URL veya manifest.json yok)");
  });
});
