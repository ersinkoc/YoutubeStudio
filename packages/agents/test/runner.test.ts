import { describe, expect, it } from "vitest";
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
    expect(res).toEqual({ data: { title: "x", n: 3 }, costUsd: 0.0123, model: "m", durationMs: 1200 });
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
