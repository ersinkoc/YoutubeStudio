import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentError, indexWords, runStructured, wordsPerMinute, type QueryFn } from "../src/index.ts";

/** Agent SDK'nın query() akışını taklit eder: önce ara mesajlar, sonra result. */
function fakeQuery(result: Record<string, unknown>, seen?: { options?: unknown }): QueryFn {
  return ((params: { options?: unknown }) => {
    if (seen) seen.options = params.options;
    return (async function* () {
      yield { type: "system", subtype: "init" };
      yield { type: "result", duration_ms: 1200, total_cost_usd: 0.0123, ...result };
    })();
  }) as unknown as QueryFn;
}

const Schema = z.object({ title: z.string(), n: z.number().int() });
const call = { name: "test", model: "m", system: "s", prompt: "p", schema: Schema };

describe("runStructured", () => {
  it("structured_output'u şemayla doğrular, maliyeti döndürür ve araçları kapatır", async () => {
    const seen: { options?: unknown } = {};
    const res = await runStructured(call, {
      queryFn: fakeQuery({ subtype: "success", structured_output: { title: "x", n: 3 } }, seen),
    });
    expect(res).toEqual({ data: { title: "x", n: 3 }, name: "test", costUsd: 0.0123, model: "m", durationMs: 1200 });
    expect(seen.options).toMatchObject({
      tools: [],
      settingSources: [],
      persistSession: false,
      outputFormat: { type: "json_schema" },
    });
    // Claude Code draft 2020-12 meta-şemasını reddediyor (gerçek çağrıda yakalandı).
    const schema = (seen.options as { outputFormat: { schema: Record<string, unknown> } }).outputFormat.schema;
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ type: "object", required: ["title", "n"] });
  });

  it("şemaya uymayan çıktıda hata verir", async () => {
    await expect(
      runStructured(call, { queryFn: fakeQuery({ subtype: "success", structured_output: { title: 1 } }) }),
    ).rejects.toBeInstanceOf(AgentError);
  });

  it("görselleri metinden önce base64 görsel bloğu olarak gönderir", async () => {
    let prompt: unknown;
    const queryFn = ((params: { prompt: unknown }) => {
      prompt = params.prompt;
      return (async function* () {
        yield { type: "result", subtype: "success", duration_ms: 1, total_cost_usd: 0.001, structured_output: { title: "x", n: 1 } };
      })();
    }) as unknown as QueryFn;
    await runStructured({ ...call, images: [{ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }] }, { queryFn });

    const messages = [];
    for await (const m of prompt as AsyncIterable<{ message: { content: unknown[] } }>) messages.push(m);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      { type: "text", text: "p" },
    ]);
  });

  it("başarısız sonucu (ör. bütçe aşımı) hata olarak iletir", async () => {
    await expect(
      runStructured(call, { queryFn: fakeQuery({ subtype: "error_max_budget_usd" }) }),
    ).rejects.toThrow(/error_max_budget_usd/);
  });
});

describe("wordsPerMinute", () => {
  it("dile göre konuşma hızı; ölçülmüş değer varsa onu kullanır", () => {
    expect(wordsPerMinute({ lang: "tr" })).toBe(115);
    expect(wordsPerMinute({ lang: "pt-BR" })).toBe(150);
    expect(wordsPerMinute({ lang: "xx" })).toBe(140);
    expect(wordsPerMinute({ lang: "tr", wordsPerMinute: 108 })).toBe(108);
  });
});

describe("indexWords", () => {
  it("anlatımı Director için indeksler", () => {
    expect(indexWords("Bir  gün\norman").annotated).toBe("[0]Bir [1]gün [2]orman");
  });
});

describe("alt süreç çökmesi", () => {
  it("Claude Code süreci düşerse yeniden denenir; model hatası denenmez", async () => {
    let calls = 0;
    const flaky = (() => {
      calls++;
      return (async function* () {
        if (calls === 1) throw new Error("Claude Code process exited with code 3221226505");
        yield { type: "result", subtype: "success", duration_ms: 1, total_cost_usd: 0.001, structured_output: { ok: true } };
      })();
    }) as unknown as QueryFn;
    vi.useFakeTimers();
    const pending = runStructured({ name: "t", model: "m", system: "", prompt: "", schema: z.object({ ok: z.boolean() }) }, { queryFn: flaky });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await pending;
    vi.useRealTimers();
    expect(res.data.ok).toBe(true);
    expect(calls).toBe(2);

    let modelCalls = 0;
    const turns = (() => {
      modelCalls++;
      return (async function* () {
        yield { type: "result", subtype: "error_max_turns", duration_ms: 1, total_cost_usd: 0.01 };
      })();
    }) as unknown as QueryFn;
    await expect(runStructured({ name: "t", model: "m", system: "", prompt: "", schema: z.object({}) }, { queryFn: turns })).rejects.toThrow(AgentError);
    expect(modelCalls).toBe(1);
  });
});
