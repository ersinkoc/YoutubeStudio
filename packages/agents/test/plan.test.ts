import { describe, expect, it } from "vitest";
import { AssetPlan } from "@ys/core";
import { gateDescription, planBlock } from "../src/index.ts";

const plan = AssetPlan.parse({
  subject: "a young 1860s rider standing, mail pouch strap across the chest",
  moved: ["the horse: separate prop"],
  pose: "front view, rest pose",
  parts: [
    { name: "leg", count: 2, shape: "slim tubes", colour: "#5a4632", where: "below the hips" },
    { name: "hat", count: null, shape: "flat-brimmed", colour: "#3b2f25", where: "on the head" },
  ],
  cues: ["mail pouch strap", "flat-brimmed hat"],
  avoid: ["rider on the ground beside a horse"],
});

describe("çizim planı", () => {
  it("tasarımcıya parça sayısı, ipuçları ve çizilmeyecekler gider", () => {
    const text = planBlock(plan);
    expect(text).toContain("Subject: a young 1860s rider");
    expect(text).toContain("- leg ×2: slim tubes, #5a4632, below the hips");
    expect(text).toContain("- hat: flat-brimmed");
    expect(text).toContain("Must be clearly visible: mail pouch strap; flat-brimmed hat");
    expect(text).toContain("NOT part of this asset (do not draw): the horse: separate prop");
    expect(text).not.toContain("Silhouette:");
  });

  it("kapı planın öznesine bakar, ayrılanların yokluğunu cezalandırmaz; plan yoksa tarif aynen gider", () => {
    expect(gateDescription("rider galloping on a horse", plan)).toBe(
      "a young 1860s rider standing, mail pouch strap across the chest\nMust show: mail pouch strap; flat-brimmed hat\nDeliberately NOT in this asset (do not penalise their absence): the horse: separate prop",
    );
    expect(gateDescription("rider galloping on a horse")).toBe("rider galloping on a horse");
  });
});
