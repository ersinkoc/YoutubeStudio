import { mkdtempSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QueryFn } from "@ys/agents";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { curateLessons } from "../src/curate.ts";
import { applyCuration, CURATE_ABOVE, loadLessons, mergeLessons, saveLessons, topLessons, type LessonBook } from "../src/lessons.ts";
import { acquireLock, deadLock, liveLock } from "../src/lock.ts";
import { anonymizeNames } from "../src/names.ts";
import { judgeFrame, redrawPrompt } from "../src/qa.ts";
import { loadModelSettings, saveModelSettings } from "../src/settings.ts";
import { motionModeOf, type EpisodeInput } from "../src/state.ts";

const tempStore = (): AssetStore => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-small-")));

describe("model ayarları", () => {
  it("geçersiz seçimleri atarak yazar, geri okur; dosya yoksa boş", async () => {
    const store = tempStore();
    expect(await loadModelSettings(store)).toEqual({});
    const saved = await saveModelSettings(store, { director: "claude-haiku-5-5", bilinmeyen: "x", screenwriter: "gpt-9" });
    expect(saved).toEqual({ director: "claude-haiku-5-5" });
    expect(await getJson(store, "settings/models.json")).toEqual(saved);
    expect(await loadModelSettings(store)).toEqual(saved);
  });
});

describe("ders küratörü", () => {
  const book = (): LessonBook => {
    const b: LessonBook = { lessons: [] };
    mergeLessons(b, [{ target: "director", rule: "Vary backgrounds" }, { target: "director", rule: "Change rooms often" }], "e1", "2026-10-30T00:00:00Z");
    mergeLessons(b, [{ target: "script", rule: "Open with a moment" }], "e1", "2026-10-30T00:00:00Z");
    for (let i = 0; i <= CURATE_ABOVE; i++) mergeLessons(b, [{ target: "designer", rule: `Designer rule number ${i} alpha${i}` }], "e2");
    return b;
  };
  const curator = (seen: string[]): QueryFn =>
    ((params: { prompt: string }) => {
      seen.push(params.prompt);
      return (async function* () {
        yield { type: "result", subtype: "success", duration_ms: 1, total_cost_usd: 0.01, structured_output: { rules: [{ rule: "Merged", sources: [0, 1] }] } };
      })();
    }) as unknown as QueryFn;

  it("eşiği aşan hedefi birleştirir; force ile 2+ kuralı olan her hedef küratöre gider", async () => {
    const seen: string[] = [];
    const calls: [string, number][] = [];
    const b = await curateLessons(book(), { deps: { queryFn: curator(seen) }, onCall: (t, res, before) => void calls.push([t, before]) });
    // Yalnız eşiği (10) aşan tasarımcı kuralları küratöre gitti.
    expect(calls).toEqual([["designer", CURATE_ABOVE + 1]]);
    expect(b.lessons.filter((l) => l.target === "designer").map((l) => l.rule)).toEqual(["Merged"]);
    expect(b.lessons.filter((l) => l.target === "director")).toHaveLength(2);

    const forced = await curateLessons(book(), { force: true, deps: { queryFn: curator(seen) } });
    expect(forced.lessons.filter((l) => l.target === "director").map((l) => l.rule)).toEqual(["Merged"]);
    // Tek kuralı olan senaryo hedefi zorlamada da atlanır.
    expect(forced.lessons.filter((l) => l.target === "script").map((l) => l.rule)).toEqual(["Open with a moment"]);
  });

  it("varsayılan seçeneklerle eşik altındaki defter değişmeden döner", async () => {
    const b: LessonBook = { lessons: [] };
    mergeLessons(b, [{ target: "director", rule: "One rule" }], "e1");
    expect(await curateLessons(b)).toBe(b);
    expect(b.lessons).toHaveLength(1);
  });
});

describe("ders defteri: kenar durumlar", () => {
  it("boş kural atlanır; geçersiz kaynak indeksli birleşim defteri korur; kayıt/okuma", async () => {
    const b = mergeLessons({ lessons: [] }, [{ target: "director", rule: "   " }, { target: "director", rule: "Real rule" }], "e1");
    expect(b.lessons.map((l) => l.rule)).toEqual(["Real rule"]);
    applyCuration(b, "director", [{ rule: "Hayalet", sources: [7] }]);
    expect(b.lessons.map((l) => l.rule)).toEqual(["Real rule"]);
    const store = tempStore();
    expect(await loadLessons(store)).toEqual({ lessons: [] });
    await saveLessons(store, b);
    expect(await loadLessons(store)).toEqual(b);
  });
});

describe("ders sıralaması", () => {
  it("eşit sayıda tekrarlanan kurallardan yenisi önce gelir", () => {
    const b = mergeLessons({ lessons: [] }, [{ target: "director", rule: "Older rule here" }], "e1", "2026-10-01T00:00:00Z");
    mergeLessons(b, [{ target: "director", rule: "Newer rule here" }], "e2", "2026-10-02T00:00:00Z");
    expect(topLessons(b, "director")).toEqual(["Newer rule here", "Older rule here"]);
  });
});

describe("çalışma kilidi: kenar durumlar", () => {
  const key = "episodes/e1/run.lock.json";

  it("bozuk kilit dosyası kilit yok sayılır", async () => {
    const s = tempStore();
    await s.put(key, new TextEncoder().encode("{bozuk"), "application/json");
    expect(await liveLock(s, "e1")).toBeUndefined();
    expect(await deadLock(s, "e1")).toBe(false);
    const release = await acquireLock(s, "e1");
    await s.put(key, new TextEncoder().encode("{bozuk"), "application/json");
    // Bırakırken dosya okunamıyorsa (başkasının olabilir) dokunulmaz.
    await release();
    expect(new TextDecoder().decode((await s.get(key))!)).toBe("{bozuk");
  });

  it("başka makinedeki kilit canlı sayılır, ölü sayılmaz", async () => {
    const s = tempStore();
    const lock = { pid: 2 ** 22 + 1, host: `${hostname()}-baska`, startedAt: "t" };
    await putJson(s, key, lock);
    expect(await liveLock(s, "e1")).toEqual(lock);
    expect(await deadLock(s, "e1")).toBe(false);
    await expect(acquireLock(s, "e1")).rejects.toThrow(`süreç ${lock.pid}`);
  });

  it("kendi kilidini yeniden alabilir; kilidi başkası devraldıysa bırakma ona dokunmaz", async () => {
    const s = tempStore();
    await acquireLock(s, "e1");
    const release = await acquireLock(s, "e1");
    const other = { pid: process.ppid, host: hostname(), startedAt: "t" };
    await putJson(s, key, other);
    await release();
    expect(await getJson(s, key)).toEqual(other);
  });
});

describe("küçük yardımcılar", () => {
  it("tek kelimelik, kısa ya da küçük harfli soyad ayrıca değiştirilmez", () => {
    const cast = [{ id: "c1", name: "Plato" }, { id: "c2", name: "Ali Oz" }, { id: "c3", name: "Jan van" }];
    expect(anonymizeNames("Plato and Oz met van", cast)).toBe("Character A and Oz met van");
  });

  it("sorunsuz ve önerisiz kare için yeniden çizim prompt'u yalnız asıl prompt", () => {
    expect(redrawPrompt("A desk", judgeFrame({ score: 3, issues: [], fix: "" }, 1))).toBe("A desk");
  });

  it("hareket kipi seçilmemişse yapay klip oranından çıkar", () => {
    const input = { aiClipRatio: 0 } as EpisodeInput;
    expect(motionModeOf(input)).toBe("still");
    expect(motionModeOf({ ...input, aiClipRatio: 0.3 })).toBe("mixed");
    expect(motionModeOf({ ...input, motionMode: "vector" })).toBe("vector");
  });
});
