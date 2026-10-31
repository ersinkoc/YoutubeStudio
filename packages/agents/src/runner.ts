import { query, type Options, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { LocalizedError, modelFor, msg, type ModelSettings, type Msg, type Text } from "@ys/core";
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

/**
 * Ajan hatası; çağrı Claude'a ulaştıysa harcanan para da taşınır (deftere yazılsın diye). Mesaj çevrilebilir: `message`
 * Türkçe, `text` Stüdyo'da seçili dilde. Düz metin de kabul edilir (eski çağrılar, testler).
 */
export class AgentError extends LocalizedError {
  constructor(
    message: Text,
    readonly costUsd = 0,
    readonly model?: string,
    readonly agent?: string,
    /** Geçici (aşırı yük, oran sınırı, 5xx, zaman aşımı, sonuçsuz bitiş): yeniden denemek güvenli. */
    readonly transient = false,
  ) {
    super(typeof message === "string" ? msg("gw.text", { text: message }) : message);
  }
}

/** Takılan alt süreç eşzamanlılık yuvasını sonsuza dek tutmasın (varsayılan 10 dk; tasarımcı çağrıları ~30 sn). */
const AGENT_TIMEOUT_MS = () => Math.max(10_000, Number(process.env.YS_AGENT_TIMEOUT_MS) || 600_000);

/**
 * Alt sürece kullanıcının ~/.claude ayarlarından hiçbir şey taşınmaz. settingSources: [] kullanıcı/proje ayarlarını,
 * CLAUDE.md'yi ve hook'ları kapatır ama claude.ai bağlayıcıları (Gmail, Slack…), eklenti/beceri eşitlemesi ve otomatik
 * bellek ayrıca kapatılmalı: her çağrıda yüklenip süre ve token harcıyorlardı (31 Eki SDK incelemesi).
 */
const ISOLATION: Options = {
  settingSources: [],
  strictMcpConfig: true,
  skills: [],
  settings: { disableClaudeAiConnectors: true, syncClaudeAiPlugins: false, syncClaudeAiSkills: false, disableAllHooks: true },
  // İstem olduğu gibi gider: @yol genişletmesi (konu/anlatımda "@" geçebilir) ve tur başı hatırlatmalar yok.
  verbatimPrompts: true,
};

/**
 * Claude Code'un --json-schema doğrulayıcısı draft 2020-12 meta-şemasını tanımıyor;
 * şema draft-07 olarak üretilip $schema alanı çıkarılır.
 */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  // io "input": varsayılanı olan alanlar modelden zorunlu istenmez (çıktı şemasında hepsi zorunluydu, uzun çıktı ve
  // tur sınırı aşımı); eksikleri Zod ayrıştırırken doldurur.
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
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
 * Aynı anda çalışan Claude Code alt süreci sınırı (süreç başına). Her ajan çağrısı ayrı bir Claude Code süreci açar;
 * iki bölüm × 3 paralel iş Windows'ta alt süreçlerin çökmesine (0xC0000409) yol açtı (30 Eki).
 */
const MAX_CLAUDE = Math.max(1, Number(process.env.YS_CLAUDE_CONCURRENCY) || 4);
let active = 0;
const waiting: (() => void)[] = [];
async function slot<R>(fn: () => Promise<R>): Promise<R> {
  if (active >= MAX_CLAUDE) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Geçici hata: alt süreç çökmesi/bağlantı kopması (sonuç gelmeden) ya da AgentError olarak işaretlenmiş API aşırı yükü,
 * oran sınırı, zaman aşımı. Modelin kendi hataları (tur sınırı, şema) geçici değildir.
 */
export const isTransientAgentFailure = (e: unknown) =>
  e instanceof AgentError
    ? e.transient
    : e instanceof Error && /process exited with code|process terminated|ECONNRESET|EPIPE|spawn .*E[A-Z]+/i.test(e.message);

const RETRY_DELAYS_MS = [2000, 5000];

/**
 * Araçsız, tek amaçlı bir Claude çağrısı: şemaya uyan JSON döner.
 * Claude Code harness'ı üzerinden çalıştığı için abonelik (Agent SDK kredisi) veya API anahtarı kullanılır.
 * Alt süreç çökerse (sonuç mesajı gelmeden) iki kez daha denenir; modelin kendi hataları (tur sınırı, şema) denenmez.
 */
export async function runStructured<T>(call: AgentCall<T>, deps: AgentDeps = {}): Promise<AgentResult<T>> {
  // Düşen denemelerin harcadığı para kaybolmasın: başarılı sonuca (ya da son hataya) eklenir.
  let failedCost = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await slot(() => runOnce(call, deps));
      return failedCost ? { ...res, costUsd: res.costUsd + failedCost } : res;
    } catch (e) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientAgentFailure(e)) {
        if (failedCost && e instanceof AgentError) throw new AgentError(e.text, e.costUsd + failedCost, e.model, e.agent, e.transient);
        throw e;
      }
      if (e instanceof AgentError) failedCost += e.costUsd;
      const reason = (e as Error).message.split("\n")[0];
      deps.log?.(`ajan: ${call.name} alt süreci düştü (${reason}), ${delay / 1000} sn sonra yeniden deneniyor`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function runOnce<T>(call: AgentCall<T>, deps: AgentDeps): Promise<AgentResult<T>> {
  const queryFn = deps.queryFn ?? query;
  const model = modelFor(call.name, call.model, deps.models);
  deps.log?.(`ajan: ${call.name} (${model})`);

  const abort = new AbortController();
  const timeoutMs = AGENT_TIMEOUT_MS();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const timedOut = () => new AgentError(msg("agent.timeout", { agent: call.name, sec: timeoutMs / 1000 }), 0, model, call.name, true);
  const q = queryFn({
    prompt: call.images?.length ? withImages(call.prompt, call.images) : call.prompt,
    options: {
      model,
      systemPrompt: call.system,
      outputFormat: { type: "json_schema", schema: toOutputSchema(call.schema) },
      tools: [],
      ...ISOLATION,
      env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" } as Record<string, string>,
      abortController: abort,
      persistSession: false,
      permissionMode: "dontAsk",
      maxTurns: 4,
      ...(call.effort ? { effort: call.effort } : {}),
      ...(call.maxBudgetUsd !== undefined ? { maxBudgetUsd: call.maxBudgetUsd } : {}),
    },
  });

  try {
    for await (const message of q) {
      if (message.type === "result") return finish(call, model, message, deps);
    }
  } catch (e) {
    if (abort.signal.aborted) throw timedOut();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (abort.signal.aborted) throw timedOut();
  // Akış sonuç mesajı vermeden bitti: alt süreç düştü sayılır, yeniden denenir.
  throw new AgentError(msg("agent.noResult", { agent: call.name }), 0, model, call.name, true);
}

/**
 * HTTP yanıtı hiç gelmeyen API hatası (durum kodu yok): bağlantı reddi/kopması, DNS, zaman aşımı. CLI kendi denemelerini
 * bitirip "API Error: Connection refused … (ECONNREFUSED)" ile döner; ağ geçici olduğundan yeniden denenir.
 */
const NETWORK_ERROR = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|connection (refused|reset|error)|timed out|network/i;

function finish<T>(call: AgentCall<T>, model: string, message: SDKResultMessage, deps: AgentDeps): AgentResult<T> {
  const cost = message.total_cost_usd;
  if (message.subtype !== "success") {
    const detail = message.errors?.length ? `: ${message.errors.join("; ").slice(0, 300)}` : "";
    const failed: Msg = msg("agent.failed", { agent: call.name, subtype: message.subtype, detail, cost: cost.toFixed(4) });
    throw new AgentError(failed, cost, model, call.name);
  }
  // "success" ama is_error: tur bir API hatasıyla bitti (aşırı yük, oran sınırı, 5xx) ve yapılandırılmış çıktı yok.
  // Önceden "şemaya uymayan çıktı" sanılıp yeniden denenmiyordu.
  if (message.is_error) {
    const status = message.api_error_status;
    throw new AgentError(
      msg("agent.apiError", { agent: call.name, status: status ? ` ${status}` : "", result: message.result.slice(0, 200) }),
      cost,
      model,
      call.name,
      status === 429 || (typeof status === "number" && status >= 500) || (status == null && NETWORK_ERROR.test(message.result)),
    );
  }
  const parsed = call.schema.safeParse(message.structured_output);
  if (!parsed.success) {
    throw new AgentError(msg("agent.schema", { agent: call.name, detail: z.prettifyError(parsed.error) }), cost, model, call.name);
  }
  deps.log?.(`ajan: ${call.name} bitti, $${cost.toFixed(4)}`);
  return { data: parsed.data, name: call.name, costUsd: cost, model, durationMs: message.duration_ms };
}
