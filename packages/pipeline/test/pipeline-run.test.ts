import { existsSync, readFileSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "@ys/agents";
import { formatText, STYLE_PACKS } from "@ys/core";
import { FRAME_RULES, levelOf, QuotaError, type EpisodeState } from "../src/index.ts";
import { callsOf, onAgent, render, media, resetFakes } from "./pipeline-fakes.ts";
import { CAST, harness, makeState, scene, SCRIPT, STYLE, voiceOf } from "./pipeline-harness.ts";

vi.mock("@ys/agents", async (orig) => (await import("./pipeline-fakes.ts")).mockAgents(await orig()));
vi.mock("@ys/video/render", async () => {
  const f = await import("./pipeline-fakes.ts");
  return { renderEpisode: (o: any) => f.render.episode(o), renderStills: (o: any) => f.render.stills(o) };
});
vi.mock("../src/media.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return { ...(await orig<object>()), probeDurationMs: (...a: any[]) => f.media.probe(...a), normalizeClip: (...a: any[]) => f.media.normalize(...a) };
});
vi.mock("../src/reference.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return {
    ...(await orig<object>()),
    findReferences: (...a: any[]) => f.refs.find(...a),
    findVectorSources: (...a: any[]) => f.refs.vectors(...a),
    rasterizeSvg: (...a: any[]) => f.refs.rasterize(...a),
  };
});

/**
 * EpisodePipeline'ın çalıştırma düzeni (kilit, onay kapısı, from/until/only, hata kaydı) ve vektör dışı aşamalar.
 * Tüm ajanlar, medya geçidi, Remotion ve ffprobe sahtedir: para harcanmaz, ağa çıkılmaz.
 */

const story = { title: "Atlı Posta", logline: "l", premise: "p", hook: "h", beats: [1, 2, 3].map((i) => ({ id: `b${i}`, purpose: "x", summary: "s", retentionHook: "r", approxSec: 10 })) };

beforeEach(() => {
  resetFakes();
});

describe("yardımcılar", () => {
  it("levelOf günlük satırının önemini ayırır", () => {
    expect(levelOf("▶ style")).toBe("stage");
    expect(levelOf("  kare atlandı")).toBe("warn");
    expect(levelOf("  her şey yolunda")).toBe("info");
  });

  it("create kaydeder, load olmayan bölümde hata verir", async () => {
    const h = harness();
    const state = await h.pipeline.create({ topic: "Konu", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 1, width: 1920, height: 1080, fps: 30 });
    expect((await h.load(state.id)).input.topic).toBe("Konu");
    expect(state.heartbeatAt).toBeDefined();
    await expect(h.pipeline.load("yok")).rejects.toThrow("Bölüm bulunamadı: yok");
  });

  it("başarısız kayıt sonraki kayıtları kilitlemez", async () => {
    const h = harness();
    const state = makeState();
    h.store.failPut = () => true;
    await expect(h.pipeline.save(state)).rejects.toThrow("yazılamadı");
    h.store.failPut = undefined;
    await h.pipeline.save(state);
    expect(h.store.json(`episodes/${state.id}/state.json`).id).toBe(state.id);
  });
});

describe("run düzeni", () => {
  it("paket stili, hikâye ve senaryo; onaysız bölüm senaryo kapısında bekler, model seçimi ve maliyetler kaydedilir", async () => {
    const h = harness();
    h.store.putJsonSync("settings/models.json", { screenwriter: "claude-haiku-5-5" });
    onAgent("storyArchitect", () => story);
    onAgent("screenwriter", () => SCRIPT);
    onAgent("scriptDoctor", () => ({ notes: ["Open with the danger"], script: { ...SCRIPT, scenes: SCRIPT.scenes.map((s) => ({ ...s, narration: `${s.narration} yedi` })) } }));
    const id = await h.seed(makeState({ stylePack: "flat-explainer" }));

    const state = await h.pipeline.run(id);
    expect(state.style?.pack).toBe("flat-explainer");
    expect(state.story?.title).toBe("Atlı Posta");
    expect(state.script?.scenes[0]!.narration).toMatch(/yedi$/);
    expect(state.scriptNotes).toEqual(["Open with the danger"]);
    expect(state.waitingFor).toBe("script");
    expect(state.done.cast).toBeUndefined();
    expect(state.agentCostUsd).toBeCloseTo(0.03);
    expect(state.stats?.story?.durationMs).toBeGreaterThanOrEqual(0);
    // Kullanıcının model seçimi ajana iletilir ve günlüğe yazılır.
    expect((callsOf("screenwriter")[0]!.args[2] as { models: object }).models).toEqual({ screenwriter: "claude-haiku-5-5" });
    expect(h.logs).toContain("  model seçimi: screenwriter → claude-haiku-5-5");
    expect(h.logs).toContain("⏸ onay bekleniyor: script");
    expect(h.logs.some((l) => l.includes("stil paketi: "))).toBe(true);
    expect(h.ledger.entries.map((e) => e.providerId)).toEqual(["claude:claude-test", "claude:claude-test", "claude:claude-test"]);
    expect(h.ledger.entries[0]).toMatchObject({ capability: "llm", stage: "story", durationMs: 1500, cacheHit: false });
    const saved = await h.load(id);
    expect(saved.activity?.some((a) => a.level === "stage" && a.msg.startsWith("✓ story"))).toBe(true);
    // Günlük satırı çevrilebilir: Stüdyo seçili dilde gösterir.
    const models = saved.activity?.find((a) => a.text?.key === "log.run.models");
    expect(models?.msg).toBe("model seçimi: screenwriter → claude-haiku-5-5");
    expect(formatText("en", models?.text).trim()).toBe("model choice: screenwriter → claude-haiku-5-5");
    expect(h.store.json("library/lessons.json").lessons[0]).toMatchObject({ target: "script", rule: "Open with the danger" });
    // Kilit bırakıldı.
    expect(h.store.json(`episodes/${id}/run.lock.json`)).toBeNull();
  });

  it("until ile durur, from sonrasını siler ve yeniden çalıştırır, only yalnız o aşamayı çalıştırır", async () => {
    const h = harness();
    onAgent("storyArchitect", () => story);
    const id = await h.seed(makeState({ stylePack: "warm-documentary" }));
    let state = await h.pipeline.run(id, { until: "story" });
    expect(Object.keys(state.done)).toEqual(["style", "story"]);
    expect(callsOf("storyArchitect")).toHaveLength(1);

    state = await h.pipeline.run(id, { from: "story", until: "story" });
    expect(callsOf("storyArchitect")).toHaveLength(2);
    expect(state.done.style).toBeDefined();

    onAgent("storyArchitect", () => ({ ...story, title: "Yeni" }));
    state = await h.pipeline.run(id, { only: "story" });
    expect(state.story?.title).toBe("Yeni");
    expect(h.logs).toContain("▶ story (sadece)");
  });

  it("iptal sinyali aşamaya başlamadan durdurur", async () => {
    const h = harness();
    const id = await h.seed(makeState({ stylePack: "flat-explainer" }));
    const ac = new AbortController();
    ac.abort(new Error("iptal"));
    await expect(h.pipeline.run(id, { signal: ac.signal })).rejects.toThrow("iptal");
  });

  it("aşama hatası durumda kalır (Error ve düz değer), kilit bırakılır", async () => {
    const h = harness();
    onAgent("storyArchitect", () => {
      throw new Error("model çöktü");
    });
    const id = await h.seed(makeState({ stylePack: "flat-explainer" }));
    await expect(h.pipeline.run(id)).rejects.toThrow("model çöktü");
    let saved = await h.load(id);
    expect(saved.lastError).toMatchObject({ stage: "story", message: "model çöktü" });
    expect(saved.stats?.story?.endedAt).toBeDefined();
    expect(saved.activity?.at(-1)).toMatchObject({ level: "error", stage: "story", msg: "model çöktü" });

    onAgent("storyArchitect", () => {
      throw "düz hata";
    });
    await expect(h.pipeline.run(id)).rejects.toBe("düz hata");
    saved = await h.load(id);
    expect(saved.lastError?.message).toBe("düz hata");
  });

  it("kilit bırakılamazsa çalıştırma yine de sonuç döndürür", async () => {
    const h = harness();
    onAgent("storyArchitect", () => {
      // Aşama sürerken kilit dosyasına yazma bozulur: bırakma hatası yutulur.
      h.store.failPut = (k) => k.endsWith("run.lock.json");
      return story;
    });
    const id = await h.seed(makeState({ stylePack: "flat-explainer" }));
    const state = await h.pipeline.run(id, { until: "story" });
    expect(state.done.story).toBeDefined();
  });

  it("başarısız ama ödenmiş ajan çağrısı maliyete ve deftere yazılır", async () => {
    const h = harness();
    onAgent("storyArchitect", () => {
      throw new AgentError("tur sınırı", 0.05, "claude-opus", "story-architect");
    });
    const id = await h.seed(makeState({ stylePack: "flat-explainer" }));
    await expect(h.pipeline.run(id)).rejects.toThrow("tur sınırı");
    const saved = await h.load(id);
    expect(saved.agentCostUsd).toBeCloseTo(0.05);
    expect(h.logs).toContain("  ajan story-architect başarısız · $0.050");
    expect(h.ledger.entries[0]).toMatchObject({ providerId: "claude:claude-opus", error: "tur sınırı", stage: "story" });

    // Ajan/model bilinmiyorsa "?"; maliyetsiz hata deftere yazılmaz.
    onAgent("storyArchitect", () => {
      throw new AgentError("şema", 0.01);
    });
    await expect(h.pipeline.run(id)).rejects.toThrow("şema");
    expect(h.logs).toContain("  ajan ? başarısız · $0.010");
    expect(h.ledger.entries[1]!.providerId).toBe("claude:?");
    onAgent("storyArchitect", () => {
      throw new AgentError("bedava", 0);
    });
    await expect(h.pipeline.run(id)).rejects.toThrow("bedava");
    expect(h.ledger.entries).toHaveLength(2);
  });
});

describe("stil aşaması", () => {
  it("özel stil sanat yönetmeninden gelir", async () => {
    const h = harness();
    onAgent("artDirector", () => ({ ...STYLE, artStyle: "Özel çizim" }));
    const id = await h.seed(makeState({ stylePack: "custom" }));
    const state = await h.pipeline.run(id, { until: "style" });
    expect(state.style?.artStyle).toBe("Özel çizim");
    expect(h.logs).toContain("  özel stil: Özel çizim");
  });

  it("otomatik seçim: seri önceki paketi devralır; seri yoksa ajan seçer, bilinmeyen paket ilk pakete düşer", async () => {
    const h = harness();
    const old = makeState({ series: "Posta Tarihi" }, { style: { ...STYLE, pack: "ottoman-miniature" } });
    await h.seed(old);
    const id = await h.seed(makeState({ series: " posta  tarihi " }));
    let state = await h.pipeline.run(id, { until: "style" });
    expect(state.style?.pack).toBe("ottoman-miniature");
    expect(h.logs.some((l) => l.includes('stil paketi (seri "posta  tarihi")'))).toBe(true);
    expect(callsOf("stylePicker")).toHaveLength(0);

    onAgent("stylePicker", () => ({ packId: "yok-boyle-paket", reason: "konuya uygun" }));
    const solo = await h.seed(makeState());
    state = await h.pipeline.run(solo, { until: "style" });
    expect(state.style?.pack).toBe(STYLE_PACKS[0]!.id);
    expect(h.logs.some((l) => l.includes("stil paketi (otomatik)") && l.endsWith(": konuya uygun"))).toBe(true);

    onAgent("stylePicker", () => ({ packId: "vintage-engraving", reason: "eski" }));
    const fresh = await h.seed(makeState({ series: "Yeni Seri" }));
    state = await h.pipeline.run(fresh, { until: "style" });
    expect(state.style?.pack).toBe("vintage-engraving");
  });
});

describe("senaryo aşaması", () => {
  const ready = (extra: Partial<EpisodeState> = {}) => makeState({ stylePack: "flat-explainer" }, { story, style: STYLE, done: { style: "x", story: "x" }, ...extra });

  it("hikâye yoksa hata", async () => {
    const h = harness();
    const id = await h.seed(makeState({}, { style: STYLE, done: { style: "x" } }));
    await expect(h.pipeline.run(id, { only: "script" })).rejects.toThrow("story yok");
  });

  it("doktor sahne yapısını değiştirirse taslak kullanılır; şişen defter küratörden geçer", async () => {
    const h = harness();
    // Eşiği (10) aşan senaryo dersleri: küratör çağrılır.
    h.store.putJsonSync("library/lessons.json", {
      lessons: Array.from({ length: 11 }, (_, i) => ({ target: "script", rule: `rule number ${i} aaa${i}`, count: 1, firstSeen: "2026-10-01", lastSeen: "2026-10-01", episodes: ["e"] })),
    });
    onAgent("screenwriter", () => SCRIPT);
    onAgent("scriptDoctor", () => ({ notes: [], script: { scenes: [scene("x1")] } }));
    onAgent("lessonCurator", (_target: string, rules: string[]) => ({ rules: [{ rule: "merged rule", sources: rules.map((_, i) => i) }] }));
    const id = await h.seed(ready());
    const state = await h.pipeline.run(id, { until: "script" });
    expect(state.script).toEqual(SCRIPT);
    expect(h.logs.some((l) => l.includes("(sahne yapısı değişti, taslak kullanıldı)"))).toBe(true);
    expect(h.logs).toContain("  dersler (script): 11 → 1 kural");
    expect(h.store.json("library/lessons.json").lessons).toHaveLength(1);
    expect(h.ledger.entries.filter((e) => e.stage === "review")).toHaveLength(1);
  });

  it("doktor düşerse senarist taslağı kaydedilir; devamda senarist yeniden çağrılmaz, aşama bitince taslak silinir", async () => {
    const h = harness();
    onAgent("screenwriter", () => SCRIPT);
    onAgent("scriptDoctor", () => {
      throw new Error("doktor düştü");
    });
    const id = await h.seed(ready());
    await h.pipeline.run(id, { until: "script" }).catch(() => {});
    expect((await h.load(id)).scriptDraft?.script).toEqual(SCRIPT);
    expect(callsOf("screenwriter")).toHaveLength(1);

    onAgent("scriptDoctor", () => ({ notes: ["n"], script: SCRIPT }));
    const state = await h.pipeline.run(id, { until: "script" });
    expect(callsOf("screenwriter")).toHaveLength(1);
    expect(h.logs).toContain("  taslak: önceki çalıştırmanın taslağı kullanıldı");
    expect(state.script).toEqual(SCRIPT);
    expect(state.scriptDraft).toBeUndefined();
  });

  it("küratör başarısız olursa defter olduğu gibi kalır (Error ve düz değer)", async () => {
    const h = harness();
    h.store.putJsonSync("library/lessons.json", {
      lessons: Array.from({ length: 11 }, (_, i) => ({ target: "script", rule: `kural ${i} bbb${i}`, count: 1, firstSeen: "x", lastSeen: "x", episodes: ["e"] })),
    });
    onAgent("screenwriter", () => SCRIPT);
    onAgent("scriptDoctor", () => ({ notes: [], script: SCRIPT }));
    onAgent("lessonCurator", () => {
      throw new Error("küratör düştü");
    });
    const id = await h.seed(ready());
    await h.pipeline.run(id, { until: "script" });
    expect(h.logs).toContain("  ders küratörü atlandı: küratör düştü");
    expect(h.store.json("library/lessons.json").lessons).toHaveLength(11);

    onAgent("lessonCurator", () => {
      throw "düz";
    });
    await h.pipeline.run(id, { only: "script" });
    expect(h.logs).toContain("  ders küratörü atlandı: düz");
  });
});

describe("kadro aşaması", () => {
  it("senaryo ya da stil yoksa hata", async () => {
    const h = harness();
    const id = await h.seed(makeState({}, { style: STYLE }));
    await expect(h.pipeline.run(id, { only: "cast" })).rejects.toThrow("script/style yok");
  });

  it("vektör dışı modda kütüphaneye bakılmaz; değişen varlığın konsepti atılır, onay yoksa dokunulmaz", async () => {
    const h = harness();
    onAgent("castingDirector", (_s: unknown, _st: unknown, _d: unknown, library: unknown[]) => {
      expect(library).toEqual([]);
      return { ...CAST, characters: [{ ...CAST.characters[0]!, name: "Başka" }] };
    });
    const id = await h.seed(
      makeState({}, { style: STYLE, script: SCRIPT, cast: CAST, concept: { candidates: { c1: [{ key: "k", mimeType: "image/png" }] }, selected: {} } }),
    );
    const state = await h.pipeline.run(id, { only: "cast" });
    expect(state.concept?.candidates.c1).toBeUndefined();
    expect(state.approvals).toBeUndefined();
    expect(h.logs).toContain("  1 karakter, 1 mekân");
  });

  it("vektör modu: kütüphane karakteri tekrar kullanılır, insan olmayanlar nesneye döner, eski kadronun bayat çizimleri atılır", async () => {
    const h = harness();
    // Kütüphanede aynı stil ve çizgi stilinde onaylı bir karakter.
    const libKey = `library/vector/character/${"a".repeat(32)}.svg`;
    h.store.putJsonSync(`${libKey}.json`, {
      check: { kind: "character", name: "Rider", recognizable: 9, passed: true },
      identity: { name: "Rider", description: "young rider", artStyle: STYLE.artStyle, lineStyle: "outline", episodes: [] },
    });
    const newCast = {
      characters: [
        { id: "c1", name: "Rider", kind: "person", role: "r", visualDescription: "young rider", scenes: ["s1"], reuse: "a".repeat(32) },
        { id: "c3", name: "Horse", kind: "animal", role: "h", visualDescription: "brown horse v2", scenes: ["s1"], reference: "Mustang horse" },
        { id: "c4", name: "Bag", kind: "object", role: "b", visualDescription: "mail bag", scenes: ["s1"] },
      ],
      locations: [{ id: "l1", name: "Station", visualDescription: "relay station", scenes: ["s1"] }],
    };
    onAgent("castingDirector", (_s: unknown, _st: unknown, _d: unknown, library: { id: string }[]) => {
      expect(library.map((l) => l.id)).toEqual(["a".repeat(32)]);
      return newCast;
    });
    const id = await h.seed(
      makeState(
        { motionMode: "vector", lineStyle: "outline" },
        {
          style: STYLE,
          script: SCRIPT,
          cast: {
            characters: [
              CAST.characters[0]!,
              { id: "c2", name: "Old", kind: "person", role: "o", visualDescription: "old", scenes: [] },
            ],
            locations: CAST.locations,
          } as never,
          concept: {
            candidates: { c1: [{ key: "k1", mimeType: "image/svg+xml" }], c2: [{ key: "k2", mimeType: "image/svg+xml" }] },
            selected: { l1: { key: "k3", mimeType: "image/svg+xml" } },
          },
          approvals: { script: "x", concept: "x" },
          vectorProps: {
            "p-desk": { description: "desk" },
            c1: { description: "young rider" },
            c3: { description: "brown horse" },
            c4: { description: "mail bag", key: "drawn" },
            c5: { description: "gone" },
          },
        },
      ),
    );
    const state = await h.pipeline.run(id, { only: "cast" });
    expect(state.concept?.candidates).toEqual({ c1: [{ key: "k1", mimeType: "image/svg+xml" }] });
    expect(state.concept?.selected.l1).toBeDefined();
    expect(state.approvals).toEqual({ script: "x" });
    // c1 insan (nesne değil), c3 tarifi değişti, c5 kadroda yok: atılır; c4 aynı (çizimi korunur); p-desk kadro dışı.
    expect(Object.keys(state.vectorProps!).sort()).toEqual(["c3", "c4", "p-desk"]);
    expect(state.vectorProps!.c4!.key).toBe("drawn");
    expect(state.vectorProps!.c3).toMatchObject({ description: "brown horse v2", kind: "prop", reference: "Mustang horse" });
    expect(state.cast!.characters.map((c) => c.id)).toEqual(["c1"]);
    expect(h.logs).toContain("  ♻ kütüphaneden tekrar kullanılacak: Rider");
    expect(h.logs).toContain("  insan olmayan 2 oyuncu nesne olarak çizilecek: Horse, Bag");
  });

  it("değişiklik yoksa konsept onayı korunur", async () => {
    const h = harness();
    onAgent("castingDirector", () => CAST);
    const id = await h.seed(
      makeState({}, { style: STYLE, script: SCRIPT, cast: CAST, approvals: { concept: "x" }, concept: { candidates: {}, selected: { c1: { key: "k", mimeType: "image/png" } } } }),
    );
    const state = await h.pipeline.run(id, { only: "cast" });
    expect(state.approvals?.concept).toBe("x");
    expect(state.concept?.selected.c1).toBeDefined();
  });
});

describe("konsept aşaması (görsel model)", () => {
  it("kadro yoksa hata", async () => {
    const h = harness();
    const id = await h.seed(makeState());
    await expect(h.pipeline.run(id, { only: "concept" })).rejects.toThrow("cast yok");
  });

  it("ilk tur: karakter başına 3, mekân başına 2 aday; onaysız bölümde seçim yapılmaz", async () => {
    const h = harness({ concurrency: 2 });
    const id = await h.seed(makeState({ tier: "premium" }, { style: STYLE, cast: CAST, done: { style: "x", story: "x", script: "x", cast: "x" } }));
    h.gateway.generate.mockImplementationOnce(async (req, run) => {
      await h.store.put("assets/c.png", new Uint8Array([1]));
      return { files: [{ key: "assets/c.png", mimeType: "image/png" }], providerId: "img:fake", cacheHit: true, req, run };
    });
    const state = await h.pipeline.run(id, { until: "concept" });
    expect(state.concept!.candidates.c1).toHaveLength(3);
    expect(state.concept!.candidates.l1).toHaveLength(2);
    expect(state.concept!.selected).toEqual({});
    expect(state.concept!.round).toBe(0);
    const reqs = h.gateway.generate.mock.calls.map((c) => c[0]);
    expect(reqs.every((r) => r.quality === "hero" && r.prompt!.includes(FRAME_RULES))).toBe(true);
    expect(reqs.map((r) => r.seed).sort()).toEqual([1, 1, 2, 2, 3]);
    expect(h.logs.some((l) => l.includes(", önbellek)"))).toBe(true);
  });

  it("yeni adaylar: tur artar, önceki seçim ilk aday ve seçili kalır", async () => {
    const h = harness();
    const sel = { key: "assets/old.png", mimeType: "image/png" };
    const id = await h.seed(makeState({}, { style: STYLE, cast: CAST, concept: { candidates: { c1: [sel] }, selected: { c1: sel }, round: 1 } }));
    const state = await h.pipeline.run(id, { only: "concept" });
    expect(state.concept!.round).toBe(2);
    expect(state.concept!.candidates.c1![0]).toEqual(sel);
    expect(state.concept!.candidates.c1).toHaveLength(4);
    expect(state.concept!.selected).toEqual({ c1: sel });
    expect(h.gateway.requests.map((r) => r.req.seed)).toContain(21);
  });

  it("ilk konsept 'yeni adaylar' ile başlatılırsa tur 1 olur, korunacak seçim yoktur", async () => {
    const h = harness();
    const id = await h.seed(makeState({}, { style: STYLE, cast: { characters: [], locations: CAST.locations } }));
    const state = await h.pipeline.run(id, { only: "concept" });
    expect(state.concept!.round).toBe(0);
    expect(state.concept!.candidates.l1).toHaveLength(2);
    expect(h.gateway.generate.mock.calls.map((c) => c[0].seed)).toEqual([1, 2]);
  });

  it("hata sonrası devam: aynı tur, aynı görsel ikinci kez eklenmez; otomatik onayda ilk aday seçilir", async () => {
    const h = harness();
    h.gateway.generate.mockImplementation(async (_req, run) => {
      const key = `assets/${run.refId}.png`;
      await h.store.put(key, new Uint8Array([1]));
      return { files: [{ key, mimeType: "image/png" }], providerId: "img:fake", cacheHit: false };
    });
    const prev = { key: "assets/c1.png", mimeType: "image/png" };
    const id = await h.seed(
      makeState({ autoApprove: true }, { style: STYLE, cast: CAST, concept: { candidates: { c1: [prev] }, selected: {} }, done: { style: "x", story: "x", script: "x", cast: "x" } }),
    );
    const state = await h.pipeline.run(id, { until: "concept" });
    expect(state.concept!.round).toBe(0);
    expect(state.concept!.candidates.c1).toEqual([prev]);
    expect(state.concept!.selected).toEqual({ c1: prev, l1: { key: "assets/l1.png", mimeType: "image/png" } });
  });
});

describe("seslendirme aşaması", () => {
  const voiced = (extra: Partial<EpisodeState> = {}) => makeState({ voiceId: "v1" }, { script: SCRIPT, ...extra });

  it("senaryo yoksa hata; seslendirilecek sahne yoksa hiçbir şey yapılmaz", async () => {
    const h = harness();
    const id = await h.seed(makeState());
    await expect(h.pipeline.run(id, { only: "voice" })).rejects.toThrow("script yok");
    const done = await h.seed(voiced({ voice: { s1: voiceOf("s1"), s2: { ...voiceOf("s2"), text: undefined } } }));
    await h.pipeline.run(done, { only: "voice" });
    expect(h.gateway.generate).not.toHaveBeenCalled();
  });

  it("zamanlamalı TTS yoksa düz TTS + tahmini zamanlama; metni değişen sahne yeniden seslendirilir", async () => {
    const h = harness();
    h.gateway.plan.mockImplementation((req: { capability: string }) => (req.capability === "tts" ? [{ adapter: { id: "tts:plain" } }] : []));
    h.gateway.generate.mockImplementation(async (req, run) => {
      const key = `assets/voice/${run.refId}.wav`;
      await h.store.put(key, new Uint8Array([1]));
      return { files: [{ key, mimeType: "audio/x-unknown" }], providerId: "tts:plain", cacheHit: false, capability: req.capability };
    });
    const id = await h.seed(voiced({ voice: { s1: { ...voiceOf("s1"), text: "eski metin" } } }));
    const state = await h.pipeline.run(id, { only: "voice" });
    expect(h.gateway.generate.mock.calls.map((c) => [c[0].capability, c[1].policy.allow])).toEqual([
      ["tts", ["tts:plain"]],
      ["tts", ["tts:plain"]],
    ]);
    expect(media.probe.mock.calls[0]).toEqual([expect.any(Uint8Array), "bin"]);
    expect(state.voice!.s1).toMatchObject({ durationMs: 2000, estimatedTiming: true, text: SCRIPT.scenes[0]!.narration });
    expect(state.voice!.s1!.words.length).toBe(6);
    expect(state.voiceProviderId).toBe("tts:plain");
    expect(h.logs).toContain("  s1: 2.0 sn (tts:plain)");
  });

  it("sağlayıcı zamanlaması kullanılır; sabitlenmiş sağlayıcı tercih edilir", async () => {
    const h = harness();
    h.gateway.generate.mockImplementation(async (_req, run) => {
      const key = `assets/voice/${run.refId}.mp3`;
      await h.store.put(key, new Uint8Array([1]));
      return { files: [{ key, mimeType: "audio/mpeg" }], providerId: "tts:pinned", cacheHit: false, words: [{ text: "x", startMs: 0, endMs: 10 }] };
    });
    const id = await h.seed(voiced({ voiceProviderId: "tts:pinned" }));
    const state = await h.pipeline.run(id, { only: "voice" });
    expect(h.gateway.generate.mock.calls[0]![1].policy.allow).toEqual(["tts:pinned"]);
    expect(h.gateway.generate.mock.calls[0]![0].capability).toBe("tts_timestamps");
    expect(state.voice!.s1).toMatchObject({ estimatedTiming: false, words: [{ text: "x", startMs: 0, endMs: 10 }] });
    expect(media.probe.mock.calls[0]![1]).toBe("mp3");
  });

  it("uygun sağlayıcı yoksa hata", async () => {
    const h = harness();
    h.gateway.plan.mockReturnValue([]);
    const id = await h.seed(voiced());
    await expect(h.pipeline.run(id, { only: "voice" })).rejects.toThrow("Seslendirme için uygun sağlayıcı yok");
  });

  it("kota yetmiyorsa para harcamadan QuotaError; başka birimli kota denetlenmez", async () => {
    const h = harness();
    h.gateway.quota.mockResolvedValueOnce({ unit: "chars", used: 990, limit: 1000, plan: "starter", resetsAt: "2026-11-15T00:00:00Z" });
    const id = await h.seed(voiced());
    const err = await h.pipeline.run(id, { only: "voice" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaError);
    expect((err as Error).message).toMatch(/tts:fake kotası yetmiyor: .* karakter gerekli, 10 kaldı \(starter, yenilenme /);
    expect(h.gateway.generate).not.toHaveBeenCalled();
    expect(formatText("en", (await h.load(id)).lastError?.text)).toMatch(/^tts:fake quota is not enough: .* characters needed, 10 left \(starter, resets /);

    h.gateway.quota.mockResolvedValueOnce({ unit: "chars", used: 999, limit: 1000 });
    await expect(h.pipeline.run(id, { only: "voice" })).rejects.toThrow(/1 kaldı \(plan\)\./);

    h.gateway.quota.mockResolvedValueOnce({ unit: "credits", used: 999, limit: 1000 });
    await h.pipeline.run(id, { only: "voice" });
    expect(h.gateway.generate).toHaveBeenCalledTimes(2);
  });
});

describe("çekim aşaması (görsel model)", () => {
  const plan = {
    scenes: SCRIPT.scenes.map((s) => ({
      sceneId: s.id,
      shots: [
        { startWord: 0, characterIds: ["c1"], locationId: "l1", kind: "ai_clip", description: "d", imagePrompt: "ip", motionPrompt: "mp", camera: "static", ambience: "none" },
        { startWord: 2, characterIds: [], locationId: "", kind: "still_motion", description: "d2", imagePrompt: "ip2", motionPrompt: "mp2", camera: "push_in", ambience: "dust" },
      ],
    })),
  };
  const ready = (input: object) => makeState(input, { script: SCRIPT, style: STYLE, voice: { s1: voiceOf("s1"), s2: voiceOf("s2") } });

  it("sesi olmayan sahnenin süresi 0 verilir, çekimleri düşer", async () => {
    const h = harness();
    onAgent("director", (_s: unknown, _st: unknown, durations: Record<string, number>) => {
      expect(durations).toEqual({ s1: 2, s2: 0 });
      return plan;
    });
    const id = await h.seed(makeState({}, { script: SCRIPT, style: STYLE, voice: { s1: voiceOf("s1") } }));
    const state = await h.pipeline.run(id, { only: "shots" });
    expect(state.shots!.map((s) => s.sceneId)).toEqual(["s1", "s1"]);
  });

  it("eksik girdi hatası", async () => {
    const h = harness();
    const id = await h.seed(makeState({}, { script: SCRIPT }));
    await expect(h.pipeline.run(id, { only: "shots" })).rejects.toThrow("script/voice/style yok");
  });

  it.each([
    [{ aiClipRatio: 0.5 }, ["ai_clip", "still_motion"]],
    [{ motionMode: "animated" }, ["ai_clip", "ai_clip"]],
    [{ motionMode: "still" }, ["still_motion", "still_motion"]],
  ])("hareket modu kesin uygulanır (%o)", async (input, kinds) => {
    const h = harness();
    onAgent("director", (_s: unknown, _st: unknown, durations: Record<string, number>) => {
      expect(durations).toEqual({ s1: 2, s2: 2 });
      return plan;
    });
    const id = await h.seed(ready(input));
    const state = await h.pipeline.run(id, { only: "shots" });
    expect(state.shots!.slice(0, 2).map((s) => s.kind)).toEqual(kinds);
    expect(state.keyframes).toEqual({});
    expect(h.logs.some((l) => /  4 çekim \(\d AI klip\)/.test(l))).toBe(true);
  });
});

describe("kare aşaması (görsel model)", () => {
  const shot = (id: string, extra: object = {}) => ({
    id,
    sceneId: "s1",
    kind: "still_motion" as const,
    startMs: 0,
    endMs: 3000,
    description: `desc ${id}`,
    imagePrompt: `prompt ${id}`,
    motionPrompt: "m",
    camera: "static" as const,
    ...extra,
  });
  const selected = { c1: { key: "assets/c1.png", mimeType: "image/png" }, l1: { key: "assets/l1.png", mimeType: "image/png" } };
  const ready = (h: ReturnType<typeof harness>, input: object, extra: Partial<EpisodeState> = {}) => {
    h.store.putText("assets/c1.png", "c1");
    h.store.putText("assets/l1.png", "l1");
    return h.seed(makeState(input, { style: STYLE, cast: CAST, concept: { candidates: {}, selected }, ...extra }));
  };

  it("çekim/stil yoksa hata", async () => {
    const h = harness();
    const id = await h.seed(makeState());
    await expect(h.pipeline.run(id, { only: "keyframes" })).rejects.toThrow("shots/style yok");
  });

  it("denetim kapalı: referanslı ve referanssız kareler, elle yeniden çizimde seed", async () => {
    const h = harness();
    const id = await ready(h, { qa: false, tier: "premium" }, {
      shots: [shot("a", { characterIds: ["c1", "cX"], locationId: "l1" }), shot("b", { locationId: "lX" }), shot("c")],
      keyframes: { c: { key: "assets/done.png", mimeType: "image/png" } },
      redraws: { a: 7 },
    });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(Object.keys(state.keyframes!).sort()).toEqual(["a", "b", "c"]);
    const byRef = (r: string) => h.gateway.requests.find((x) => x.run.refId === r);
    const [a, b] = [byRef("a"), byRef("b")];
    expect(a!.req).toMatchObject({ capability: "i2i_multiref", quality: "hero", seed: 7, aspectRatio: "16:9" });
    expect(a!.req.prompt).toContain("Reference images in order: [1] Character A");
    expect(a!.req.prompt).toContain("[2] Station (location");
    expect(a!.req.refs).toHaveLength(2);
    expect(b!.req).toMatchObject({ capability: "t2i", quality: "hero", refs: [] });
    expect(b!.req.seed).toBeUndefined();
    expect(state.qa).toEqual({});
    expect(h.logs).toContain("  a ✓ (img:fake)");
  });

  it("denetim açık: kötü kare düzeltmeyle yeniden çizilir, daha iyisi tutulur", async () => {
    const h = harness();
    let n = 0;
    onAgent("frameInspector", (input: { characters: string[]; refs: unknown[] }) => {
      expect(input.characters).toEqual(["Rider"]);
      expect(input.refs).toHaveLength(1);
      return n++ === 0 ? { score: 3, issues: [{ type: "text", detail: "letters on wall" }], fix: "remove letters" } : { score: 8, issues: [], fix: "" };
    });
    const id = await ready(h, {}, { shots: [shot("a", { characterIds: ["c1"] })] });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(h.gateway.requests[1]!.req.prompt).toContain("prompt a. remove letters. Avoid: letters on wall");
    expect(state.qa!.a).toMatchObject({ passed: true, score: 8, attempts: 2 });
    expect(state.keyframes!.a!.key).toMatch(/a-1.png$/);
    expect(h.logs).toContain("  a ✗ (img:fake, kontrol 3/10: text)");
    expect(h.logs).toContain("  a ✓ (img:fake, kontrol 8/10)");
  });

  it("büyük kare denetlenmeden geçer; denetim hatası kareyi durdurmaz; yeniden çizim hatasında ilk kare kalır", async () => {
    const h = harness({ qaRedraws: 2 });
    const draws = new Map<string, number>();
    h.gateway.generate.mockImplementation(async (_req, run) => {
      const n = (draws.get(run.refId!) ?? 0) + 1;
      draws.set(run.refId!, n);
      if (run.refId === "c" && n > 1) throw "kota bitti";
      const key = `assets/kf-${run.refId}-${n}.png`;
      await h.store.put(key, run.refId === "a" ? new Uint8Array(3_600_000) : new Uint8Array([1]));
      return { files: [{ key, mimeType: "image/png" }], providerId: "img:fake", cacheHit: run.refId === "b" };
    });
    onAgent("frameInspector", (input: { description: string }) => {
      if (input.description === "desc b") throw new Error("görsel model yok");
      if (input.description === "desc c") return { score: 2, issues: [], fix: "" };
      return { score: 9, issues: [], fix: "" };
    });
    const id = await ready(h, {}, { shots: [shot("a"), shot("b"), shot("c")] });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(state.qa!.a).toMatchObject({ skipped: "görsel çok büyük", passed: true });
    expect(state.qa!.b).toMatchObject({ skipped: "denetim hatası", passed: true });
    expect(state.qa!.c).toMatchObject({ passed: false, score: 2, attempts: 1 });
    expect(h.logs).toContain("  b: kare kontrolü yapılamadı (görsel model yok)");
    expect(h.logs).toContain("  c yeniden çizilemedi, ilk kare kullanılıyor: kota bitti");
    expect(h.logs.some((l) => l.startsWith("  b ✓ (img:fake, önbellek)"))).toBe(true);
  });

  it("kadro ve konsept yokken kare referanssız çizilir ve denetlenir", async () => {
    const h = harness({ qaRedraws: 0 });
    onAgent("frameInspector", (input: { characters: string[]; refs: unknown[] }) => {
      expect(input).toMatchObject({ characters: [], refs: [] });
      return { score: 9, issues: [], fix: "" };
    });
    const id = await h.seed(makeState({}, { style: STYLE, shots: [shot("a", { characterIds: ["c1"], locationId: "l1" })] }));
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(h.gateway.requests[0]!.req).toMatchObject({ capability: "t2i", refs: [] });
    expect(h.gateway.requests[0]!.req.prompt).toContain("prompt a");
    expect(state.qa!.a).toMatchObject({ passed: true, score: 9 });
  });

  it("denetçinin düz hata değeri de günlüğe yazılır", async () => {
    const h = harness({ qaRedraws: 0 });
    onAgent("frameInspector", () => {
      throw "düz";
    });
    const id = await ready(h, {}, { shots: [shot("a")] });
    const state = await h.pipeline.run(id, { only: "keyframes" });
    expect(h.logs).toContain("  a: kare kontrolü yapılamadı (düz)");
    expect(state.qa!.a!.attempts).toBe(1);
  });

  it("ilk çizimi başarısız olan çekimler sonunda tek hatada toplanır; diğerleri kaydedilir", async () => {
    const h = harness({ concurrency: 1 });
    h.gateway.generate.mockImplementation(async (_req, run) => {
      if (run.refId === "b") throw new Error("sağlayıcı düştü");
      const key = `assets/kf-${run.refId}.png`;
      await h.store.put(key, new Uint8Array([1]));
      return { files: [{ key, mimeType: "image/png" }], providerId: "img:fake", cacheHit: false };
    });
    const id = await ready(h, { qa: false }, { shots: [shot("a"), shot("b")] });
    await expect(h.pipeline.run(id, { only: "keyframes" })).rejects.toThrow("1 kare çizilemedi (diğerleri kaydedildi, devam edince yalnız bunlar denenir):\nb: sağlayıcı düştü");
    expect(Object.keys((await h.load(id)).keyframes!)).toEqual(["a"]);
    expect(h.logs).toContain("  b çizilemedi: sağlayıcı düştü");
  });

  it("iptal edilen çizim hatası olduğu gibi fırlatılır", async () => {
    const h = harness();
    const ac = new AbortController();
    h.gateway.generate.mockImplementation(async () => {
      ac.abort();
      throw new Error("aborted");
    });
    const id = await ready(h, {}, { shots: [shot("a")] });
    await expect(h.pipeline.run(id, { only: "keyframes", signal: ac.signal })).rejects.toThrow("aborted");
  });
});

describe("klip aşaması", () => {
  const shot = (id: string, endMs: number, kind: "ai_clip" | "still_motion" = "ai_clip") => ({
    id,
    sceneId: "s1",
    kind,
    startMs: 0,
    endMs,
    description: "d",
    imagePrompt: "i",
    motionPrompt: "gallop",
    camera: "static" as const,
  });

  it("eksik girdi hatası; yapılacak klip yoksa çıkar", async () => {
    const h = harness();
    const none = await h.seed(makeState());
    await expect(h.pipeline.run(none, { only: "clips" })).rejects.toThrow("shots/keyframes yok");
    const id = await h.seed(makeState({}, { shots: [shot("a", 3000, "still_motion")], keyframes: {} }));
    await h.pipeline.run(id, { only: "clips" });
    expect(h.gateway.generate).not.toHaveBeenCalled();
  });

  it("çekim süresini kapsayan tam saniye klip (3–15 sn); başarısız klip atlanır", async () => {
    const h = harness();
    for (const k of ["a", "b", "c", "d"]) h.store.putText(`assets/kf-${k}.png`, k);
    const kf = (k: string) => ({ key: `assets/kf-${k}.png`, mimeType: "image/png" });
    h.gateway.generate.mockImplementation(async (req, run) => {
      if (run.refId === "c") throw new Error("i2v düştü");
      if (run.refId === "d") throw "düz";
      const key = `assets/clip-${run.refId}.mp4`;
      await h.store.put(key, new Uint8Array([1]));
      return { files: [{ key, mimeType: "video/mp4" }], providerId: "vid:fake", cacheHit: false, req };
    });
    const id = await h.seed(
      makeState({}, { shots: [shot("a", 5000), shot("b", 8000), shot("c", 3000), shot("d", 3000), shot("e", 3000)], keyframes: { a: kf("a"), b: kf("b"), c: kf("c"), d: kf("d"), e: kf("kayip") } }),
    );
    const state = await h.pipeline.run(id, { only: "clips" });
    expect(state.clips).toMatchObject({ a: { durationSec: 5 }, b: { durationSec: 8 } });
    expect(h.gateway.generate.mock.calls[0]![0]).toMatchObject({ capability: "i2v", refs: [{ role: "first_frame" }] });
    expect(h.logs).toContain("  c klip atlandı: i2v düştü");
    expect(h.logs).toContain("  d klip atlandı: düz");
    expect(h.logs).toContain("  e klip atlandı: Depoda yok: assets/kf-kayip.png");
    expect(h.logs).toContain("  a klip ✓ (vid:fake)");
  });
});

describe("timeline, render ve inceleme", () => {
  const shots = Array.from({ length: 7 }, (_, i) => ({
    id: `s1-sh${i + 1}`,
    sceneId: "s1",
    kind: (i === 0 ? "ai_clip" : "still_motion") as "ai_clip" | "still_motion",
    startMs: i * 200,
    endMs: (i + 1) * 200,
    description: `shot ${i}`,
    imagePrompt: "",
    motionPrompt: "",
    camera: "static" as const,
  }));
  const keyframes = Object.fromEntries(shots.map((s) => [s.id, { key: `assets/kf/${s.id}.png`, mimeType: "image/png" }]));
  const ready = async (h: ReturnType<typeof harness>, extra: Partial<EpisodeState> = {}) => {
    for (const k of Object.values(keyframes)) h.store.putText(k.key, "png");
    h.store.putText("assets/clip.mp4", "mp4");
    h.store.putText("assets/voice/s1.mp3", "mp3");
    return h.seed(
      makeState({}, {
        script: { scenes: [scene("s1")] } as never,
        style: STYLE,
        voice: { s1: voiceOf("s1") },
        shots,
        keyframes,
        clips: { "s1-sh1": { key: "assets/clip.mp4", mimeType: "video/mp4", durationSec: 5 } },
        ...extra,
      }),
    );
  };

  it("timeline çekimlerden kurulur", async () => {
    const h = harness();
    const id = await ready(h);
    const state = await h.pipeline.run(id, { only: "timeline" });
    expect(state.timeline!.visuals).toHaveLength(7);
    expect(state.timeline!.vectorAssets).toEqual({});
  });

  it("render: varlıklar indirilir, klipler normalize edilir; ilerleme, bekleme ve yeniden deneme günlüğe yazılır", async () => {
    const h = harness();
    const none = await h.seed(makeState());
    await expect(h.pipeline.run(none, { only: "render" })).rejects.toThrow("timeline yok");

    const id = await ready(h);
    await h.pipeline.run(id, { only: "timeline" });
    render.episode.mockImplementationOnce(async (opts: any) => {
      opts.onProgress(0.05);
      opts.onProgress(0.07);
      opts.onWait(99);
      // Kayıt hatası render'ı durdurmaz.
      h.store.failPut = (k) => k.endsWith("state.json");
      opts.onProgress(0.55);
      await new Promise((r) => setTimeout(r, 5));
      h.store.failPut = undefined;
      opts.onRetry("ENOENT");
      opts.onProgress(0.05);
      return opts.outputPath;
    });
    const state = await h.pipeline.run(id, { only: "render" });
    expect(media.normalize).toHaveBeenCalledTimes(1);
    expect(media.normalize.mock.calls[0]![0]).toMatch(/clip\.mp4\.src$/);
    expect(state.render!.path).toMatch(new RegExp(`${id}\\.mp4$`));
    expect(h.logs.filter((l) => l.startsWith("  render %"))).toEqual(["  render %0", "  render %50", "  render %0"]);
    expect(h.logs).toContain("  başka bir render sürüyor (süreç 99); sıra bekleniyor");
    expect(h.logs).toContain("⚠ render geçici bir hatayla düştü (ENOENT); baştan bir kez daha deneniyor");
    // Altyazı her zaman .srt olarak videonun yanında; varsayılan (eski bölüm) gömülü.
    const srtPath = state.render!.path.replace(/\.mp4$/, ".srt");
    expect(readFileSync(srtPath, "utf8")).toMatch(/^1\n00:00:00,000 --> /);
    expect(h.logs).toContain(`  altyazı dosyası: ${srtPath}`);
    expect(render.episode.mock.calls.at(-1)![0].timeline.captions.length).toBeGreaterThan(0);
  });

  it("render: altyazı kapalıysa videoya gömülmez ama .srt yine yazılır; kelime yoksa .srt yok", async () => {
    const h = harness();
    const id = await ready(h);
    await h.pipeline.run(id, { only: "timeline" });
    const s = await h.pipeline.load(id);
    s.input.captions = false;
    await h.pipeline.save(s);
    const state = await h.pipeline.run(id, { only: "render" });
    expect(render.episode.mock.calls.at(-1)![0].timeline.captions).toEqual([]);
    expect(state.timeline!.captions.length).toBeGreaterThan(0);
    expect(existsSync(state.render!.path.replace(/\.mp4$/, ".srt"))).toBe(true);

    const quiet = await h.pipeline.load(id);
    quiet.timeline!.captions = [];
    await h.pipeline.save(quiet);
    rmSync(state.render!.path.replace(/\.mp4$/, ".srt"));
    await h.pipeline.run(id, { only: "render" });
    expect(existsSync(state.render!.path.replace(/\.mp4$/, ".srt"))).toBe(false);
  });

  it("inceleme: kareler 6'lık gruplarla denetlenir, dersler deftere yazılır", async () => {
    const h = harness();
    const none = await h.seed(makeState());
    await expect(h.pipeline.run(none, { only: "review" })).rejects.toThrow("timeline/shots yok");

    h.store.putJsonSync("library/lessons.json", { lessons: [{ target: "director", rule: "No floating people", count: 2, firstSeen: "x", lastSeen: "x", episodes: [] }] });
    const id = await ready(h);
    await h.pipeline.run(id, { only: "timeline" });
    onAgent("sceneCritic", (items: { shotId: string; intent: string }[]) => ({
      shots: items.map((i) => ({ shotId: i.shotId, score: 6, issues: i.shotId === "s1-sh1" ? [{ type: "cluttered", detail: "x" }, { type: "cluttered", detail: "y" }] : [] })),
      lessons: items.length === 6 ? [{ target: "director", rule: "Keep one focus per shot" }] : [],
    }));
    const state = await h.pipeline.run(id, { only: "review" });
    const batches = callsOf("sceneCritic").map((c) => c.args[0] as { shotId: string; intent: string }[]);
    expect(batches.map((b) => b.length).sort()).toEqual([1, 6]);
    expect(batches.flat().find((i) => i.shotId === "s1-sh1")!.intent).toBe('shot 0 | narration: "bir"');
    expect(Object.keys(state.stills!)).toHaveLength(7);
    expect(state.stills!["s1-sh1"]!.key).toMatch(new RegExp(`^assets/stills/${id}/s1-sh1-[0-9a-f]{12}\\.jpg$`));
    expect(h.logs).toContain("  7 kare, ortalama 6.0/10; sorunlar: cluttered×2");
    expect(h.logs).toContain("  ders (director): Keep one focus per shot");
    expect(callsOf("sceneCritic")[0]!.args[1]).toEqual(["No floating people"]);
    expect(h.store.json("library/lessons.json").lessons.map((l: { rule: string }) => l.rule)).toEqual(["No floating people", "Keep one focus per shot"]);
    expect(h.logs).toContain("  başka bir render sürüyor (süreç 4242); kareler için sıra bekleniyor");
  });

  it("inceleme: altyazı kapalıysa kareler altyazısız çıkar, denetçiye söylenir, altyazı alanı kusuru atılır", async () => {
    const h = harness();
    const id = await ready(h);
    await h.pipeline.run(id, { only: "timeline" });
    onAgent("sceneCritic", (items: { shotId: string }[]) => ({
      shots: items.map((i) => ({ shotId: i.shotId, score: 5, issues: [{ type: "text_on_subtitles", detail: "feet" }, { type: "empty", detail: "wall" }] })),
      lessons: [],
    }));
    const on = await h.pipeline.run(id, { only: "review" });
    expect(render.stills.mock.calls.at(-1)![0].timeline.captions.length).toBeGreaterThan(0);
    expect(callsOf("sceneCritic")[0]!.args[3]).toBe(true);
    expect(on.review!.shots["s1-sh1"]!.issues.map((i) => i.type)).toEqual(["text_on_subtitles", "empty"]);

    const s = await h.pipeline.load(id);
    s.input.captions = false;
    await h.pipeline.save(s);
    const off = await h.pipeline.run(id, { only: "review" });
    expect(render.stills.mock.calls.at(-1)![0].timeline.captions).toEqual([]);
    // Dudak senkronunun kelime zamanları altyazı kapalıyken de kalır.
    expect(render.stills.mock.calls.at(-1)![0].timeline.speech.length).toBeGreaterThan(0);
    expect(callsOf("sceneCritic").at(-1)!.args[3]).toBe(false);
    expect(off.review!.shots["s1-sh1"]!.issues.map((i) => i.type)).toEqual(["empty"]);
    // Anlatım yine denetçiye gider (altyazı yalnız kareden çıkar).
    const items = callsOf("sceneCritic").slice(-2).flatMap((c) => c.args[0] as { shotId: string; intent: string }[]);
    expect(items.find((i) => i.shotId === "s1-sh1")!.intent).toBe('shot 0 | narration: "bir"');
  });

  it("inceleme grubu başarısızsa atlanır; kare çıkmayan çekimler denetlenmez", async () => {
    const h = harness();
    const id = await ready(h);
    await h.pipeline.run(id, { only: "timeline" });
    render.stills.mockImplementationOnce(async () => ({}));
    await h.pipeline.run(id, { only: "review" });
    expect(callsOf("sceneCritic")).toHaveLength(0);
    expect(h.logs).toContain("  0 kare, ortalama 0.0/10; sorunlar: yok");

    onAgent("sceneCritic", () => {
      throw new Error("critic yok");
    });
    await h.pipeline.run(id, { only: "review" });
    expect(h.logs).toContain("  inceleme grubu atlandı: critic yok");
    onAgent("sceneCritic", () => {
      throw "düz";
    });
    await h.pipeline.run(id, { only: "review" });
    expect(h.logs).toContain("  inceleme grubu atlandı: düz");
  });
});

describe("previewConcept", () => {
  const selected = { c1: { key: "assets/c1.png", mimeType: "image/png" }, l1: { key: "assets/l1.png", mimeType: "image/png" } };

  it("ön koşullar", async () => {
    const h = harness();
    await expect(h.pipeline.previewConcept(await h.seed(makeState()))).rejects.toThrow("Önce casting ve konsept aşamaları çalışmalı");
    const vec = await h.seed(makeState({ motionMode: "vector" }, { script: SCRIPT, cast: CAST, concept: { candidates: {}, selected: {} } }));
    await expect(h.pipeline.previewConcept(vec)).rejects.toThrow("Vektör modunda deneme karesi yok");
    const missing = await h.seed(makeState({}, { script: SCRIPT, cast: CAST, concept: { candidates: {}, selected: { c1: selected.c1 } } }));
    await expect(h.pipeline.previewConcept(missing)).rejects.toThrow("Seçim yapılmamış: l1");
    const noStyle = await h.seed(makeState({}, { script: SCRIPT, cast: CAST, concept: { candidates: {}, selected } }));
    await expect(h.pipeline.previewConcept(noStyle)).rejects.toThrow("style yok");
  });

  it("ilk sahnelerden deneme kareleri üretir", async () => {
    const h = harness();
    h.store.putText("assets/c1.png", "c1");
    h.store.putText("assets/l1.png", "l1");
    const longScript = { scenes: [scene("s1", "x".repeat(200)), scene("s2"), scene("s3"), scene("s4")] } as never;
    const id = await h.seed(makeState({ width: 1080, height: 1920 }, { script: longScript, cast: CAST, style: STYLE, concept: { candidates: {}, selected } }));
    const state = await h.pipeline.previewConcept(id);
    expect(state.concept!.previews).toHaveLength(3);
    expect(state.concept!.previews![0]!.caption).toHaveLength(120);
    const byRef = (r: string) => h.gateway.requests.find((x) => x.run.refId === r)!.req;
    expect(byRef("s1")).toMatchObject({ capability: "i2i_multiref", aspectRatio: "9:16" });
    expect(byRef("s2")).toMatchObject({ capability: "t2i" });
    expect(h.logs).toContain("  deneme s1 ✓ (img:fake)");
    const one = await h.pipeline.previewConcept(id, 1);
    expect(one.concept!.previews).toHaveLength(1);
  });

  it("kare oranı kare videoda 1:1", async () => {
    const h = harness();
    const id = await h.seed(makeState({ width: 1080, height: 1080 }, { script: SCRIPT, cast: { characters: [], locations: [] }, style: STYLE, concept: { candidates: {}, selected: {} } }));
    await h.pipeline.previewConcept(id, 1);
    expect(h.gateway.requests[0]!.req.aspectRatio).toBe("1:1");
  });
});
