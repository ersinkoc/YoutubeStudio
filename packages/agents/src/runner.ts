import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { modelFor, type ModelSettings } from "@ys/core";
import { z } from "zod";

export type QueryFn = typeof query;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Model kimlikleri env ile ezilebilir (çağrı anında okunur); varsayılanlar plan §1.5'teki dağılım. */
export const models = () => ({
  creative: process.env.YS_MODEL_CREATIVE ?? "claude-opus-5-5",
  fast: process.env.YS_MODEL_FAST ?? "claude-sonnet-5-5",
  cheap: process.env.YS_MODEL_CHEAP ?? "claude-haiku-5-5",
});

export interface AgentImage {
  data: Uint8Array;
  mimeType: string;
}

export interface AgentCall<T> {
  name: string;
  model: string;
  system: string;
  prompt: string;
  /** Prompt metninden önce gönderilen görseller (görsel kalite kontrolü gibi işler için). */
  images?: AgentImage[];
  schema: z.ZodType<T>;
  effort?: Effort;
  maxBudgetUsd?: number;
}

export interface AgentResult<T> {
  data: T;
  /** Çağrıyı yapan ajan (günlük ve maliyet dökümü için). */
  name: string;
  costUsd: number;
  model: string;
  durationMs: number;
}

export interface AgentDeps {
  queryFn?: QueryFn;
  log?: (message: string) => void;
  /** Kullanıcının ajan başına model seçimi (Stüdyo → Modeller); ajanın varsayılanını ezer. */
  models?: ModelSettings;
}

export class AgentError extends Error {}

/**
 * Claude Code'un --json-schema doğrulayıcısı draft 2020-12 meta-şemasını tanımıyor;
 * şema draft-07 olarak üretilip $schema alanı çıkarılır.
 */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

/** Önceki bölümlerden öğrenilen kurallar talimatın sonuna eklenir (boşsa hiçbir şey). */
export function lessonsBlock(lessons: readonly string[] | undefined): string {
  return lessons?.length ? `\nLessons from previous episodes (follow them):\n${lessons.map((l) => `- ${l}`).join("\n")}` : "";
}

/** Görselli istek: SDK görsel bloklarını yalnız akış girdisiyle kabul ediyor. */
async function* withImages(text: string, images: AgentImage[]): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...images.map((img) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data: Buffer.from(img.data).toString("base64"),
          },
        })),
        { type: "text" as const, text },
      ],
    },
  };
}

/**
 * Araçsız, tek amaçlı bir Claude çağrısı: şemaya uyan JSON döner.
 * Claude Code harness'ı üzerinden çalıştığı için abonelik (Agent SDK kredisi) veya API anahtarı kullanılır.
 */
export async function runStructured<T>(call: AgentCall<T>, deps: AgentDeps = {}): Promise<AgentResult<T>> {
  const queryFn = deps.queryFn ?? query;
  const model = modelFor(call.name, call.model, deps.models);
  deps.log?.(`ajan: ${call.name} (${model})`);

  const q = queryFn({
    prompt: call.images?.length ? withImages(call.prompt, call.images) : call.prompt,
    options: {
      model,
      systemPrompt: call.system,
      outputFormat: { type: "json_schema", schema: toOutputSchema(call.schema) },
      tools: [],
      settingSources: [],
      persistSession: false,
      permissionMode: "dontAsk",
      maxTurns: 4,
      ...(call.effort ? { effort: call.effort } : {}),
      ...(call.maxBudgetUsd !== undefined ? { maxBudgetUsd: call.maxBudgetUsd } : {}),
    },
  });

  for await (const message of q) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      throw new AgentError(`${call.name}: ${message.subtype} (maliyet $${message.total_cost_usd.toFixed(4)})`);
    }
    const parsed = call.schema.safeParse(message.structured_output);
    if (!parsed.success) {
      throw new AgentError(`${call.name}: şemaya uymayan çıktı: ${z.prettifyError(parsed.error)}`);
    }
    deps.log?.(`ajan: ${call.name} bitti, $${message.total_cost_usd.toFixed(4)}`);
    return {
      data: parsed.data,
      name: call.name,
      costUsd: message.total_cost_usd,
      model,
      durationMs: message.duration_ms,
    };
  }
  throw new AgentError(`${call.name}: sonuç mesajı gelmedi`);
}
