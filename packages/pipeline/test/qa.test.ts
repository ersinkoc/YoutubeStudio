import { describe, expect, it } from "vitest";
import { frameRank, judgeFrame, redrawPrompt } from "../src/qa.ts";

describe("kare denetimi", () => {
  it("puan eşiğin altındaysa ya da engelleyici sorun varsa kareyi reddeder", () => {
    expect(judgeFrame({ score: 9, issues: [], fix: "" }, 1).passed).toBe(true);
    expect(judgeFrame({ score: 6, issues: [], fix: "" }, 1).passed).toBe(false);
    // Yüksek puan, yazıyı affettirmez.
    expect(judgeFrame({ score: 9, issues: [{ type: "text", detail: "shop sign" }], fix: "no signs" }, 1)).toMatchObject({
      passed: false,
      fix: "no signs",
    });
    // Küçük anatomi kusuru tek başına yeniden çizdirmez.
    expect(judgeFrame({ score: 8, issues: [{ type: "anatomy", detail: "six fingers" }], fix: "" }, 1).passed).toBe(true);
  });

  it("geçen kare, puanı daha düşük olsa da geçmeyenin önüne geçer", () => {
    const failed = judgeFrame({ score: 9, issues: [{ type: "duplicate_character", detail: "Ali twice" }], fix: "" }, 1);
    const passed = judgeFrame({ score: 7, issues: [], fix: "" }, 2);
    expect(frameRank(passed)).toBeGreaterThan(frameRank(failed));
    expect(frameRank(undefined)).toBeLessThan(frameRank(failed));
  });

  it("yeniden çizim prompt'una öneri ve sorunları ekler", () => {
    const qa = judgeFrame({ score: 4, issues: [{ type: "text", detail: "readable sign above door" }], fix: "no lettering anywhere" }, 1);
    expect(redrawPrompt("A night alley", qa)).toBe("A night alley. no lettering anywhere. Avoid: readable sign above door");
  });
});
