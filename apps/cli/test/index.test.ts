import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_PACKS } from "@ys/core";
import type { CostEntry, GenerationRequest, ProviderAdapter, RunOptions } from "@ys/media-gateway";
import { loadLessons, saveLessons } from "@ys/pipeline/light";
import { FsAssetStore, putJson } from "@ys/storage";

/**
 * CLI giriş noktası: modül içe aktarılınca main() çalışır ve process.exit ile biter. Her test modülü yeniden yükler,
 * process.exit'i yakalar ve çıktıyı toplar. Gerçek üretim, Claude ya da Postgres çağrısı yapılmaz; çalışma klasörü
 * geçici bir dizindir.
 */

const fake = vi.hoisted(() => {
  const state = {
    providers: [] as ProviderAdapter[],
    skipped: [] as string[],
    gateways: [] as { opts: Record<string, unknown>; generated: [GenerationRequest, RunOptions][]; planned: [GenerationRequest, unknown][] }[],
    planResult: [] as { adapter: { id: string }; estimateMicros: number; score: number }[],
    pipelines: [] as Record<string, unknown>[],
    dbUrls: [] as string[],
    dbRecords: [] as unknown[],
    curateCalls: 0,
  };
  class FakeGateway {
    readonly generated: [GenerationRequest, RunOptions][] = [];
    readonly planned: [GenerationRequest, unknown][] = [];
    constructor(readonly opts: { log?: (m: string) => void }) {
      opts.log?.("ağ geçidi günlüğü");
      state.gateways.push(this as never);
    }
    plan(req: GenerationRequest, policy: unknown) {
      this.planned.push([req, policy]);
      return state.planResult;
    }
    async generate(req: GenerationRequest, run: RunOptions) {
      this.generated.push([req, run]);
      return { providerId: "fake:p", costMicros: 1_250_000, cacheHit: false, files: [{ uri: "assets/x.png" }], words: req.capability === "tts" ? [{}, {}] : undefined };
    }
  }
  class FakePipeline {
    constructor(opts: { log: (m: string) => void; agentDeps: { log: (m: string) => void } }) {
      opts.log("pipeline günlüğü");
      opts.agentDeps.log("ajan günlüğü");
      state.pipelines.push(opts as never);
    }
  }
  class FakeDbLedger {
    constructor(db: { url: string }) {
      state.dbUrls.push(db.url);
    }
    async spent() {
      return 3_500_000;
    }
    async record(e: unknown) {
      state.dbRecords.push(e);
    }
  }
  return { state, FakeGateway, FakePipeline, FakeDbLedger };
});

// Gerçek modüller bir kez yüklenir: her çalıştırmada CLI yeniden yüklense de yeniden derlenmez (yük altında hızlı).
const real = await vi.hoisted(async () => ({ light: await import("@ys/pipeline/light"), gateway: await import("@ys/media-gateway") }));

vi.mock("@ys/media-gateway", () => ({
  ...real.gateway,
  createProvidersFromEnv: () => ({ providers: fake.state.providers, skipped: fake.state.skipped }),
  MediaGateway: fake.FakeGateway,
}));
vi.mock("@ys/db", () => ({ createDb: (url: string) => ({ url }), DbCostLedger: fake.FakeDbLedger }));
vi.mock("@ys/pipeline", () => ({
  ...real.light,
  EpisodePipeline: fake.FakePipeline,
  curateLessons: async (
    book: { lessons: { target: string; rule: string; count: number }[] },
    opts: { deps: { log: (m: string) => void }; onCall: (t: string, res: unknown, before: number) => Promise<void> },
  ) => {
    fake.state.curateCalls++;
    opts.deps.log("küratör günlüğü");
    // Yönetmen kuralları tek kurala birleşir.
    const before = book.lessons.filter((l) => l.target === "director").length;
    book.lessons = [...book.lessons.filter((l) => l.target !== "director"), { ...book.lessons.find((l) => l.target === "director")!, rule: "birleşik kural", count: 3 }];
    await opts.onCall("director", { model: "claude-haiku-5-5", costUsd: 0.01, durationMs: 1200, data: { rules: [{ rule: "birleşik kural" }] } }, before);
    return book;
  },
}));
const episodeMod = vi.hoisted(() => ({ episodeCommand: vi.fn(async () => {}), renderDemo: vi.fn(async () => {}) }));
vi.mock("../src/episode.ts", async (orig) => ({ ...(await orig<object>()), ...episodeMod }));

const cwd = process.cwd();
let dir = "";

beforeAll(() => {
  delete process.env.STORE;
  delete process.env.LEDGER;
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ys-cli-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "4.5.6" }));
  process.chdir(dir);
  Object.assign(fake.state, { providers: [], skipped: [], gateways: [], planResult: [], pipelines: [], dbUrls: [], dbRecords: [], curateCalls: 0 });
  episodeMod.episodeCommand.mockReset();
  episodeMod.renderDemo.mockReset();
});
afterEach(() => {
  process.chdir(cwd);
  delete process.env.LEDGER;
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});
afterAll(() => {
  process.exitCode = undefined;
});

/** CLI'ı verilen argümanlarla çalıştırır; çıkış kodunu ve çıktıyı döndürür. */
async function cli(...args: string[]): Promise<{ code: number; out: string; err: string; fail: string | undefined }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.map(String).join(" ")));
  process.argv = [process.execPath, "index.ts", ...args];
  vi.resetModules();
  const code = await new Promise<number>((resolve, reject) => {
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      resolve(Number(c ?? 0));
      return undefined as never;
    }) as typeof process.exit);
    import("../src/index.ts").catch(reject);
  });
  vi.restoreAllMocks();
  // fail: stderr'in son satırı (hata mesajı; öncesinde ağ geçidi günlükleri olabilir).
  return { code, out: out.join("\n"), err: err.join("\n"), fail: err.at(-1) };
}

const provider = (over: Partial<ProviderAdapter> & { id: string }): ProviderAdapter => ({
  local: false,
  capabilities: ["t2i"],
  limits: {},
  qualityPrior: 0.75,
  price: { unit: "per_output", usd: 0.04 },
  generate: async () => {
    throw new Error("testte üretim yapılmaz");
  },
  ...over,
});
const lastGateway = () => fake.state.gateways.at(-1)!;

describe("yardım, sürüm ve listeler", () => {
  it("komutsuz ya da --help yardım basar ve 0 ile çıkar", async () => {
    for (const args of [[], ["--help"], ["providers", "-h"]]) {
      const r = await cli(...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Kullanım: pnpm ys <komut>");
    }
  });

  it(".env dosyası yüklenir; version kök package.json'dan", async () => {
    writeFileSync(join(dir, ".env"), "YS_CLI_TEST_ENV=evet\n");
    expect((await cli("version")).out).toBe("AI Video Factory v4.5.6");
    expect(process.env.YS_CLI_TEST_ENV).toBe("evet");
    writeFileSync(join(dir, "package.json"), "{}");
    expect((await cli("--version")).out).toBe("AI Video Factory v0.0.0");
  });

  it("styles tüm paketleri listeler", async () => {
    const r = await cli("styles");
    expect(r.out.split("\n")).toHaveLength(STYLE_PACKS.length);
    expect(r.out).toContain(STYLE_PACKS[0]!.name.tr);
  });

  it("providers fiyatı, kaliteyi ve atlananları gösterir", async () => {
    fake.state.providers = [provider({ id: "comfy:flux", local: true, price: { unit: "free" } }), provider({ id: "fal:x", capabilities: ["t2i", "i2i_multiref"] })];
    fake.state.skipped = ["eleven:* (ELEVENLABS_API_KEY yok)"];
    const r = await cli("providers");
    expect(r.out).toMatch(/comfy:flux\s+q=0\.75 {2}ücretsiz/);
    expect(r.out).toMatch(/fal:x\s+q=0\.75 {2}\$0\.04 per_output\s+t2i, i2i_multiref/);
    expect(r.out).toContain("Atlananlar:\n  eleven:* (ELEVENLABS_API_KEY yok)");
  });

  it("library kütüphanedeki karakterleri listeler; --backfill kimlik yazar", async () => {
    const store = new FsAssetStore(join(dir, ".data", "assets"));
    const check = { kind: "character", name: "x", recognizable: 8, passed: true, defects: [], attempts: 1, sources: [], refs: [] };
    await putJson(store, `library/vector/character/${"a".repeat(32)}.svg.json`, {
      check,
      identity: { name: "Fatih", description: "d", artStyle: "noir", lineStyle: "ink", pack: "noir-pack", episodes: ["e1", "e2"] },
    });
    await putJson(store, `library/vector/character/${"b".repeat(32)}.svg.json`, {
      check,
      identity: { name: "Özel", description: "d", artStyle: "noir", lineStyle: "flat", episodes: [] },
    });
    const r = await cli("library");
    expect(r.out).toMatch(/^aaaaaaaa {2}Fatih\s+noir-pack\s+ink\s+2 bölüm$/m);
    expect(r.out).toMatch(/^bbbbbbbb {2}Özel\s+özel\s+flat\s+0 bölüm$/m);
    expect((await cli("library", "--backfill")).out).toContain("0 karaktere kimlik yazıldı");
    // Karakter bankası komutu aynı kütüphaneyi listeler.
    expect((await cli("bank")).out).toMatch(/^aaaaaaaa {2}Fatih\s+noir-pack\s+ink\s+2 bölüm$/m);
    expect(fake.state.pipelines.length).toBeGreaterThan(0);
  });
});

describe("cost", () => {
  it("JSONL defterini sağlayıcıya göre özetler; --episode süzer", async () => {
    mkdirSync(join(dir, ".data"));
    const e = (o: Partial<CostEntry>) => JSON.stringify({ at: "t", providerId: "fal:x", capability: "t2i", estimateMicros: 1_000_000, cacheHit: false, requestHash: "h", ...o });
    writeFileSync(join(dir, ".data", "ledger.jsonl"), [e({ episodeId: "e1" }), e({ episodeId: "e1", cacheHit: true }), e({ episodeId: "e2", providerId: "eleven:v3", estimateMicros: 500_000 })].join("\n") + "\n");
    const all = await cli("cost");
    expect(all.out).toMatch(/fal:x\s+2 çağrı\s+1 önbellek {2}\$1\.00/);
    expect(all.out).toMatch(/eleven:v3\s+1 çağrı\s+0 önbellek {2}\$0\.50/);
    expect(all.out).toMatch(/TOPLAM\s+\$1\.50/);
    const one = await cli("cost", "--episode", "e2");
    expect(one.out).not.toContain("fal:x");
    expect(one.out).toMatch(/TOPLAM\s+\$0\.50/);
  });

  it("LEDGER=db: bölüm harcamasını Postgres defterinden okur, bölümsüz uyarır", async () => {
    process.env.LEDGER = "db";
    process.env.DATABASE_URL = "postgres://test";
    expect((await cli("cost", "--episode", "e1")).out).toBe("$3.50");
    expect(fake.state.dbUrls).toContain("postgres://test");
    expect((await cli("cost")).out).toBe("--episode gerekli (LEDGER=db)");
  });
});

describe("lessons", () => {
  const lesson = (target: string, rule: string, count: number) => ({ target, rule, count, firstSeen: "t", lastSeen: "t", episodes: [] });
  const store = () => new FsAssetStore(join(dir, ".data", "assets"));

  it("hedefe göre, sayıca çok olan önce listeler; Claude çağrılmaz", async () => {
    await saveLessons(store(), { lessons: [lesson("director", "az", 1), lesson("director", "çok", 4), lesson("script", "senaryo", 2)] } as never);
    const r = await cli("lessons");
    expect(r.out).toContain("director:\n  [4] çok\n  [1] az");
    expect(r.out).toContain("designer:\n\nscript:\n  [2] senaryo");
    expect(fake.state.curateCalls).toBe(0);
  });

  it("--curate birleştirir, maliyeti deftere yazar ve defteri kaydeder", async () => {
    await saveLessons(store(), { lessons: [lesson("director", "a", 1), lesson("director", "b", 2)] } as never);
    const r = await cli("lessons", "--curate");
    expect(r.code).toBe(0);
    expect(r.err).toContain("küratör günlüğü");
    expect(r.err).toContain("director: 2 → 1 kural");
    expect(r.out).toContain("[3] birleşik kural");
    expect((await loadLessons(store())).lessons.map((l) => l.rule)).toEqual(["birleşik kural"]);
    const ledger = readFileSync(join(dir, ".data", "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as CostEntry);
    expect(ledger).toEqual([
      expect.objectContaining({ stage: "review", providerId: "claude:claude-haiku-5-5", capability: "llm", estimateMicros: 10_000, cacheHit: false, requestHash: "lessons:director", durationMs: 1200 }),
    ]);
  });
});

describe("episode ve render-demo", () => {
  it("episode alt komutu bayraklarla episodeCommand'a gider; günlükler stderr'e", async () => {
    const r = await cli("episode", "select", "e1", "c1=2", "--no-qa", "--no-realism", "--style-pack", "noir", "--minutes", "2", "--lang", "en", "--series", "S");
    expect(r.code).toBe(0);
    expect(episodeMod.episodeCommand).toHaveBeenCalledTimes(1);
    const [pipeline, sub, id, args] = episodeMod.episodeCommand.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>];
    expect(pipeline).toBeInstanceOf(fake.FakePipeline);
    expect(sub).toBe("select");
    expect(id).toBe("e1");
    expect(args).toMatchObject({ noQa: true, noRealism: true, stylePack: "noir", gate: "c1=2", pick: "c1=2", minutes: "2", lang: "en", series: "S", tier: "economy" });
    expect(fake.state.pipelines[0]).toMatchObject({ workDir: ".data/episodes" });
    expect(r.err).toContain("  · ağ geçidi günlüğü");
    expect(r.err).toContain("pipeline günlüğü");
    expect(r.err).toContain("ajan günlüğü");
  });

  it("render-demo API'siz demo hattını çalıştırır", async () => {
    const r = await cli("render-demo");
    expect(r.code).toBe(0);
    expect(episodeMod.renderDemo).toHaveBeenCalledTimes(1);
    expect(episodeMod.episodeCommand).not.toHaveBeenCalled();
  });
});

describe("üretim komutları", () => {
  it("plan para harcamadan sıralamayı gösterir; aday yoksa söyler", async () => {
    const empty = await cli("plan", "--cap", "t2i");
    expect(empty.out).toBe("Uygun sağlayıcı yok.");
    fake.state.planResult = [
      { adapter: { id: "fal:a" }, estimateMicros: 40_000, score: 12.345 },
      { adapter: { id: "fal:b" }, estimateMicros: 1_000_000, score: 1 },
    ];
    const r = await cli("plan", "--cap", "tts", "--text", "merhaba", "--voice", "v1", "--tier", "premium", "--budget", "5", "--provider", "fal:a", "--no-local");
    expect(r.out.split("\n")).toEqual([expect.stringMatching(/^1\. fal:a\s+~\$0\.0400\s+skor=12\.35$/), expect.stringMatching(/^2\. fal:b\s+~\$1\.00\s+skor=1\.00$/)]);
    const [req, policy] = lastGateway().planned[0]!;
    expect(req).toMatchObject({ capability: "tts", text: "merhaba", voiceId: "v1", quality: "standard" });
    expect(policy).toEqual({ tier: "premium", useLocal: false, allow: ["fal:a"] });
    expect(lastGateway().generated).toHaveLength(0);
  });

  it("image: referanssız t2i, referanslı i2i_multiref; sonuç JSON olarak basılır", async () => {
    const r = await cli("image", "--prompt", "kedi", "--negative", "köpek", "--aspect", "9:16", "--seed", "7", "--quality", "hero", "--no-cache");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ provider: "fake:p", cost: "$1.25", cacheHit: false, files: ["assets/x.png"] });
    const [req, run] = lastGateway().generated[0]!;
    expect(req).toMatchObject({ capability: "t2i", prompt: "kedi", negativePrompt: "köpek", aspectRatio: "9:16", seed: 7, quality: "hero", refs: [] });
    expect(run).toMatchObject({ stage: "cli:image", noCache: true, policy: { tier: "economy", useLocal: true } });
    expect(run.budgetCapMicros).toBeUndefined();
    expect(r.err).toContain("· ağ geçidi günlüğü");

    writeFileSync(join(dir, "a.PNG"), new Uint8Array([1, 2]));
    writeFileSync(join(dir, "b.jpeg"), new Uint8Array([3]));
    await cli("image", "--prompt", "x", "--ref", "a.PNG", "--ref", "b.jpeg");
    const [refReq] = lastGateway().generated[0]!;
    expect(refReq.capability).toBe("i2i_multiref");
    expect(refReq.refs?.map((r) => [r.role, r.mimeType, [...r.bytes]])).toEqual([
      ["character", "image/png", [1, 2]],
      ["character", "image/jpeg", [3]],
    ]);
  });

  it("video: --image zorunlu; tek kareyle i2v, son kareyle first_last_frame", async () => {
    const missing = await cli("video", "--prompt", "x");
    expect(missing.code).toBe(1);
    expect(missing.fail).toBe("--image gerekli");
    writeFileSync(join(dir, "f.webp"), new Uint8Array([1]));
    writeFileSync(join(dir, "l.png"), new Uint8Array([2]));
    await cli("video", "--image", "f.webp", "--duration", "5");
    expect(lastGateway().generated[0]![0]).toMatchObject({ capability: "i2v", durationSec: 5, refs: [{ role: "first_frame", mimeType: "image/webp" }] });
    await cli("video", "--image", "f.webp", "--last", "l.png");
    expect(lastGateway().generated[0]![0]).toMatchObject({ capability: "first_last_frame", refs: [{ role: "first_frame" }, { role: "last_frame", mimeType: "image/png" }] });
  });

  it("desteklenmeyen dosya türü hata", async () => {
    writeFileSync(join(dir, "x.gif"), new Uint8Array([1]));
    const r = await cli("image", "--ref", "x.gif");
    expect(r.code).toBe(1);
    expect(r.fail).toBe("Desteklenmeyen dosya türü: x.gif");
  });

  it("tts metin ister; sfx ve music; bütçe tavanı bölümle birlikte", async () => {
    expect((await cli("tts")).fail).toBe("--text gerekli");
    const tts = await cli("tts", "--text", "merhaba", "--voice", "v", "--lang", "tr", "--episode", "e1", "--budget", "2,5");
    expect(JSON.parse(tts.out).words).toBe(2);
    expect(lastGateway().generated[0]).toEqual([
      expect.objectContaining({ capability: "tts", text: "merhaba", voiceId: "v", language: "tr" }),
      expect.objectContaining({ episodeId: "e1", budgetCapMicros: 2_500_000, stage: "cli:tts" }),
    ]);
    await cli("sfx", "--prompt", "kapı", "--duration", "3");
    expect(lastGateway().generated[0]![0]).toMatchObject({ capability: "sfx", durationSec: 3 });
    await cli("music", "--prompt", "neşeli");
    expect(lastGateway().generated[0]![0]).toMatchObject({ capability: "music" });
  });

  it("bölümsüz --budget ve geçersiz bütçe reddedilir", async () => {
    const noEp = await cli("sfx", "--budget", "3");
    expect(noEp.code).toBe(1);
    expect(noEp.fail).toBe("--budget için --episode <id> de gerekli");
    expect(fake.state.gateways.at(-1)?.generated ?? []).toHaveLength(0);
    expect((await cli("sfx", "--budget", "$5", "--episode", "e1")).fail).toBe("--budget pozitif bir sayı olmalı (ör. 2.5)");
  });

  it("bilinmeyen komut yardımla birlikte hata", async () => {
    const r = await cli("uç");
    expect(r.code).toBe(1);
    expect(r.err).toContain("Bilinmeyen komut: uç");
    expect(r.err).toContain("Kullanım:");
  });
});

describe("çıkış", () => {
  it("process.exitCode korunur", async () => {
    process.exitCode = 3;
    try {
      expect((await cli("styles")).code).toBe(3);
    } finally {
      process.exitCode = undefined;
    }
  });

  it("Error olmayan hata olduğu gibi basılır", async () => {
    episodeMod.renderDemo.mockRejectedValueOnce("düz metin hata" as never);
    const r = await cli("render-demo");
    expect(r.code).toBe(1);
    expect(r.fail).toBe("düz metin hata");
  });
});
