import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_CUSTOM, STYLE_PACK_IDS } from "@ys/core";
import type { EpisodeInput, EpisodeState } from "@ys/pipeline/light";
import { getJson, putJson } from "@ys/storage";
import { fakeProvider, lastChild, registry, resetStudio, spawn } from "./fakes.ts";

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<object>()), spawn: (await import("./fakes.ts")).spawn }));
vi.mock("@ys/media-gateway", async (orig) => ({
  ...(await orig<object>()),
  createProvidersFromEnv: (await import("./fakes.ts")).createProvidersFromEnv,
}));

const root = await vi.hoisted(async () => {
  const { tempRoot } = await import("./fakes.ts");
  const dir = tempRoot();
  process.env.YS_ROOT = dir;
  delete process.env.STORE;
  delete process.env.LEDGER;
  return dir;
});

const server = await import("../../src/lib/server.ts");
const assets = await import("../../src/app/api/assets/[...key]/route.ts");
const episodes = await import("../../src/app/api/episodes/route.ts");
const episode = await import("../../src/app/api/episodes/[id]/route.ts");
const action = await import("../../src/app/api/episodes/[id]/action/route.ts");
const video = await import("../../src/app/api/episodes/[id]/video/route.ts");
const estimate = await import("../../src/app/api/estimate/route.ts");
const models = await import("../../src/app/api/settings/models/route.ts");

const INPUT: EpisodeInput = { topic: "Fatih", lang: "tr", targetSec: 120, tier: "economy", aiClipRatio: 0.2, budgetUsd: 5, width: 1920, height: 1080, fps: 30 };

async function saveEpisode(id: string, over: Partial<EpisodeState> = {}, input: Partial<EpisodeInput> = {}): Promise<EpisodeState> {
  const state = { id, createdAt: "2026-10-31T09:00:00.000Z", input: { ...INPUT, ...input }, done: {}, agentCostUsd: 0, ...over } as EpisodeState;
  await server.repo().save(state);
  return state;
}
const load = (id: string) => server.repo().load(id);
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
/** Türkçe tarayıcı: hata metinleri isteğin dilinde döner (İngilizcesi ayrı testte). */
const TR = { "accept-language": "tr-TR,tr;q=0.9" };
const post = (body: unknown, headers: Record<string, string> = TR) =>
  new Request("http://localhost:3100/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const act = (id: string, body: unknown) => action.POST(post(body), params({ id }));
const lockOf = (id: string, pid: number) => putJson(server.store(), `episodes/${id}/run.lock.json`, { pid, host: hostname(), startedAt: "t" });
const DEAD_PID = 2 ** 22 + 12345;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
/** Stil aşaması süren (durum dosyasına göre "çalışıyor") bölüm; heartbeat verilen kadar önce. */
const runningFor = (heartbeatAgoMs: number): Partial<EpisodeState> => ({
  stats: { style: { startedAt: ago(heartbeatAgoMs) } },
  heartbeatAt: ago(heartbeatAgoMs),
});

beforeEach(() => {
  resetStudio();
  registry.providers = [];
  registry.skipped = [];
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/assets/[...key]", () => {
  it("yalnız assets/ ve library/ köklerinden; ayraç, nokta ile başlama ve boş parça yasak", async () => {
    for (const key of [["episodes", "e1", "state.json"], [], ["assets", "..", "x.png"], ["assets", ".gizli"], ["assets", ""], ["assets", "a/b.png"], ["assets", "a\\b.png"], ["library", "a\0b"]]) {
      const res = await assets.GET(new Request("http://x"), params({ key }));
      expect(res.status, key.join("/")).toBe(403);
    }
  });

  it("depodaki varlığı türü ve kalıcı önbellek başlıklarıyla sunar; olmayan 404", async () => {
    await server.store().put("assets/ab/c.PNG", new Uint8Array([1, 2, 3]), "image/png");
    await server.store().put("library/vector/x.svg", new TextEncoder().encode("<svg/>"), "image/svg+xml");
    await server.store().put("assets/ab/bilinmez.xyz", new Uint8Array([9]), "application/octet-stream");

    const png = await assets.GET(new Request("http://x"), params({ key: ["assets", "ab", "c.PNG"] }));
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const svg = await assets.GET(new Request("http://x"), params({ key: ["library", "vector", "x.svg"] }));
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    // Model SVG'si doğrudan açılsa bile betik çalışmaz.
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
    expect(svg.headers.get("x-content-type-options")).toBe("nosniff");

    const other = await assets.GET(new Request("http://x"), params({ key: ["assets", "ab", "bilinmez.xyz"] }));
    expect(other.headers.get("content-type")).toBe("application/octet-stream");

    expect((await assets.GET(new Request("http://x"), params({ key: ["assets", "yok.png"] }))).status).toBe(404);
  });
});

describe("/api/episodes", () => {
  it("GET bölüm özetlerini listeler", async () => {
    await saveEpisode("e-liste", { story: { title: "Başlık" } as EpisodeState["story"], done: { style: "t" }, waitingFor: "script", render: { path: "x.mp4" } as EpisodeState["render"] });
    await saveEpisode("e-bos", { createdAt: "2026-10-30T00:00:00.000Z" } as Partial<EpisodeState>);
    const list = (await (await episodes.GET()).json()) as { id: string }[];
    expect(list).toEqual(
      expect.arrayContaining([
        { id: "e-liste", createdAt: "2026-10-31T09:00:00.000Z", topic: "Fatih", title: "Başlık", lang: "tr", done: ["style"], waitingFor: "script", hasVideo: true },
        { id: "e-bos", createdAt: "2026-10-30T00:00:00.000Z", topic: "Fatih", lang: "tr", done: [], hasVideo: false },
      ]),
    );
  });

  it("POST doğrulama hataları 400", async () => {
    const bad: [object, string][] = [
      [{}, "Konu gerekli"],
      [{ topic: "  " }, "Konu gerekli"],
      [{ topic: "x", minutes: 0.1 }, "Süre 0,5–30 dk olmalı"],
      [{ topic: "x", minutes: "abc" }, "Süre 0,5–30 dk olmalı"],
      [{ topic: "x", minutes: 31 }, "Süre 0,5–30 dk olmalı"],
      [{ topic: "x", budgetUsd: 0 }, "Bütçe pozitif olmalı"],
      [{ topic: "x", budgetUsd: "abc" }, "Bütçe pozitif olmalı"],
    ];
    for (const [body, error] of bad) {
      const res = await episodes.POST(post(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("POST varsayılanlarla bölümü kaydeder ve senaryo işini başlatır", async () => {
    const res = await episodes.POST(post({ topic: "  Kuşatma  ", lang: "türkçe", motionMode: "uçan", tier: "yok", styleHint: "   ", lineStyle: "", stylePack: "yok-boyle" }));
    const { id } = (await res.json()) as { id: string };
    const s = await load(id);
    expect(s.input).toMatchObject({
      topic: "Kuşatma",
      lang: "tr",
      targetSec: 180,
      tier: "standard",
      motionMode: "animated",
      budgetUsd: 20,
      qa: true,
      realism: true,
      stylePack: "auto",
      width: 1920,
      height: 1080,
      autoApprove: false,
    });
    expect(s.input.voiceId).toBeUndefined();
    expect(s.input.styleHint).toBeUndefined();
    expect(s.input.lineStyle).toBeUndefined();
    expect(s.input.series).toBeUndefined();
    expect(lastChild().args.slice(2)).toEqual(["episode", "run", id, "--until", "script"]);
    expect(server.getJob(id)?.label).toBe("job.script");
  });

  it("POST tüm seçenekleri uygular", async () => {
    const res = await episodes.POST(
      post({
        topic: "Dikey",
        lang: "en-US",
        minutes: 1.5,
        budgetUsd: 7,
        tier: "premium",
        motionMode: "vector",
        voiceId: "v1",
        styleHint: "x".repeat(400),
        vertical: true,
        qa: false,
        realism: false,
        lineStyle: "ink",
        stylePack: STYLE_PACK_IDS[0],
        series: "  Osmanlı   Tarihi ",
      }),
    );
    const s = await load(((await res.json()) as { id: string }).id);
    expect(s.input).toMatchObject({ lang: "en-US", targetSec: 90, budgetUsd: 7, tier: "premium", motionMode: "vector", voiceId: "v1", qa: false, realism: false, lineStyle: "ink", stylePack: STYLE_PACK_IDS[0], width: 1080, height: 1920 });
    expect(s.input.styleHint).toHaveLength(300);
    expect(s.input.series).toBe("Osmanlı Tarihi");

    const custom = await episodes.POST(post({ topic: "Özel", stylePack: STYLE_CUSTOM, lineStyle: "bilinmez", voiceId: "" }));
    const c = await load(((await custom.json()) as { id: string }).id);
    expect(c.input.stylePack).toBe(STYLE_CUSTOM);
    expect(c.input.lineStyle).toBeUndefined();
    expect(c.input.voiceId).toBeUndefined();
  });
});

describe("POST /api/estimate", () => {
  it("üç hareket modu ve vektör için tahmin verir; varsayılanlar 3 dk", async () => {
    registry.providers = [fakeProvider({ id: "fake:tts" })];
    const all = (await (await estimate.POST(post({}))).json()) as Record<string, { rows: { stage: string; providerId?: string; quantity: number }[] }>;
    expect(Object.keys(all)).toEqual(["animated", "mixed", "still", "vector"]);
    expect(all.animated!.rows.find((r) => r.stage === "voice")?.providerId).toBe("fake:tts");
    expect(all.animated!.rows.find((r) => r.stage === "render")?.quantity).toBe(180);

    const custom = (await (await estimate.POST(post({ lang: "en", minutes: 1, tier: "premium", motionMode: "still", voiceId: "v", budgetUsd: 3, vertical: true, qa: false }))).json()) as typeof all;
    expect(custom.still!.rows.find((r) => r.stage === "render")?.quantity).toBe(60);
  });
});

describe("/api/settings/models", () => {
  it("GET boş ayar; PUT yalnız geçerli seçimleri yazar ve geri okur", async () => {
    expect(await (await models.GET()).json()).toEqual({});
    const put = await models.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ screenwriter: "claude-haiku-5-5", "yok-rol": "claude-haiku-5-5", "story-architect": "gpt" }) }));
    expect(await put.json()).toEqual({ screenwriter: "claude-haiku-5-5" });
    expect(await (await models.GET()).json()).toEqual({ screenwriter: "claude-haiku-5-5" });
  });
});

describe("GET /api/episodes/[id]", () => {
  const get = async (id: string) => {
    const res = await episode.GET(new Request("http://x", { headers: TR }), params({ id }));
    return { res, body: (await res.json()) as Record<string, any> };
  };

  it("geçersiz kimlik 400, olmayan bölüm 404", async () => {
    const bad = await episode.GET(new Request("http://x"), params({ id: "../x" }));
    expect(bad.status).toBe(400);
    const { res, body } = await get("yok");
    expect(res.status).toBe(404);
    expect(body.error).toBe("Bölüm bulunamadı: yok");
  });

  it("Error olmayan hata metne çevrilir", async () => {
    vi.spyOn(server.repo(), "load").mockRejectedValueOnce("dize hata");
    const { res, body } = await get("e1");
    expect(res.status).toBe(404);
    expect(body.error).toBe("dize hata");
  });

  it("tahminler, defter, harcama, kota ve kütüphane tek yanıtta", async () => {
    registry.providers = [fakeProvider({ id: "fake:tts", quotaValue: { unit: "chars", used: 10, limit: 1000 } })];
    mkdirSync(join(root, ".data"), { recursive: true });
    const line = (o: object) => JSON.stringify({ at: "2026-10-31T10:00:00Z", episodeId: "e-tam", stage: "voice", providerId: "fake:tts", capability: "tts", estimateMicros: 1_500_000, cacheHit: false, requestHash: "h", ...o });
    writeFileSync(
      join(root, ".data", "ledger.jsonl"),
      [line({}), line({ capability: "llm", providerId: "claude:x", estimateMicros: 250_000, stage: undefined }), line({ capability: "llm", cacheHit: true }), line({ episodeId: "baska" })].join("\n") + "\n",
    );
    // Kütüphanede aynı stilde onaylı karakter.
    const libKey = `library/vector/character/${"1".padStart(32, "0")}.svg`;
    await putJson(server.store(), `${libKey}.json`, {
      check: { kind: "character", name: "Fatih", recognizable: 8, passed: true, defects: [], attempts: 1, sources: [], refs: [] },
      identity: { name: "Fatih", description: "d", artStyle: "noir", lineStyle: "ink", episodes: [] },
    });
    await saveEpisode(
      "e-tam",
      {
        style: { artStyle: "noir" } as EpisodeState["style"],
        cast: { characters: [{ id: "c1", name: "Fatih" }], locations: [] } as unknown as EpisodeState["cast"],
        script: { scenes: [{ id: "s1", narration: "abcd" }, { id: "s2", narration: "efghij" }] } as unknown as EpisodeState["script"],
        voice: { s1: { key: "k", mimeType: "audio/mpeg", durationMs: 1000 } } as unknown as EpisodeState["voice"],
      },
      { motionMode: "vector", lineStyle: "ink" },
    );
    const { res, body } = await get("e-tam");
    expect(res.status).toBe(200);
    expect(Object.keys(body.estimates)).toEqual(["animated", "mixed", "still", "vector"]);
    expect(body.spentUsd).toBe(1.5);
    expect(body.claudeUsd).toBe(0.25);
    expect(body.actual.byStage.map((g: { key: string }) => g.key).sort()).toEqual(["voice", "—"]);
    expect(body.actual.byProvider.map((g: { key: string }) => g.key).sort()).toEqual(["claude:x", "fake:tts"]);
    // Seslendirilmemiş sahnenin karakterleri: "efghij".
    expect(body.quota).toEqual({ providerId: "fake:tts", quota: { unit: "chars", used: 10, limit: 1000 }, needed: 6 });
    expect(body.library.map((c: { name: string }) => c.name)).toEqual(["Fatih"]);
    expect(body.job).toBeNull();
    expect(body.progress).toBeNull();
    expect(body.status).toEqual({ status: "idle", stage: "style" });
  });

  it("kota: senaryo yoksa tahmini miktar; sabit ses sağlayıcısı; ses bittiyse ya da kota yoksa null", async () => {
    registry.providers = [
      fakeProvider({ id: "fake:tts", quotaValue: { unit: "chars", used: 0, limit: 100 } }),
      fakeProvider({ id: "fake:eski", capabilities: ["tts"], quotaValue: { unit: "chars", used: 5, limit: 50 } }),
    ];
    await saveEpisode("e-q1");
    const q1 = (await get("e-q1")).body;
    expect(q1.quota.providerId).toBe("fake:tts");
    expect(q1.quota.needed).toBe(q1.estimates.animated.rows.find((r: { stage: string }) => r.stage === "voice").quantity);
    expect(q1.library).toEqual([]);

    await saveEpisode("e-q2", { voiceProviderId: "fake:eski" });
    expect((await get("e-q2")).body.quota).toMatchObject({ providerId: "fake:eski", quota: { limit: 50 } });

    await saveEpisode("e-q3", { done: { voice: "t" } });
    expect((await get("e-q3")).body.quota).toBeNull();

    registry.providers = [fakeProvider({ id: "fake:kotasiz" })];
    resetStudio();
    await saveEpisode("e-q4");
    expect((await get("e-q4")).body.quota).toBeNull();

    registry.providers = [];
    resetStudio();
    await saveEpisode("e-q5");
    expect((await get("e-q5")).body.quota).toBeNull();
  });

  it("kütüphane yalnız vektör, stil ve kadro hazır ve konsept onaysızken listelenir", async () => {
    await saveEpisode(
      "e-onayli",
      {
        style: { artStyle: "noir" } as EpisodeState["style"],
        cast: { characters: [], locations: [] } as unknown as EpisodeState["cast"],
        approvals: { concept: "t" },
      },
      { motionMode: "vector", realism: false },
    );
    expect((await get("e-onayli")).body.library).toEqual([]);
    await saveEpisode("e-stilsiz", { cast: { characters: [], locations: [] } as unknown as EpisodeState["cast"] }, { motionMode: "vector" });
    expect((await get("e-stilsiz")).body.library).toEqual([]);
    await saveEpisode("e-kadrosuz", { style: { artStyle: "noir" } as EpisodeState["style"] }, { motionMode: "vector" });
    expect((await get("e-kadrosuz")).body.library).toEqual([]);
  });

  it("durum: dosyada 'sürüyor' ama kilit sahibi ölü ve Stüdyo işi yok → boşta", async () => {
    await saveEpisode("e-olu", runningFor(1000));
    await lockOf("e-olu", DEAD_PID);
    const { body } = await get("e-olu");
    expect(body.status).toEqual({ status: "idle", stage: "style" });
    expect(body.progress).not.toBeNull();
  });

  it("durum: dosyada 'sürüyor' ve kilit canlı → sürüyor", async () => {
    await saveEpisode("e-canli", runningFor(1000));
    await lockOf("e-canli", process.ppid);
    expect((await get("e-canli")).body.status).toEqual({ status: "running", stage: "style" });
  });

  it("durum: Stüdyo işi son kayıttan sonra hatayla bitti → hata", async () => {
    await saveEpisode("e-hata", runningFor(60_000));
    server.startJob("e-hata", "job.script", []);
    lastChild().emit("exit", 1, null);
    const { body } = await get("e-hata");
    expect(body.status.status).toBe("error");
    expect(body.job).toMatchObject({ label: "job.script", status: "error" });
    expect(body.job).not.toHaveProperty("child");
  });

  it("durum: takılmış görünen bölüm, canlı kilit ya da çalışan Stüdyo işiyle 'sürüyor'; ikisi de yoksa takıldı", async () => {
    await saveEpisode("e-takili", runningFor(20 * 60_000));
    expect((await get("e-takili")).body.status).toEqual({ status: "stalled", stage: "style" });

    await lockOf("e-takili", process.ppid);
    expect((await get("e-takili")).body.status.status).toBe("running");

    await saveEpisode("e-is", runningFor(20 * 60_000));
    server.startJob("e-is", "job.script", []);
    const { body } = await get("e-is");
    expect(body.status.status).toBe("running");
    expect(body.job.status).toBe("running");
    expect(lastChild().kill).not.toHaveBeenCalled();
  });

  it("pipeline bitmiş ama süreci kapanmamış Stüdyo işi temizlenir", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
      server.startJob("e-zombi", "job.produce", []);
      const child = lastChild();
      vi.setSystemTime(new Date("2026-10-31T10:10:00Z"));
      await saveEpisode("e-zombi", { done: { style: "t" }, heartbeatAt: "2026-10-31T10:02:00Z" });
      const { body } = await get("e-zombi");
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(body.job.status).toBe("error");
      expect(body.status.status).not.toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET /api/episodes/[id]/video", () => {
  const SIZE = 1000;
  const bytes = Uint8Array.from({ length: SIZE }, (_, i) => i % 256);
  const get = (id: string, headers: Record<string, string> = TR, query = "") =>
    video.GET(new Request(`http://localhost/api/episodes/${id}/video${query}`, { headers }), params({ id }));

  beforeEach(async () => {
    const path = join(root, "video.mp4");
    writeFileSync(path, bytes);
    await saveEpisode("v-var", { render: { path } as EpisodeState["render"] });
    await saveEpisode("v-yok");
    await saveEpisode("v-dosyasiz", { render: { path: join(root, "silinmis.mp4") } as EpisodeState["render"] });
  });

  it("geçersiz kimlik 400; render yoksa ya da dosya silinmişse 404", async () => {
    expect((await get("Büyük")).status).toBe(400);
    expect(await (await get("v-yok")).text()).toBe("Video yok");
    const gone = await get("v-dosyasiz");
    expect(gone.status).toBe(404);
    expect(await gone.text()).toBe("Video dosyası yok");
  });

  it("aralıksız istek tüm dosyayı verir; ?download ek olarak indirtir", async () => {
    const res = await get("v-var", { range: "items=0-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(SIZE));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const dl = await get("v-var", {}, "?download");
    expect(dl.headers.get("content-disposition")).toBe('attachment; filename="v-var.mp4"');
    await dl.arrayBuffer();
  });

  it("Range: baştan, açık uçlu, sondan ve boyutu aşan son", async () => {
    const cases: [string, number, number][] = [
      ["bytes=0-99", 0, 99],
      ["bytes=900-", 900, 999],
      ["bytes=-100", 900, 999],
      ["bytes=-5000", 0, 999],
      ["bytes=990-5000", 990, 999],
      ["bytes=-", 0, 999],
    ];
    for (const [range, start, end] of cases) {
      const res = await get("v-var", { range });
      expect(res.status, range).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes ${start}-${end}/${SIZE}`);
      expect(res.headers.get("content-length")).toBe(String(end - start + 1));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
    }
  });

  it("istemci akışı yarıda keserse (ileri sarma) dosya kapanır, sonra yazılmaya çalışılmaz", async () => {
    const big = join(root, "buyuk.mp4");
    writeFileSync(big, new Uint8Array(1 << 20));
    await saveEpisode("v-buyuk", { render: { path: big } as EpisodeState["render"] });
    const reader = (await get("v-buyuk")).body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    // Kapanan dosya silinebilir (Windows açık dosyayı silmez) ve süreçte yakalanmamış hata kalmaz.
    await new Promise((r) => setTimeout(r, 50));
    rmSync(big);
  });

  it("boyut dışı ya da ters aralık 416", async () => {
    for (const range of ["bytes=1000-", "bytes=500-100"]) {
      const res = await get("v-var", { range });
      expect(res.status, range).toBe(416);
      expect(res.headers.get("content-range")).toBe(`bytes */${SIZE}`);
    }
  });
});

describe("POST /api/episodes/[id]/action", () => {
  const ok = async (id: string, body: unknown) => {
    const res = await act(id, body);
    expect(await res.json(), JSON.stringify(body)).toEqual({ ok: true });
    expect(res.status).toBe(200);
  };
  const fail = async (id: string, body: unknown, error: string | RegExp) => {
    const res = await act(id, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(error);
  };
  const script = { scenes: [{ id: "s1", narration: "eski" }, { id: "s2", narration: "iki" }] } as unknown as EpisodeState["script"];

  it("geçersiz bölüm kimliği ve bilinmeyen eylem", async () => {
    await fail("../x", { type: "resume" }, "Geçersiz bölüm");
    await saveEpisode("a1");
    await fail("a1", { type: "uç" }, "Bilinmeyen eylem: uç");
    await fail("yok", { type: "resume" }, "Bölüm bulunamadı");
  });

  it("hata isteğin dilinde: çerez tarayıcı dilinden önce gelir, geçersiz çerezde tarayıcı dili", async () => {
    const en = async (id: string, body: unknown, headers: Record<string, string>) =>
      ((await (await action.POST(post(body, headers), params({ id }))).json()) as { error: string }).error;
    expect(await en("../x", { type: "resume" }, { cookie: "a=1; ys-lang=en", "accept-language": "tr" })).toBe("Invalid episode");
    expect(await en("../x", { type: "resume" }, { cookie: "ys-lang=xx", "accept-language": "tr" })).toBe("Geçersiz bölüm");
    expect(await en("../x", { type: "resume" }, {})).toBe("Invalid episode");
    await saveEpisode("a-en");
    expect(await en("a-en", { type: "uç" }, { cookie: "ys-lang=en" })).toBe("Unknown action: uç");
    expect(await en("a-en", { type: "set-motion", motionMode: "x" }, { cookie: "ys-lang=en" })).toBe("Invalid motion mode");
    const created = await episodes.POST(post({}, { cookie: "ys-lang=en" }));
    expect(await created.json()).toEqual({ error: "A topic is required" });
    const asset = await assets.GET(new Request("http://x", { headers: { cookie: "ys-lang=en" } }), params({ key: ["x"] }));
    expect(await asset.text()).toBe("Forbidden");
  });

  it("iş sürerken iptal dışında hiçbir eylem yapılmaz; iptal süreci öldürür", async () => {
    await saveEpisode("a2");
    await ok("a2", { type: "resume" });
    expect(lastChild().args.slice(2)).toEqual(["episode", "run", "a2"]);
    await fail("a2", { type: "set-realism", enabled: false }, "Önce çalışan iş bitmeli");
    expect((await load("a2")).input.realism).toBeUndefined();
    await ok("a2", { type: "cancel" });
    expect(lastChild().kill).toHaveBeenCalled();
    expect(server.getJob("a2")?.log).toContain("İptal edildi.");
    // CLI'dan başlayan iş (canlı kilit) de engeller.
    await saveEpisode("a3");
    await lockOf("a3", process.ppid);
    await fail("a3", { type: "resume" }, "Önce çalışan iş bitmeli");
  });

  it("iş başlatan eylemler doğru CLI komutunu çalıştırır", async () => {
    const jobs: [object, string, string[], Partial<EpisodeState>?][] = [
      [{ type: "generate-script" }, "job.script", ["--until", "script"]],
      [{ type: "regenerate-concept" }, "job.regenerate", ["--only", "concept"]],
      [{ type: "approve-script" }, "job.concept", ["--until", "concept"], { script }],
      [{ type: "approve-concept" }, "job.produce", [], { script, concept: { candidates: {}, selected: {} } }],
      [{ type: "redraw", shotIds: ["sh1", "yok"] }, "job.redraw", [], { shots: [{ id: "sh1" }] as unknown as EpisodeState["shots"], keyframes: { sh1: { key: "k", mimeType: "image/png" } }, done: { keyframes: "t", render: "t" } }],
    ];
    for (const [i, [body, label, extra, over]] of jobs.entries()) {
      const id = `job-${i}`;
      await saveEpisode(id, over);
      await ok(id, body);
      expect(server.getJob(id)?.label).toBe(label);
      expect(lastChild().args.slice(2)).toEqual(["episode", "run", id, ...extra]);
    }
    expect((await load("job-2")).approvals?.script).toBeDefined();
    expect((await load("job-3")).approvals?.concept).toBeDefined();
    const redrawn = await load("job-4");
    expect(redrawn.redraws).toEqual({ sh1: 1 });
    expect(redrawn.keyframes).toEqual({});
    expect(redrawn.done.render).toBeUndefined();

    await saveEpisode("job-prev");
    await ok("job-prev", { type: "preview" });
    expect(lastChild().args.slice(2)).toEqual(["episode", "preview", "job-prev"]);
    expect(server.getJob("job-prev")?.label).toBe("job.preview");
  });

  it("senaryo düzenleme, onay geri alma, aday seçimi", async () => {
    await saveEpisode("a4", {
      script,
      approvals: { script: "t" },
      done: { script: "t", cast: "t" },
      cast: { characters: [{ id: "c1", name: "A" }], locations: [] } as unknown as EpisodeState["cast"],
      concept: { candidates: { c1: [{ key: "k0", mimeType: "image/png" }, { key: "k1", mimeType: "image/png" }] }, selected: {} },
    });
    await fail("a4", { type: "edit-narration", sceneId: "s1", narration: "yeni" }, "Senaryo onaylandı");
    await ok("a4", { type: "revoke-script" });
    const revoked = await load("a4");
    expect(revoked.approvals?.script).toBeUndefined();
    expect(revoked.done.cast).toBeUndefined();
    await ok("a4", { type: "edit-narration", sceneId: "s1", narration: "  yeni metin " });
    expect((await load("a4")).script!.scenes[0]!.narration).toBe("yeni metin");
    await ok("a4", { type: "select", entityId: "c1", index: 1 });
    expect((await load("a4")).concept!.selected.c1?.key).toBe("k1");
    await fail("a4", { type: "select", entityId: "c1", index: 9 }, "Aday yok");
  });

  it("hareket modu, ses, seri ve gerçeklik ayarları", async () => {
    await saveEpisode("a5", { voice: { s1: {} } as unknown as EpisodeState["voice"], voiceProviderId: "p" });
    await fail("a5", { type: "set-motion", motionMode: "uçan" }, "Geçersiz hareket modu");
    await ok("a5", { type: "set-motion", motionMode: "mixed", aiClipRatio: 0.5 });
    expect((await load("a5")).input).toMatchObject({ motionMode: "mixed", aiClipRatio: 0.5 });
    await ok("a5", { type: "change-voice", voiceId: "v2" });
    const voiced = await load("a5");
    expect(voiced.input.voiceId).toBe("v2");
    expect(voiced.voice).toBeUndefined();
    await ok("a5", { type: "set-series", series: "  Yeni  Seri " });
    expect((await load("a5")).input.series).toBe("Yeni Seri");
    await ok("a5", { type: "set-series", series: 42 });
    expect((await load("a5")).input.series).toBeUndefined();
    await ok("a5", { type: "set-realism", enabled: false });
    expect((await load("a5")).input.realism).toBe(false);
  });

  it("kalite kapısında insan kararı: kabul ve ret durum dosyasına ve varlık kaydına yazılır", async () => {
    const check = { kind: "prop", name: "kılıç", recognizable: 3, passed: false, defects: ["kötü"], attempts: 3, sources: [], refs: [] };
    await putJson(server.store(), "library/vector/prop/a.svg.json", { check });
    await saveEpisode("a6", { assetChecks: { "library/vector/prop/a.svg": check, "library/vector/prop/b.svg": { ...check, passed: true } } as unknown as EpisodeState["assetChecks"] });
    await ok("a6", { type: "accept-asset", key: "library/vector/prop/a.svg" });
    expect((await load("a6")).assetChecks!["library/vector/prop/a.svg"]).toMatchObject({ passed: true, override: { decision: "accepted" } });
    expect(await getJson(server.store(), "library/vector/prop/a.svg.json")).toMatchObject({ check: { override: { decision: "accepted" } } });
    await ok("a6", { type: "reject-asset", key: "library/vector/prop/b.svg", note: " değil " });
    expect((await load("a6")).assetChecks!["library/vector/prop/b.svg"]).toMatchObject({ passed: false, override: { decision: "rejected", note: "değil" } });
    await fail("a6", { type: "accept-asset", key: "yok.svg" }, "Kapı kaydı yok");
  });

  it("kütüphaneden karakter kullanma", async () => {
    const key = `library/vector/character/${"2".padStart(32, "0")}.svg`;
    await putJson(server.store(), `${key}.json`, {
      check: { kind: "character", name: "Fatih", recognizable: 8, passed: true, defects: [], attempts: 1, sources: [], refs: [] },
      identity: { name: "Fatih", description: "d", artStyle: "noir", lineStyle: "ink", episodes: [] },
    });
    await saveEpisode("a7", {
      cast: { characters: [{ id: "c1", name: "Fatih" }], locations: [] } as unknown as EpisodeState["cast"],
      concept: { candidates: {}, selected: {} },
    });
    await ok("a7", { type: "reuse-character", castId: "c1", key });
    const s = await load("a7");
    expect(s.concept!.selected.c1?.key).toBe(key);
    expect(s.cast!.characters[0]!.reuse).toBe("2".padStart(32, "0"));
    await fail("a7", { type: "reuse-character", castId: "yok", key }, "Kadroda yok");
  });

  it("Error olmayan hata metne çevrilir", async () => {
    await saveEpisode("a8");
    vi.spyOn(server.repo(), "update").mockRejectedValueOnce("dize hata");
    await fail("a8", { type: "set-realism", enabled: true }, "dize hata");
  });
});
