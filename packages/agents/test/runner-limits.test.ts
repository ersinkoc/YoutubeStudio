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

  it("sonuç mesajı gelmeden akış biterse alt süreç düşmüş sayılır: iki kez yeniden denenir, sonra hata", async () => {
    vi.useFakeTimers();
    let n = 0;
    const empty = (() => {
      n++;
      return (async function* () {
        yield { type: "assistant" };
      })();
    }) as unknown as QueryFn;
    const run = runStructured(call, { queryFn: empty }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await run;
    expect(err).toBeInstanceOf(AgentError);
    expect((err as Error).message).toBe("t: sonuç mesajı gelmedi");
    expect(n).toBe(3);
  });

  it("'success' ama is_error: API aşırı yükü (529) geçicidir, yeniden denenir; düşen denemenin maliyeti sonuca eklenir", async () => {
    vi.useFakeTimers();
    let n = 0;
    const flaky = (() => {
      n++;
      return (async function* () {
        if (n === 1) {
          yield { type: "result", subtype: "success", is_error: true, api_error_status: 529, result: "Overloaded", duration_ms: 1, total_cost_usd: 0.01 };
        } else {
          yield { type: "result", subtype: "success", is_error: false, duration_ms: 1, total_cost_usd: 0.02, structured_output: { ok: true } };
        }
      })();
    }) as unknown as QueryFn;
    const run = runStructured(call, { queryFn: flaky });
    await vi.runAllTimersAsync();
    const res = await run;
    expect(n).toBe(2);
    expect(res.costUsd).toBeCloseTo(0.03);
  });

  it("is_error ama kalıcı (400) ya da durum kodsuz API hatası yeniden denenmez; neden mesajda", async () => {
    for (const status of [400, null]) {
      let n = 0;
      const bad = (() => {
        n++;
        return (async function* () {
          yield { type: "result", subtype: "success", is_error: true, api_error_status: status, result: "invalid request", duration_ms: 1, total_cost_usd: 0.004 };
        })();
      }) as unknown as QueryFn;
      const err = (await runStructured(call, { queryFn: bad }).catch((e: unknown) => e)) as InstanceType<typeof AgentError>;
      expect(n).toBe(1);
      expect(err.transient).toBe(false);
      expect(err.costUsd).toBe(0.004);
      expect(err.message).toBe(`t: API hatası${status ? ` ${status}` : ""}: invalid request`);
    }
  });

  it("durum kodsuz ağ hatası (bağlantı reddi/kopması) geçicidir, yeniden denenir", async () => {
    vi.useFakeTimers();
    let n = 0;
    const flaky = (() => {
      n++;
      return (async function* () {
        if (n === 1) {
          // Gerçek CLI çıktısı (ANTHROPIC_BASE_URL erişilemezken, 31 Eki).
          yield { type: "result", subtype: "success", is_error: true, api_error_status: null, result: "API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)", duration_ms: 1, total_cost_usd: 0 };
        } else {
          yield { type: "result", subtype: "success", is_error: false, duration_ms: 1, total_cost_usd: 0.02, structured_output: { ok: true } };
        }
      })();
    }) as unknown as QueryFn;
    const run = runStructured(call, { queryFn: flaky });
    await vi.runAllTimersAsync();
    expect((await run).costUsd).toBeCloseTo(0.02);
    expect(n).toBe(2);
  });

  it("hata alt türünde modelin hata metinleri mesaja eklenir; kalıcı hatada önceki geçici denemelerin maliyeti de taşınır", async () => {
    vi.useFakeTimers();
    let n = 0;
    const q = (() => {
      n++;
      return (async function* () {
        if (n === 1) yield { type: "result", subtype: "success", is_error: true, api_error_status: 503, result: "x", duration_ms: 1, total_cost_usd: 0.01 };
        else yield { type: "result", subtype: "error_max_structured_output_retries", errors: ["şema tutmadı"], duration_ms: 1, total_cost_usd: 0.05 };
      })();
    }) as unknown as QueryFn;
    const run = runStructured(call, { queryFn: q }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await run) as InstanceType<typeof AgentError>;
    expect(err.message).toBe("t: error_max_structured_output_retries: şema tutmadı (maliyet $0.0500)");
    expect(err.costUsd).toBeCloseTo(0.06);
    expect(err.transient).toBe(false);
  });

  it("takılan alt süreç zaman aşımında durdurulur ve geçici sayılır (akış hata verse de, sessizce bitse de)", async () => {
    vi.useFakeTimers();
    process.env.YS_AGENT_TIMEOUT_MS = "10000";
    try {
      for (const mode of ["throw", "end"] as const) {
        let n = 0;
        const hang = ((params: { options: { abortController: AbortController } }) => {
          n++;
          const signal = params.options.abortController.signal;
          return (async function* () {
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
            if (mode === "throw") throw new Error("aborted");
          })();
        }) as unknown as QueryFn;
        const run = runStructured(call, { queryFn: hang }).catch((e: unknown) => e);
        await vi.runAllTimersAsync();
        const err = (await run) as InstanceType<typeof AgentError>;
        expect(err.message).toBe("t: 10 sn içinde bitmedi");
        expect(err.transient).toBe(true);
        expect(n).toBe(3);
      }
    } finally {
      delete process.env.YS_AGENT_TIMEOUT_MS;
    }
  });

  it("zaman aşımı dışındaki akış hatası olduğu gibi yukarı çıkar", async () => {
    const boom = (() =>
      (async function* () {
        throw new Error("beklenmeyen");
      })()) as unknown as QueryFn;
    await expect(runStructured(call, { queryFn: boom })).rejects.toThrow("beklenmeyen");
  });

  it("alt süreç kullanıcının ~/.claude ayarlarından yalıtılır", async () => {
    sdk.calls = [];
    await runStructured(call);
    const options = (sdk.calls[0] as { options: Record<string, unknown> }).options;
    expect(options).toMatchObject({
      settingSources: [],
      strictMcpConfig: true,
      skills: [],
      verbatimPrompts: true,
      settings: { disableClaudeAiConnectors: true, syncClaudeAiPlugins: false, syncClaudeAiSkills: false, disableAllHooks: true },
      env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
    });
    expect(options.abortController).toBeInstanceOf(AbortController);
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
