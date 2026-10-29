import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export type QueryFn = typeof query;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Model kimlikleri env ile ezilebilir (çağrı anında okunur); varsayılanlar plan §1.5'teki dağılım. */
export const models = () => ({
  creative: process.env.YS_MODEL_CREATIVE ?? "claude-opus-5-5",
  fast: process.env.YS_MODEL_FAST ?? "claude-sonnet-5-5",
  cheap: process.env.YS_MODEL_CHEAP ?? "claude-haiku-5-5",
});

export interface AgentCall<T> {
  name: string;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort?: Effort;
  maxBudgetUsd?: number;
}

export interface AgentResult<T> {
  data: T;
  costUsd: number;
  model: string;
  durationMs: number;
}

export interface AgentDeps {
  queryFn?: QueryFn;
  log?: (message: string) => void;
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

/**
 * Araçsız, tek amaçlı bir Claude çağrısı: şemaya uyan JSON döner.
 * Claude Code harness'ı üzerinden çalıştığı için abonelik (Agent SDK kredisi) veya API anahtarı kullanılır.
 */
export async function runStructured<T>(call: AgentCall<T>, deps: AgentDeps = {}): Promise<AgentResult<T>> {
  const queryFn = deps.queryFn ?? query;
  deps.log?.(`ajan: ${call.name} (${call.model})`);

  const q = queryFn({
    prompt: call.prompt,
    options: {
      model: call.model,
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
      costUsd: message.total_cost_usd,
      model: call.model,
      durationMs: message.duration_ms,
    };
  }
  throw new AgentError(`${call.name}: sonuç mesajı gelmedi`);
}
