import { describe, expect, it } from "vitest";
import { betterGate, gatePasses, QUALITY_GATE } from "@ys/core";

describe("kalite kapısı kararı", () => {
  it("tanınırlık eşiği türe göre; referans varsa sadakat de gerekir", () => {
    const min = QUALITY_GATE.recognizableMin;
    expect(gatePasses("prop", { recognizable: min.prop })).toBe(true);
    expect(gatePasses("prop", { recognizable: min.prop - 1 })).toBe(false);
    // Boş oda kabuğu daha düşük tanınırlıkla geçer.
    expect(gatePasses("background", { recognizable: min.background })).toBe(true);
    expect(gatePasses("character", { recognizable: 9, fidelity: QUALITY_GATE.fidelityMin - 1 })).toBe(false);
    expect(gatePasses("character", { recognizable: 9, fidelity: QUALITY_GATE.fidelityMin })).toBe(true);
  });

  it("geçen deneme her zaman geçmeyenden iyidir; ikisi de geçmiyorsa puan toplamı", () => {
    expect(betterGate("prop", { recognizable: 7 }, { recognizable: 6 })).toBe(true);
    expect(betterGate("prop", { recognizable: 6, fidelity: 9 }, { recognizable: 8, fidelity: 6 })).toBe(false);
    expect(betterGate("prop", { recognizable: 5 }, { recognizable: 3 })).toBe(true);
    expect(betterGate("prop", { recognizable: 5 }, undefined)).toBe(true);
  });
});
