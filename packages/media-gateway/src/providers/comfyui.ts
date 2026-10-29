import { randomUUID } from "node:crypto";
import type { Capability } from "@ys/core";
import { pollUntil, requestBytes, requestJson } from "../http.ts";
import type {
  AspectRatio,
  GenerateContext,
  GenerationRequest,
  GenerationResult,
  OutputFile,
  PriceRule,
  ProviderAdapter,
  ProviderLimits,
} from "../types.ts";

/**
 * comfy-workflows/manifest.json girdisi. Workflow dosyası ComfyUI'da
 * "Export (API)" ile kaydedilmiş JSON'dur; içindeki yer tutucular (README) doldurulur.
 */
export interface ComfyWorkflowSpec {
  id: string;
  file: string;
  capabilities: Capability[];
  limits?: ProviderLimits;
  qualityPrior: number;
  fps?: number;
}

type Graph = Record<string, { inputs: Record<string, unknown>; class_type: string }>;

interface HistoryEntry {
  status?: { completed: boolean; status_str: string; messages?: unknown[] };
  outputs?: Record<string, Record<string, { filename: string; subfolder: string; type: string }[]>>;
}

const SIZES: Record<AspectRatio, [number, number]> = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "1:1": [1024, 1024],
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  gif: "image/gif",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
};

/** Yerel GPU'daki ComfyUI sunucusu. Maliyet sıfır kabul edilir (elektrik hariç). */
export class ComfyUiAdapter implements ProviderAdapter {
  readonly local = true;
  readonly price: PriceRule = { unit: "free" };
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly limits: ProviderLimits;
  readonly qualityPrior: number;

  constructor(
    private readonly spec: ComfyWorkflowSpec,
    private readonly workflow: Graph,
    private readonly baseUrl: string,
  ) {
    this.id = `comfy:${spec.id}`;
    this.capabilities = spec.capabilities;
    this.limits = spec.limits ?? {};
    this.qualityPrior = spec.qualityPrior;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const images: string[] = [];
    for (const r of req.refs ?? []) images.push(await this.upload(r.bytes, r.mimeType, ctx));

    const [width, height] = SIZES[req.aspectRatio ?? "16:9"];
    const fps = this.spec.fps ?? 24;
    const vars: Record<string, string | number> = {
      prompt: req.prompt ?? "",
      negative: req.negativePrompt ?? "",
      seed: req.seed ?? Math.floor(Math.random() * 2 ** 31),
      width,
      height,
      // LTX/Wan kare sayıları genelde 8k+1 biçiminde olmalı.
      frames: Math.round(((req.durationSec ?? 5) * fps) / 8) * 8 + 1,
      fps,
    };
    images.forEach((name, i) => (vars[`image_${i + 1}`] = name));

    const graph = fillPlaceholders(structuredClone(this.workflow), vars);
    const { prompt_id } = await requestJson<{ prompt_id: string }>(ctx.fetch, `${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
      signal: ctx.signal,
    });
    ctx.onProgress?.(`kuyrukta (${prompt_id})`);

    const entry = await pollUntil(
      async () => {
        const h = await requestJson<Record<string, HistoryEntry>>(ctx.fetch, `${this.baseUrl}/history/${prompt_id}`, {
          signal: ctx.signal,
        });
        const e = h[prompt_id];
        return e?.status?.completed || e?.status?.status_str === "error" ? e : undefined;
      },
      { intervalMs: 2000, timeoutMs: 60 * 60_000, signal: ctx.signal },
    );
    if (entry.status?.status_str === "error") throw new Error(`ComfyUI hata: ${JSON.stringify(entry.status.messages)}`);

    const files: OutputFile[] = [];
    for (const node of Object.values(entry.outputs ?? {})) {
      for (const list of Object.values(node)) {
        if (!Array.isArray(list)) continue;
        for (const f of list) {
          if (f.type !== "output") continue;
          const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
          const { bytes } = await requestBytes(ctx.fetch, `${this.baseUrl}/view?${qs}`, { signal: ctx.signal });
          const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
          files.push({ bytes, mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream" });
        }
      }
    }
    return { files };
  }

  private async upload(bytes: Uint8Array, mimeType: string, ctx: GenerateContext): Promise<string> {
    const form = new FormData();
    const ext = Object.entries(MIME_BY_EXT).find(([, m]) => m === mimeType)?.[0] ?? "png";
    form.append("image", new Blob([new Uint8Array(bytes)], { type: mimeType }), `ys-${randomUUID()}.${ext}`);
    form.append("overwrite", "true");
    const res = await requestJson<{ name: string; subfolder?: string }>(ctx.fetch, `${this.baseUrl}/upload/image`, {
      method: "POST",
      body: form,
      signal: ctx.signal,
    });
    return res.subfolder ? `${res.subfolder}/${res.name}` : res.name;
  }
}

/**
 * Workflow içindeki "{{ad}}" yer tutucularını doldurur. Değerin tamamı tek bir yer tutucuysa
 * tip korunur (sayı alanları sayı kalır); metin içindeyse metne gömülür.
 */
export function fillPlaceholders<T>(value: T, vars: Record<string, string | number>): T {
  if (typeof value === "string") {
    const whole = /^\{\{(\w+)\}\}$/.exec(value);
    if (whole?.[1] && whole[1] in vars) return vars[whole[1]] as T;
    return value.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => fillPlaceholders(v, vars)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, vars)]),
    ) as T;
  }
  return value;
}
