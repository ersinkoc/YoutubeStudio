import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putJson } from "@ys/storage";
import { dbCalls, fakeProvider, lastChild, quotaCalls, registry, resetStudio, spawn } from "./fakes.ts";

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<object>()), spawn: (await import("./fakes.ts")).spawn }));
vi.mock("@ys/media-gateway", async (orig) => ({
  ...(await orig<object>()),
  createProvidersFromEnv: (await import("./fakes.ts")).createProvidersFromEnv,
}));
vi.mock("@ys/db", async () => {
  const f = await import("./fakes.ts");
  return { createDb: f.createDb, DbCostLedger: f.FakeDbLedger };
});

const root = await vi.hoisted(async () => {
  const { tempRoot } = await import("./fakes.ts");
  const dir = tempRoot();
  process.env.YS_ROOT = dir;
  delete process.env.STORE;
  delete process.env.LEDGER;
  return dir;
});

const server = await import("../../src/lib/server.ts");

const lockOf = (id: string, pid: number) =>
  putJson(server.store(), `episodes/${id}/run.lock.json`, { pid, host: hostname(), startedAt: "t" });
/** Var olmayan (ölmüş) süreç kimliği. */
const DEAD_PID = 2 ** 22 + 12345;

beforeEach(() => {
  resetStudio();
  registry.providers = [];
  registry.skipped = [];
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.LEDGER;
  delete process.env.DATABASE_URL;
});

describe("Stüdyo sunucusu: kök ve kurulum", () => {
  it("ROOT, YS_ROOT'tan çözülür; .env dosyası yüklenir ve JSONL defter okunur", async () => {
    expect(server.ROOT).toBe(root);
    writeFileSync(join(root, ".env"), "YS_STUDIO_TEST_ENV=yuklendi\n");
    mkdirSync(join(root, ".data"), { recursive: true });
    const entry = (over: object) =>
      JSON.stringify({ at: "2026-10-30T00:00:00Z", providerId: "fake:tts", capability: "tts", estimateMicros: 2_000_000, cacheHit: false, requestHash: "h", ...over });
    writeFileSync(
      join(root, ".data", "ledger.jsonl"),
      [entry({ episodeId: "e1", durationMs: 1000 }), entry({ episodeId: "e1", capability: "llm" }), entry({ episodeId: "e2" })].join("\n") + "\n",
    );
    expect(await server.episodeSpentUsd("e1")).toBe(2);
    expect(process.env.YS_STUDIO_TEST_ENV).toBe("yuklendi");
    expect(await server.ledgerEntries("e1")).toHaveLength(2);
    expect(await server.ledgerEntries()).toHaveLength(3);

    registry.providers = [fakeProvider({ id: "fake:tts" })];
    resetStudio();
    const ctx = await server.estimateContext();
    expect(ctx.providers.map((p) => p.id)).toEqual(["fake:tts"]);
    expect(ctx.latency["fake:tts"]).toEqual({ avgMs: 1000, n: 1 });
  });

  it(".env yoksa atlanır; YS_ROOT yoksa kök çalışma klasörünün iki üstüdür", async () => {
    rmSync(join(root, ".env"), { force: true });
    expect(await server.ledgerEntries("hiç")).toEqual([]);
    const saved = process.env.YS_ROOT;
    delete process.env.YS_ROOT;
    try {
      vi.resetModules();
      const fresh = await import("../../src/lib/server.ts");
      expect(fresh.ROOT).toBe(resolve(process.cwd(), "..", ".."));
    } finally {
      process.env.YS_ROOT = saved;
    }
  });

  it("LEDGER=db ve DATABASE_URL varsa Postgres defteri kullanılır", async () => {
    process.env.LEDGER = "db";
    process.env.DATABASE_URL = "postgres://test";
    expect(await server.episodeSpentUsd("e1")).toBe(7);
    expect(dbCalls).toContain("postgres://test");
  });

  it("catalog etkin ve atlanan sağlayıcıları verir; Studio tek kez kurulur", () => {
    registry.providers = [fakeProvider({ id: "a" })];
    registry.skipped = ["fal:* (FAL_KEY yok)"];
    const c = server.catalog();
    expect(c.providers.map((p) => p.id)).toEqual(["a"]);
    expect(c.skipped).toEqual(["fal:* (FAL_KEY yok)"]);
    expect(server.repo()).toBe(server.repo());
  });

  it("kota 60 sn önbelleklenir, süre dolunca yeniden sorulur", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    registry.providers = [fakeProvider({ id: "q", quotaValue: { unit: "chars", used: 1, limit: 10 } })];
    expect(await server.quotaOf("q")).toEqual({ unit: "chars", used: 1, limit: 10 });
    expect(await server.quotaOf("q")).toEqual({ unit: "chars", used: 1, limit: 10 });
    expect(quotaCalls).toEqual(["q"]);
    vi.setSystemTime(new Date("2026-10-31T10:01:01Z"));
    await server.quotaOf("q");
    expect(quotaCalls).toEqual(["q", "q"]);
    // Kotası olmayan sağlayıcı: undefined (yine önbelleğe yazılır).
    expect(await server.quotaOf("yok")).toBeUndefined();
  });
});

describe("arka plan işleri", () => {
  it("startJob CLI'ı ayrı süreçte başlatır, çıktıyı satır satır toplar ve 0 ile biterse 'done' olur", () => {
    const view = server.startJob("e1", "job.script", ["episode", "run", "e1", "--until", "script"]);
    expect(view.status).toBe("running");
    expect(view).not.toHaveProperty("child");
    expect(spawn).toHaveBeenCalledTimes(1);
    const child = lastChild();
    expect(child.command).toBe(process.execPath);
    expect(child.args[0]).toBe(join(root, "node_modules", "tsx", "dist", "cli.mjs"));
    expect(child.args.slice(1)).toEqual([join(root, "apps", "cli", "src", "index.ts"), "episode", "run", "e1", "--until", "script"]);
    expect(child.options).toMatchObject({ cwd: root, windowsHide: true });

    child.stdout.emit("data", Buffer.from("▶ style\r\n\n  \nikinci satır\n"));
    child.stderr.emit("data", Buffer.from("uyarı"));
    expect(server.getJob("e1")?.log).toEqual(["▶ style", "ikinci satır", "uyarı"]);
    // Kayıt dışarıya kopya olarak verilir.
    server.getJob("e1")!.log.push("dışarıdan");
    expect(server.getJob("e1")?.log).toHaveLength(3);

    expect(() => server.startJob("e1", "job.concept", [])).toThrow("Zaten çalışan bir iş var: job.script");

    child.emit("exit", 0, null);
    child.emit("close", 1, null); // "exit"ten sonra gelen "close" sonucu değiştirmez.
    const done = server.getJob("e1")!;
    expect(done.status).toBe("done");
    expect(done.endedAt).toBeDefined();
    expect(done.log).not.toContain("Süreç çıkış kodu: 1 (0x1)");
  });

  it("kayıt en çok 400 satır tutar", () => {
    server.startJob("e1", "job.script", []);
    const lines = Array.from({ length: 450 }, (_, i) => `satır ${i}`).join("\n");
    lastChild().stdout.emit("data", Buffer.from(lines));
    const log = server.getJob("e1")!.log;
    expect(log).toHaveLength(400);
    expect(log[0]).toBe("satır 50");
  });

  it("sıfır olmayan çıkış kodu Windows onaltılığıyla, sinyal adıyla kaydedilir", () => {
    server.startJob("e1", "job.script", []);
    lastChild().emit("exit", -1073740791, null);
    expect(server.getJob("e1")).toMatchObject({ status: "error" });
    expect(server.getJob("e1")!.log.at(-1)).toBe("Süreç çıkış kodu: -1073740791 (0xC0000409)");

    server.startJob("e2", "job.script", []);
    lastChild().emit("close", null, "SIGTERM");
    expect(server.getJob("e2")!.log.at(-1)).toBe("Süreç çıkış kodu: SIGTERM");
    // Biten işin yerine yenisi başlatılabilir.
    expect(server.startJob("e2", "job.resume", []).status).toBe("running");
  });

  it("cancelJob yalnız çalışan işi öldürür", () => {
    server.cancelJob("yok");
    server.startJob("e1", "job.script", []);
    const child = lastChild();
    server.cancelJob("e1");
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(server.getJob("e1")!.log).toEqual(["İptal edildi."]);
    child.emit("exit", null, "SIGTERM");
    server.cancelJob("e1");
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(server.getJob("yok")).toBeUndefined();
  });
});

describe("episodeBusy", () => {
  it("işsiz bölüm: canlı kilit meşgul; ölü kilit ya da 'running' olmayan dosya boş", async () => {
    expect(await server.episodeBusy("b1", {}, "idle")).toBe(false);
    // Bu testin ana süreci (vitest) canlı bir başka süreçtir.
    await lockOf("b1", process.ppid);
    expect(await server.episodeBusy("b1", {}, "idle")).toBe(true);
    await lockOf("b1", DEAD_PID);
    expect(await server.episodeBusy("b1", {}, "running")).toBe(false);
    // Kilit yok ama dosya "sürüyor" diyor (CLI işi, kilitsiz): meşgul sayılır.
    expect(await server.episodeBusy("b2", { heartbeatAt: "2026-10-31T10:00:00Z" }, "running")).toBe(true);
  });

  it("Stüdyo işi son kayıttan sonra bittiyse dosyadaki 'sürüyor' bayattır", async () => {
    server.startJob("b3", "job.script", []);
    lastChild().emit("exit", 1, null);
    const endedAt = server.getJob("b3")!.endedAt!;
    expect(await server.episodeBusy("b3", { heartbeatAt: "2000-01-01T00:00:00Z" }, "running")).toBe(false);
    expect(await server.episodeBusy("b3", {}, "running")).toBe(false);
    expect(await server.episodeBusy("b3", { heartbeatAt: "2999-01-01T00:00:00Z" }, "running")).toBe(true);
    expect(endedAt < "2999").toBe(true);
  });

  it("çalışan iş: kilit ya da 'running' dosya meşgul; yeni başlamış ya da yakın zamanda duran süreç öldürülmez", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    server.startJob("b4", "job.script", []);
    await lockOf("b4", process.ppid);
    expect(await server.episodeBusy("b4", {}, "idle")).toBe(true);
    await lockOf("b4", DEAD_PID);
    expect(await server.episodeBusy("b4", {}, "running")).toBe(true);
    // Kalp atışı yok (süreç kilidi henüz almadı): yaşıyor sayılır.
    expect(await server.episodeBusy("b4", {}, "idle")).toBe(true);
    // Kalp atışı işten önce: bu süreç henüz bir şey yazmadı.
    expect(await server.episodeBusy("b4", { heartbeatAt: "2026-10-31T09:00:00Z" }, "idle")).toBe(true);
    vi.setSystemTime(new Date("2026-10-31T10:00:30Z"));
    // Pipeline 20 sn önce durdu: bekleme süresi dolmadı.
    expect(await server.episodeBusy("b4", { heartbeatAt: "2026-10-31T10:00:10Z" }, "idle")).toBe(true);
    expect(lastChild().kill).not.toHaveBeenCalled();
  });

  it("pipeline bittikten 60 sn sonra kapanmayan süreç ölü iştir: öldürülür ve hata olarak kapanır", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    server.startJob("b5", "job.produce", []);
    const child = lastChild();
    vi.setSystemTime(new Date("2026-10-31T10:05:00Z"));
    expect(await server.episodeBusy("b5", { heartbeatAt: "2026-10-31T10:01:00Z" }, "done")).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);
    const job = server.getJob("b5")!;
    expect(job.status).toBe("error");
    expect(job.endedAt).toBe("2026-10-31T10:05:00.000Z");
    expect(job.log.at(-1)).toBe("Süreç pipeline bittikten sonra kapanmadı; sonlandırıldı.");
    // Sonradan gelen çıkış olayı kaydı değiştirmez.
    child.emit("exit", 0, null);
    expect(server.getJob("b5")!.status).toBe("error");
  });
});

