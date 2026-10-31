import { describe, expect, it } from "vitest";
import { formatText, LocalizedError, MESSAGES, msg, STYLE_PACKS, trText } from "@ys/core";
import { AssetRejectedError, firstLine, joinTexts, QuotaError } from "../src/pipeline.ts";

describe("pipeline mesajları", () => {
  it("firstLine: düz hata, düz değer, parametreli ve parametresiz çevrilebilir hata", () => {
    expect(firstLine(new Error("bir\niki"))).toBe("bir");
    expect(firstLine("düz\ndeğer")).toBe("düz");
    const wrapped = firstLine(new LocalizedError(msg("err.missing", { what: "a\nb", n: 3, inner: msg("log.cached") })));
    expect(wrapped).toEqual(msg("err.missing", { what: "a", n: 3, inner: msg("log.cached") }));
    expect(formatText("en", wrapped)).toBe("a missing");
    expect(firstLine(new LocalizedError(msg("err.voice.noProvider")))).toEqual(msg("err.voice.noProvider", {}));
  });

  it("joinTexts: satırları her dilde birleştirir", () => {
    const list = joinTexts([msg("log.item", { id: "p1", error: msg("err.store.missing", { key: "k" }) }), "p2: düz"], "log.join.indented");
    expect(trText(list)).toBe("p1: Depoda yok: k\n  p2: düz");
    expect(formatText("en", list)).toBe("p1: Not in storage: k\n  p2: düz");
    expect(joinTexts(["tek"], "log.join.line")).toBe("tek");
  });

  it("pipeline hataları çevrilebilir; her stil paketinin adı katalogda", () => {
    const e = new AssetRejectedError(msg("err.asset.rejected", { name: "Rider", score: msg("log.gate.score", { recognizable: 5, guess: "x" }) }));
    expect(e.message).toBe('Rider: kalite kapısı geçilemedi (tanınırlık 5/10 ("x"))');
    expect(formatText("en", e.text)).toBe('Rider: failed the quality gate (recognizability 5/10 ("x"))');
    expect(new QuotaError(msg("err.voice.noProvider"))).toBeInstanceOf(LocalizedError);
    const names = MESSAGES as Record<string, { tr: string; en: string }>;
    for (const p of STYLE_PACKS) expect(names[`style.pack.${p.id}`]).toEqual(p.name);
  });
});
