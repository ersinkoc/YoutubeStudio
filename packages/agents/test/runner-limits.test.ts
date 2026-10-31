import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Varsayılan queryFn gerçek Agent SDK'dır: burada sahtesiyle değiştirilir (ağ ve Claude çağrısı yok).
const sdk = vi.hoisted(() => {
  // Eşzamanlılık sınırı modül yüklenirken okunur: ortamdan bağımsız olsun.
  process.env.YS_CLAUDE_CONCURRENCY = "4";
  return { calls: [] as unknown[] };
});
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: unknown) => {
    sdk.calls.push(params);
    return (async function* () {
      yield { type: "result", subtype: "success", duration_ms: 5, total_cost_usd: 0.002, structured_output: { ok: true } };
    })();
  },
}));

const { AgentError, isTransientAgentFailure, lessonsBlock, runStructured } = await import("../src/runner.ts");
type QueryFn = import("../src/runner.ts").QueryFn;

const call = { name: "t", model: "m", system: "s", prompt: "p", schema: z.object({ ok: z.boolean() }) };
const success = () =>
  (async function* () {
    yield { type: "result", subtype: "success", duration_ms: 1, total_cost_usd: 0, structured_output: { ok: true } };
  })();

afterEach(() => vi.useRealTimers());

describe("runStructured: kalan durumlar", () => {
  it("queryFn verilmezse SDK'nın query()'si kullanılır; bütçe ve efor seçenekleri iletilir", async () => {
    sdk.calls = [];
    const logs: string[] = [];
    const res = await runStructured({ ...call, effort: "low", maxBudgetUsd: 0.5 }, { log: (m) => logs.push(m) });
    expect(res.data).toEqual({ ok: true });
    expect(sdk.calls).toHaveLength(1);
    expect((sdk.calls[0] as { options: unknown }).options).toMatchObject({ effort: "low", maxBudgetUsd: 0.5, model: "m" });
    expect(logs).toEqual(["ajan: t (m)", "ajan: t bitti, $0.0020"]);
  });

  it("kullanıcının model seçimi ajanın varsayılanını ezer", async () => {
    sdk.calls = [];
    const res = await runStructured(call, { models: { t: "x-model" } as never });
    expect(res.model).toBe("x-model");
    expect((sdk.calls[0] as { options: { model: string } }).options.model).toBe("x-model");
  });

  it("sonuç mesajı gelmeden akış biterse hata verir (yeniden denenmez)", async () => {
    let n = 0;
    const empty = (() => {
      n++;
      return (async function* () {
        yield { type: "assistant" };
      })();
    }) as unknown as QueryFn;
    await expect(runStructured(call, { queryFn: empty })).rejects.toThrow("t: sonuç mesajı gelmedi");
    expect(n).toBe(1);
  });

  it("aynı anda en çok 4 Claude süreci çalışır; biten yerini sıradakine verir", async () => {
    const releases: (() => void)[] = [];
    let started = 0;
    const gated = (() => {
      started++;
      return (async function* () {
        await new Promise<void>((r) => releases.push(r));
        yield { type: "result", subtype: "success", duration_ms: 1, total_cost_usd: 0, structured_output: { ok: true } };
      })();
    }) as unknown as QueryFn;
    const runs = Array.from({ length: 6 }, () => runStructured(call, { queryFn: gated }));
    await vi.waitFor(() => expect(started).toBe(4));
    releases.shift()!();
    await vi.waitFor(() => expect(started).toBe(5));
    while (releases.length || started < 6) {
      releases.shift()?.();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all(runs);
    expect(started).toBe(6);
  });

  it("alt süreç üst üste düşerse 2 sn ve 5 sn bekleyip iki kez dener, sonra hatayı iletir", async () => {
    vi.useFakeTimers();
    let n = 0;
    const crash = (() => {
      n++;
      return (async function* () {
        yield* [];
        throw new Error("Claude Code process exited with code 1\nstack");
      })();
    }) as unknown as QueryFn;
    const logs: string[] = [];
    const p = runStructured(call, { queryFn: crash, log: (m) => logs.push(m) }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1999);
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(n).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    const err = await p;
    expect(n).toBe(3);
    expect((err as Error).message).toContain("process exited with code 1");
    expect(logs.filter((l) => l.includes("yeniden deneniyor"))).toEqual([
      "ajan: t alt süreci düştü (Claude Code process exited with code 1), 2 sn sonra yeniden deneniyor",
      "ajan: t alt süreci düştü (Claude Code process exited with code 1), 5 sn sonra yeniden deneniyor",
    ]);
  });

  it("ikinci denemede başarılı olursa sonucu döner", async () => {
    vi.useFakeTimers();
    let n = 0;
    const flaky = (() => (++n === 1 ? (async function* () {
      yield* [];
      throw new Error("spawn claude ENOENT");
    })() : success())) as unknown as QueryFn;
    const p = runStructured(call, { queryFn: flaky });
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).data.ok).toBe(true);
  });
});

describe("yardımcılar", () => {
  it("geçici hata yalnız süreç düzeyindeki Error mesajlarıdır", () => {
    expect(isTransientAgentFailure(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientAgentFailure(new Error("Claude Code process terminated by signal"))).toBe(true);
    expect(isTransientAgentFailure(new AgentError("process exited with code 1"))).toBe(false);
    expect(isTransientAgentFailure("process exited with code 1")).toBe(false);
    expect(isTransientAgentFailure(new Error("şema"))).toBe(false);
  });

  it("ders bloğu boşsa hiçbir şey eklemez", () => {
    expect(lessonsBlock(undefined)).toBe("");
    expect(lessonsBlock([])).toBe("");
    expect(lessonsBlock(["a", "b"])).toBe("\nLessons from previous episodes (follow them):\n- a\n- b");
  });

  it("AgentError maliyeti, modeli ve ajanı taşır", () => {
    const e = new AgentError("x", 0.5, "m", "a");
    expect([e.message, e.costUsd, e.model, e.agent]).toEqual(["x", 0.5, "m", "a"]);
    expect(new AgentError("y").costUsd).toBe(0);
  });
});
