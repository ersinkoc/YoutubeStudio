import { describe, expect, it } from "vitest";
import { cleanModelSettings, modelFor } from "../src/models.ts";

describe("ajan model seçimi", () => {
  it("bilinmeyen ajan ve model atılır", () => {
    expect(cleanModelSettings({ "asset-gate": "claude-sonnet-5-5", "no-such-agent": "claude-opus-5-5", screenwriter: "gpt-x" })).toEqual({
      "asset-gate": "claude-sonnet-5-5",
    });
    expect(cleanModelSettings("bozuk")).toEqual({});
  });

  it("önce tam ad, sonra ön ek, yoksa ajanın varsayılanı", () => {
    const s = cleanModelSettings({ "vector-designer:prop": "claude-opus-5-5", "asset-planner": "claude-haiku-5-5" });
    expect(modelFor("vector-designer:prop", "claude-sonnet-5-5", s)).toBe("claude-opus-5-5");
    expect(modelFor("asset-planner:character", "claude-sonnet-5-5", s)).toBe("claude-haiku-5-5");
    expect(modelFor("vector-designer:background", "claude-sonnet-5-5", s)).toBe("claude-sonnet-5-5");
    expect(modelFor("asset-gate", "claude-haiku-5-5", undefined)).toBe("claude-haiku-5-5");
  });
});
