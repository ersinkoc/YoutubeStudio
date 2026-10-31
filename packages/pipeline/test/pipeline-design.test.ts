import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetRejectedError, type AssetRef, type EpisodeState } from "../src/index.ts";
import { callsOf, onAgent, refs, resetFakes } from "./pipeline-fakes.ts";
import { CHARACTER_SVG, harness, makeState, PROP_SVG, ROOM_SVG, STYLE, type Harness } from "./pipeline-harness.ts";

vi.mock("@ys/agents", async (orig) => (await import("./pipeline-fakes.ts")).mockAgents(await orig()));
vi.mock("@ys/video/render", async () => {
  const f = await import("./pipeline-fakes.ts");
  return { renderEpisode: (o: any) => f.render.episode(o), renderStills: (o: any) => f.render.stills(o) };
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
 * Vektör varlık tasarımı (designAsset): plan → çizim → kör tahmin → kalite kapısı → kütüphane; referanslar, gerçeklik
 * ayarı, kütüphane güveni, insan reddi zinciri, önceki reddin yeniden değerlendirilmesi ve Commons'tan hazır SVG.
 * Ajanlar, referans araması ve rasterleştirme sahtedir.
 */

type Brief = { kind: "character" | "prop" | "background"; id?: string; name: string; description: string; reference?: string; variation?: number };
const design = (h: Harness, state: EpisodeState, brief: Brief): Promise<AssetRef> =>
  (h.pipeline as unknown as { designAsset(s: EpisodeState, stage: string, b: Brief): Promise<AssetRef> }).designAsset(state, "concept", brief);

const IMG = { data: new Uint8Array([9]), mimeType: "image/jpeg" };
const vstate = (input: object = {}) => makeState({ motionMode: "vector", ...input }, { style: STYLE });
const RIDER: Brief = { kind: "character", id: "c1", name: "Rider", description: "young rider" };
const HORSE: Brief = { kind: "prop", id: "p-horse", name: "p-horse", description: "a mustang horse, side view", reference: "Mustang horse" };

/** Kapının puanları sırayla (son değer tekrarlanır). */
function agents(o: { scores?: number[]; fidelity?: number | null; plan?: object } = {}) {
  const scores = [...(o.scores ?? [9])];
  onAgent("assetPlanner", () => o.plan ?? { subject: "a young rider standing", moved: [], cues: [] });
  onAgent("vectorDesigner", (b: Brief) =>
    b.kind === "character"
      ? { svg: CHARACTER_SVG, realHeight: 1.7, grounded: true }
      : b.kind === "background"
        ? { svg: ROOM_SVG, realHeight: 3, grounded: true, floorY: 700 }
        : { svg: PROP_SVG, realHeight: 1.6, grounded: true, surface: 0.5 },
  );
  onAgent("assetGuess", () => ({ guess: "a thing", confidence: 7 }));
  onAgent("assetGate", () => ({ recognizable: scores.length > 1 ? scores.shift()! : scores[0]!, fidelity: o.fidelity ?? null, defects: ["arms too short"] }));
  onAgent("propPhysics", () => ({ realHeight: 1.5, grounded: true, surface: null }));
}
const designerFixes = () => callsOf("vectorDesigner").map((c) => (c.args[0] as { fix?: string }).fix);

beforeEach(() => {
  resetFakes();
  refs.find.mockResolvedValue({ images: [], sources: [], keys: [] });
  refs.vectors.mockResolvedValue([]);
  refs.rasterize.mockResolvedValue({ data: new Uint8Array([1]), mimeType: "image/png" });
});

describe("designAsset: çizim ve kapı", () => {
  it("karakter: plan → çizim → kapı; kimlik, plan ve fizik kütüphaneye yazılır, ikinci kullanım ücretsiz", async () => {
    const h = harness();
    agents({ plan: { subject: "a young rider standing", moved: ["the horse"], cues: ["hat"] } });
    const state = vstate();
    const ref = await design(h, state, RIDER);
    expect(ref.key).toMatch(/^library\/vector\/character\/[0-9a-f]{32}\.svg$/);
    expect(h.store.text(ref.key)).toContain('id="head"');
    const meta = h.store.json(`${ref.key}.json`);
    expect(meta).toMatchObject({ realHeight: 1.7, grounded: true, identity: { name: "Rider", pack: "flat-explainer", artStyle: STYLE.artStyle, episodes: [] } });
    expect(meta.check).toMatchObject({ passed: true, attempts: 1, recognizable: 9, entityId: "c1", plan: { subject: "a young rider standing" } });
    expect(meta.check.fidelity).toBeUndefined();
    expect(h.store.json(ref.key.replace(/\.svg$/, ".plan.json")).moved).toEqual(["the horse"]);
    expect(state.assetChecks![ref.key]!.passed).toBe(true);
    expect(h.logs).toContain("  Rider: çizim planı → a young rider standing (bu çizime girmeyen: the horse)");
    expect(h.logs.some((l) => l.startsWith("  Rider: çizildi ("))).toBe(true);
    expect(refs.find).not.toHaveBeenCalled();

    // Kütüphanede güvenilir kayıt: ajan çağrılmaz, kimlik yeniden yazılmaz.
    const other = vstate();
    expect((await design(h, other, RIDER)).key).toBe(ref.key);
    expect(callsOf("vectorDesigner")).toHaveLength(1);
    expect(callsOf("assetPlanner")).toHaveLength(1);
    expect(other.assetChecks![ref.key]).toMatchObject({ passed: true, entityId: "c1" });
    expect(h.logs).toContain("  Rider: kütüphaneden (kapı ✓)");

    // Kimliksiz eski kayıt: kimlik eklenir.
    h.store.putJsonSync(`${ref.key}.json`, { ...meta, identity: undefined });
    await design(h, vstate(), RIDER);
    expect(h.store.json(`${ref.key}.json`).identity.name).toBe("Rider");
  });

  it("nesne: referans bulunursa ona bakılarak çizilir ve sadakat puanlanır", async () => {
    const h = harness();
    agents({ fidelity: 8 });
    refs.find.mockResolvedValue({ images: [IMG], sources: [{ title: "Mustang", url: "https://x" }], keys: ["library/ref/1.jpg"] });
    const state = vstate();
    const ref = await design(h, state, HORSE);
    const check = state.assetChecks![ref.key]!;
    expect(check).toMatchObject({ passed: true, fidelity: 8, query: "Mustang horse", sources: [{ title: "Mustang" }], refs: ["library/ref/1.jpg"] });
    expect(check.fidelitySkipped).toBeUndefined();
    expect((callsOf("vectorDesigner")[0]!.args[0] as { references: unknown[] }).references).toEqual([IMG]);
    expect((callsOf("assetGate")[0]!.args[0] as { references: unknown[] }).references).toEqual([IMG]);
    expect(h.logs).toContain('  p-horse: referans "Mustang horse" → Mustang');
    expect(h.logs.some((l) => l.includes("gerçeğe sadakat 8/10"))).toBe(true);
    // Hazır SVG de arandı (bulunamadı).
    expect(refs.vectors).toHaveBeenCalledWith("Mustang horse", expect.anything());
    expect(h.store.json(`${ref.key}.json`)).toMatchObject({ realHeight: 1.6, grounded: true, surface: 0.5 });
  });

  it("planlayıcı referansların özneyi göstermediğini söylerse önerdiği sorguyla yeniden aranır", async () => {
    const h = harness();
    agents({ fidelity: 8, plan: { subject: "Photo 51", moved: [], cues: ["X of spots"], referencesMatch: false, betterQuery: "Photo 51" } });
    const GOOD = { data: new Uint8Array([7]), mimeType: "image/jpeg" };
    refs.find
      .mockResolvedValueOnce({ images: [IMG], sources: [{ title: "JWST galaxy", url: "https://x" }], keys: ["library/ref/galaxy.jpg"] })
      .mockResolvedValueOnce({ images: [GOOD], sources: [{ title: "Photo 51", url: "https://y" }], keys: ["library/ref/p51.jpg"] });
    const state = vstate();
    const ref = await design(h, state, { kind: "prop", id: "p-xray", name: "p-xray", description: "Black square X-ray diffraction photograph" });
    expect(refs.find).toHaveBeenNthCalledWith(2, "Photo 51", expect.anything());
    // Planlayıcı ilk (alakasız) görsellerle çalıştı; tasarımcı ve kapı yenileri görür.
    expect((callsOf("assetPlanner")[0]!.args[0] as { references: unknown[] }).references).toEqual([IMG]);
    expect((callsOf("vectorDesigner")[0]!.args[0] as { references: unknown[] }).references).toEqual([GOOD]);
    expect((callsOf("assetGate")[0]!.args[0] as { references: unknown[] }).references).toEqual([GOOD]);
    expect(state.assetChecks![ref.key]).toMatchObject({ query: "Photo 51", refs: ["library/ref/p51.jpg"] });
    expect(h.logs).toContain('  p-xray: referanslar özneyi göstermiyor, yeniden aranıyor: "Photo 51"');
    expect(h.logs).toContain('  p-xray: referans "Photo 51" → Photo 51');
  });

  it("referanslar özneyi göstermiyor ve daha iyi sorgu yoksa (ya da aynıysa) görseller kullanılmaz", async () => {
    for (const betterQuery of ["", " mustang HORSE "]) {
      resetFakes();
      refs.vectors.mockResolvedValue([]);
      const h = harness();
      agents({ fidelity: 8, plan: { subject: "a mustang", moved: [], cues: [], referencesMatch: false, betterQuery } });
      refs.find.mockResolvedValue({ images: [IMG], sources: [{ title: "Wrong", url: "https://x" }], keys: ["k"] });
      const state = vstate();
      const ref = await design(h, state, HORSE);
      expect(refs.find).toHaveBeenCalledTimes(1);
      expect((callsOf("vectorDesigner")[0]!.args[0] as { references?: unknown }).references).toBeUndefined();
      expect((callsOf("assetGate")[0]!.args[0] as { references?: unknown }).references).toBeUndefined();
      expect(state.assetChecks![ref.key]).toMatchObject({ passed: true, sources: [], refs: [] });
      expect(state.assetChecks![ref.key]!.query).toBeUndefined();
      expect(h.logs).toContain("  p-horse: referanslar özneyi göstermiyor, kullanılmıyor");
    }
  });

  it("gerçeklik kapalı: sadakat yok sayılır ve kayıt işaretlenir; referans konuyu göstermiyorsa (null) yalnız tanınırlık", async () => {
    const h = harness();
    agents({ fidelity: 2 });
    refs.find.mockResolvedValue({ images: [IMG], sources: [{ title: "M", url: "u" }], keys: [] });
    const off = vstate({ realism: false });
    const ref = await design(h, off, HORSE);
    expect(off.assetChecks![ref.key]).toMatchObject({ passed: true, fidelitySkipped: true });
    expect(off.assetChecks![ref.key]!.fidelity).toBeUndefined();

    const h2 = harness();
    agents({ fidelity: null });
    refs.find.mockResolvedValue({ images: [IMG], sources: [], keys: [] });
    const on = vstate();
    const ref2 = await design(h2, on, HORSE);
    expect(on.assetChecks![ref2.key]).toMatchObject({ passed: true });
    expect(on.assetChecks![ref2.key]!.fidelity).toBeUndefined();
  });

  it("referanssız nesne: tariften arama yapılır, görsel yoksa tarifle çizilir", async () => {
    const h = harness();
    agents();
    const state = vstate();
    const ref = await design(h, state, { kind: "prop", id: "p-cup", name: "p-cup", description: "A white tea cup, front view" });
    expect(refs.find).toHaveBeenCalledWith("white tea cup", expect.anything());
    expect(h.logs).toContain('  p-cup: referans "white tea cup" için görsel bulunamadı, tarifle çiziliyor');
    expect(state.assetChecks![ref.key]!.query).toBeUndefined();
    expect((callsOf("vectorDesigner")[0]!.args[0] as { references?: unknown }).references).toBeUndefined();
  });

  it("plan hazırlanamazsa tarifle çizilir; yeniden çizim notu adı kullanır", async () => {
    const h = harness();
    agents({ scores: [3, 9] });
    onAgent("assetPlanner", () => {
      throw new Error("planlayıcı yok");
    });
    const state = vstate();
    const ref = await design(h, state, { kind: "background", id: "l1", name: "Station", description: "relay station" });
    expect(h.logs).toContain("  Station: çizim planı hazırlanamadı, tarifle çiziliyor (planlayıcı yok)");
    expect(designerFixes()[1]).toContain('saw: "a thing". It must read clearly as: Station.');
    expect(state.assetChecks![ref.key]).toMatchObject({ passed: true, attempts: 2 });
    expect(h.store.json(`${ref.key}.json`).floorY).toBe(700);
    // Arka plan zemini atılmaz (oda kabuğu olduğu gibi).
    expect(h.store.text(ref.key)).toContain('height="380"');

    onAgent("assetPlanner", () => {
      throw "düz";
    });
    await design(h, vstate(), { kind: "background", id: "l2", name: "Barn", description: "old barn" });
    expect(h.logs).toContain("  Barn: çizim planı hazırlanamadı, tarifle çiziliyor (düz)");
  });

  it("depoda planı olan varlık için planlayıcı yeniden çağrılmaz; yeniden çizim planın öznesini ister", async () => {
    const h = harness();
    agents({ scores: [5, 4, 3] });
    const state = vstate();
    await expect(design(h, state, RIDER)).rejects.toBeInstanceOf(AssetRejectedError);
    expect(callsOf("assetPlanner")).toHaveLength(1);
    expect(designerFixes()[1]).toContain("It must read clearly as: a young rider standing.");
    expect(designerFixes()[1]).toContain("- arms too short");

    // Aynı bölümde devam: plan depodan gelir.
    const before = callsOf("assetPlanner").length;
    await expect(design(h, vstate(), RIDER)).rejects.toBeInstanceOf(AssetRejectedError);
    expect(callsOf("assetPlanner")).toHaveLength(before);
  });

  it("üç denemede geçemeyen çizim reddedilir; en iyi deneme yalnız gösterim için saklanır", async () => {
    const h = harness();
    agents({ scores: [5, 4] });
    let n = 0;
    onAgent("vectorDesigner", () => (++n === 3 ? { svg: "bozuk çıktı", realHeight: 1.7, grounded: true } : { svg: CHARACTER_SVG.replace("#c33", n === 1 ? "#111" : "#222"), realHeight: 1.7, grounded: true }));
    const state = vstate();
    const err = await design(h, state, RIDER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssetRejectedError);
    expect((err as Error).message).toBe('Rider: kalite kapısı geçilemedi (tanınırlık 5/10 ("a thing"))');
    const [key, check] = Object.entries(state.assetChecks!)[0]!;
    expect(check).toMatchObject({ passed: false, attempts: 3, recognizable: 5 });
    expect(check.rejectedKey).toBe(key.replace(/\.svg$/, ".rejected.svg"));
    // Saklanan, puanı en yüksek olan ilk deneme.
    expect(h.store.text(check.rejectedKey!)).toContain("#111");
    expect(h.store.json(`${check.rejectedKey}.json`).identity.name).toBe("Rider");
    expect(h.store.text(key)).toBeUndefined();
    expect(h.logs).toContain("  Rider: deneme 3 geçersiz SVG (SVG bulunamadı)");
    expect(h.logs.some((l) => l.startsWith("  ✗ REDDEDİLDİ Rider: 3 denemede kalite kapısı geçilemedi"))).toBe(true);
  });

  it("hiçbir deneme geçerli SVG değilse son hata fırlatılır (ret değil)", async () => {
    const h = harness();
    agents();
    let n = 0;
    onAgent("vectorDesigner", () => {
      n++;
      // 1: iskelet eksik, 2: temizleyici düz değer fırlatır, 3: SVG yok.
      if (n === 1) return { svg: ROOM_SVG, realHeight: 1.7, grounded: true };
      if (n === 2)
        return {
          svg: {
            search() {
              throw "patladı";
            },
          },
          realHeight: 1.7,
          grounded: true,
        };
      return { svg: "yok", realHeight: 1.7, grounded: true };
    });
    const err = await design(h, vstate(), RIDER).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AssetRejectedError);
    expect((err as Error).message).toBe("SVG bulunamadı");
    expect(h.logs).toContain("  Rider: deneme 1 geçersiz SVG (iskelet parçası eksik: head, body, arm-l, arm-r, leg-l, leg-r)");
    expect(h.logs).toContain("  Rider: deneme 2 geçersiz SVG (patladı)");
    expect(designerFixes()[1]).toBe("- The SVG was invalid: iskelet parçası eksik: head, body, arm-l, arm-r, leg-l, leg-r");
    expect(designerFixes()[2]).toBe("- The SVG was invalid: patladı");
    expect(callsOf("assetGate")).toHaveLength(0);
  });
});

describe("designAsset: kütüphane güveni ve önceki ret", () => {
  it("gerçeklik kapalıyken geçmiş kayıt, gerçeklik açık bölümde yeniden denetlenir", async () => {
    const h = harness();
    agents({ fidelity: 8 });
    refs.find.mockResolvedValue({ images: [IMG], sources: [{ title: "M", url: "u" }], keys: [] });
    // Karakter (kimlikli) ve nesne (kimliksiz) gerçeklik kapalı bölümde çizilir.
    const riderRef = { ...RIDER, reference: "Pony Express rider" };
    const off = vstate({ realism: false });
    const charKey = (await design(h, off, riderRef)).key;
    const propKey = (await design(h, off, HORSE)).key;
    expect(h.store.json(`${charKey}.json`).check.fidelitySkipped).toBe(true);
    const drawn = callsOf("vectorDesigner").length;

    // Gerçeklik kapalı başka bölüm: kayıt güvenilir, kapı yok.
    const gates = callsOf("assetGate").length;
    await design(h, vstate({ realism: false }), HORSE);
    expect(callsOf("assetGate")).toHaveLength(gates);

    // Gerçeklik açık: yeniden denetlenir ve geçer; çizilmez.
    const on = vstate();
    expect((await design(h, on, riderRef)).key).toBe(charKey);
    expect((await design(h, on, HORSE)).key).toBe(propKey);
    expect(callsOf("vectorDesigner")).toHaveLength(drawn);
    expect(h.store.json(`${charKey}.json`).check).toMatchObject({ fidelity: 8, passed: true });
    expect(h.store.json(`${charKey}.json`).check.fidelitySkipped).toBeUndefined();
    expect(h.store.json(`${charKey}.json`).identity.name).toBe("Rider");
    expect(h.store.json(`${propKey}.json`).identity).toBeUndefined();
    expect(h.logs.filter((l) => l.includes(": kütüphaneden, kapı ✓ ("))).toHaveLength(2);
  });

  it("insanın kabul ettiği kayıt sadakati atlanmış olsa da güvenilir", async () => {
    const h = harness();
    agents({ fidelity: 8 });
    refs.find.mockResolvedValue({ images: [IMG], sources: [], keys: [] });
    const key = (await design(h, vstate({ realism: false }), HORSE)).key;
    const meta = h.store.json(`${key}.json`);
    h.store.putJsonSync(`${key}.json`, { ...meta, check: { ...meta.check, override: { decision: "accepted", at: "2026-10-30" } } });
    const gates = callsOf("assetGate").length;
    await design(h, vstate(), HORSE);
    expect(callsOf("assetGate")).toHaveLength(gates);
  });

  it("kapıdan geçemeyen ya da metası olmayan kütüphane çizimi yeniden çizilir (referans bir kez aranır)", async () => {
    const h = harness();
    agents();
    refs.find.mockResolvedValue({ images: [IMG], sources: [], keys: [] });
    const key = (await design(h, vstate(), HORSE)).key;
    // Kapıdan önce çizilmiş eski varlık: meta yok.
    h.store.map.delete(`${key}.json`);
    refs.find.mockClear();
    agents({ scores: [3, 9] });
    const state = vstate();
    expect((await design(h, state, HORSE)).key).toBe(key);
    expect(h.logs.some((l) => l.startsWith("  p-horse: kütüphanedeki çizim kapıdan geçemedi (tanınırlık 3/10"))).toBe(true);
    expect(refs.find).toHaveBeenCalledTimes(1);
    expect(state.assetChecks![key]).toMatchObject({ passed: true, attempts: 1 });
  });

  it("önceki reddedilen deneme bugünkü kurala göre geçiyorsa para harcamadan kullanılır", async () => {
    const h = harness();
    agents({ scores: [9], fidelity: 3 });
    refs.find.mockResolvedValue({ images: [IMG], sources: [], keys: [] });
    const state = vstate();
    await expect(design(h, state, HORSE)).rejects.toBeInstanceOf(AssetRejectedError);
    const [key, check] = Object.entries(state.assetChecks!)[0]!;
    expect(check).toMatchObject({ passed: false, fidelity: 3 });

    // Gerçeklik açıkken hâlâ geçmez: yeniden çizilmez (para harcanmaz), hemen yine reddedilir; yeni çizim insan kararıyla.
    const gates = callsOf("assetGate").length;
    await expect(design(h, state, HORSE)).rejects.toThrow("kalite kapısı geçilemedi (önceki deneme)");
    expect(callsOf("vectorDesigner")).toHaveLength(3);
    expect(callsOf("assetGate")).toHaveLength(gates);
    expect(h.logs.at(-1)).toMatch(/^ {2}p-horse: bu bölümde kalite kapısından reddedilmişti \(tanınırlık 9\/10 .*gerçeğe sadakat 3\/10\), yeniden çizilmiyor$/);

    // Reddedilen SVG ya da metası kayıpsa kullanılamaz.
    state.input.realism = false;
    const svg = h.store.map.get(check.rejectedKey!)!;
    h.store.map.delete(check.rejectedKey!);
    onAgent("assetGate", () => ({ recognizable: 3, fidelity: null, defects: [] }));
    await expect(design(h, state, HORSE)).rejects.toBeInstanceOf(AssetRejectedError);
    h.store.map.set(check.rejectedKey!, svg);
    const metaJson = h.store.map.get(`${check.rejectedKey}.json`)!;
    h.store.map.delete(`${check.rejectedKey}.json`);
    await expect(design(h, state, HORSE)).rejects.toBeInstanceOf(AssetRejectedError);
    h.store.map.set(`${check.rejectedKey}.json`, metaJson);

    // Gerçeklik kapatıldı: aynı deneme geçer, çizilmeden kullanılır.
    state.assetChecks![key] = { ...check };
    const drawn = callsOf("vectorDesigner").length;
    const ref = await design(h, state, HORSE);
    expect(ref.key).toBe(key);
    expect(callsOf("vectorDesigner")).toHaveLength(drawn);
    expect(h.store.text(key)).toBe(new TextDecoder().decode(svg));
    expect(state.assetChecks![key]).toMatchObject({ passed: true, fidelitySkipped: true, entityId: "p-horse" });
    expect(state.assetChecks![key]!.fidelity).toBeUndefined();
    expect(h.store.json(`${key}.json`).check.passed).toBe(true);
    expect(h.logs).toContain("  p-horse: önceki deneme bugünkü kurala göre geçiyor (gerçeklik denetimi kapalı), yeniden çizilmeden kullanılıyor");
  });

  it("kural gevşedikten sonra önceki reddedilen deneme gerçeklik açıkken de kullanılır", async () => {
    const h = harness();
    agents({ scores: [5] });
    const state = vstate();
    await expect(design(h, state, RIDER)).rejects.toBeInstanceOf(AssetRejectedError);
    const [key, check] = Object.entries(state.assetChecks!)[0]!;
    // Kayıttaki puan bugünkü eşiği geçiyor (ör. eşik düşürüldü): para harcanmaz.
    state.assetChecks![key] = { ...check, recognizable: 9 };
    const drawn = callsOf("vectorDesigner").length;
    expect((await design(h, state, RIDER)).key).toBe(key);
    expect(callsOf("vectorDesigner")).toHaveLength(drawn);
    expect(state.assetChecks![key]).toMatchObject({ passed: true, recognizable: 9 });
    expect(state.assetChecks![key]!.fidelitySkipped).toBeUndefined();
  });

  it("insan reddi zinciri: her ret yeni anahtara çizdirir, notlar birikir, hazır SVG aranmaz", async () => {
    const h = harness();
    agents();
    refs.find.mockResolvedValue({ images: [IMG], sources: [], keys: [] });
    const state = vstate();
    const k1 = (await design(h, state, HORSE)).key;
    expect(refs.vectors).toHaveBeenCalledTimes(1);
    const meta1 = h.store.json(`${k1}.json`);
    h.store.putJsonSync(`${k1}.json`, { ...meta1, check: { ...meta1.check, override: { decision: "rejected", note: "make it brown", at: "t1" } } });

    agents({ scores: [3, 9] });
    const drawn = callsOf("vectorDesigner").length;
    const k2 = (await design(h, state, HORSE)).key;
    expect(k2).not.toBe(k1);
    expect(k2.startsWith("library/vector/prop/")).toBe(true);
    const fixes = designerFixes().slice(drawn);
    expect(fixes).toHaveLength(2);
    expect(fixes.every((f) => f?.startsWith("- Human reviewer: make it brown"))).toBe(true);
    expect(fixes[1]).toContain("- arms too short");
    expect(refs.vectors).toHaveBeenCalledTimes(1);
    // Eski çizim yerinde kalır.
    expect(h.store.text(k1)).toBeDefined();

    // İkinci ret notsuz ve yalnız bölüm durumunda (kütüphane metası okunamıyor): zincir sürer, not tekrarlanmaz.
    state.assetChecks![k2] = { ...state.assetChecks![k2]!, override: { decision: "rejected", at: "t2" } };
    h.store.putJsonSync(`${k2}.json`, { realHeight: -1 });
    agents();
    const k3 = (await design(h, state, HORSE)).key;
    expect(new Set([k1, k2, k3]).size).toBe(3);
    expect(designerFixes().at(-1)).toBe("- Human reviewer: make it brown");
  });
});

describe("designAsset: Commons'tan hazır SVG", () => {
  it("arama hatası tasarımcıya bırakır (Error ve düz değer)", async () => {
    const h = harness();
    agents();
    refs.vectors.mockRejectedValueOnce(new Error("ağ yok"));
    await design(h, vstate(), HORSE);
    expect(h.logs).toContain("  p-horse: hazır SVG aranamadı (ağ yok)");
    refs.vectors.mockRejectedValueOnce("düz");
    await design(h, vstate(), { ...HORSE, description: "a bay horse" });
    expect(h.logs).toContain("  p-horse: hazır SVG aranamadı (düz)");
    expect(callsOf("vectorDesigner")).toHaveLength(2);
  });

  it("boyutsuz aday atlanır, kapıdan geçemeyen atlanır, geçen ilk aday fizik bilgisiyle yazılır", async () => {
    const h = harness();
    agents({ scores: [4, 8] });
    refs.vectors.mockResolvedValueOnce([
      { svg: "<svg><rect/></svg>", source: { title: "NoBox", url: "u0", license: "CC0" } },
      { svg: PROP_SVG, source: { title: "Bad horse", url: "u1", license: "CC0" } },
      { svg: PROP_SVG.replace("#a52", "#842"), source: { title: "Good horse", url: "u2", license: "Public domain" } },
    ]);
    const state = vstate();
    const ref = await design(h, state, HORSE);
    expect(callsOf("vectorDesigner")).toHaveLength(0);
    expect(callsOf("assetPlanner")).toHaveLength(0);
    expect(h.store.text(ref.key)).toContain("#842");
    // Beyaz zemin dikdörtgeni atıldı.
    expect(h.store.text(ref.key)).not.toContain('fill="#fff"');
    const meta = h.store.json(`${ref.key}.json`);
    expect(meta).toMatchObject({ realHeight: 1.5, grounded: true, check: { passed: true, attempts: 0, sources: [{ title: "Good horse" }] } });
    expect(meta.surface).toBeUndefined();
    expect(state.assetChecks![ref.key]!.recognizable).toBe(8);
    expect(h.logs.some((l) => l.startsWith('  p-horse: hazır SVG "Bad horse" (CC0) → tanınırlık 4/10') && l.endsWith("✗"))).toBe(true);
    expect(h.logs.some((l) => l.startsWith('  p-horse: hazır SVG "Good horse" (Public domain) → tanınırlık 8/10') && l.endsWith("✓"))).toBe(true);
  });

  it("yüzeyli hazır nesnenin yüzey bilgisi korunur", async () => {
    const h = harness();
    agents();
    onAgent("propPhysics", () => ({ realHeight: 0.75, grounded: true, surface: 0.95 }));
    refs.vectors.mockResolvedValueOnce([{ svg: PROP_SVG, source: { title: "Desk", url: "u", license: "CC0" } }]);
    const ref = await design(h, vstate(), { kind: "prop", id: "p-desk", name: "p-desk", description: "wooden desk" });
    expect(h.store.json(`${ref.key}.json`).surface).toBe(0.95);
  });
});

describe("designAsset: tasarımcı hatası", () => {
  it("tasarımcının kendi hatası bir çizim hakkını yer, varlık hemen düşmez; diğer hatalar yukarı çıkar", async () => {
    const { AgentError } = await import("@ys/agents");
    const h = harness();
    agents();
    let n = 0;
    onAgent("vectorDesigner", () => {
      if (++n === 1) throw new AgentError("vector-designer:prop: error_max_structured_output_retries\nayrıntı", 0.05, "m", "vector-designer:prop");
      return { svg: PROP_SVG, realHeight: 1.6, grounded: true, surface: 0.5 };
    });
    const ref = await design(h, vstate(), { kind: "prop", id: "p-box", name: "p-box", description: "a wooden box" });
    expect(h.store.text(ref.key)).toContain("<circle");
    expect(callsOf("vectorDesigner")).toHaveLength(2);
    expect(h.logs).toContain("  p-box: deneme 1 tasarımcı hatası (vector-designer:prop: error_max_structured_output_retries)");

    onAgent("vectorDesigner", () => {
      throw new Error("iptal");
    });
    await expect(design(h, vstate(), { kind: "prop", id: "p-cup", name: "p-cup", description: "a tea cup" })).rejects.toThrow("iptal");
  });

  it("tasarımcı her denemede hata verirse son hata yukarı çıkar", async () => {
    const { AgentError } = await import("@ys/agents");
    const h = harness();
    agents();
    onAgent("vectorDesigner", () => {
      throw new AgentError("vector-designer:prop: error_max_turns", 0.01);
    });
    await expect(design(h, vstate(), { kind: "prop", id: "p-pen", name: "p-pen", description: "a pen" })).rejects.toThrow("error_max_turns");
    expect(callsOf("vectorDesigner")).toHaveLength(3);
  });
});
