import { describe, expect, it } from "vitest";
import { applyLineStyle, resolveLayout, VectorShot, type VectorAsset } from "@ys/core";
import { editNarration, mapLimit, newEpisodeState, type EpisodeInput } from "../src/index.ts";

const input: EpisodeInput = { topic: "t", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 3, width: 1920, height: 1080, fps: 30 };

describe("30 Eki inceleme düzeltmeleri", () => {
  it("mapLimit ilk hatadan sonra yeni iş almaz ve süren işleri bekleyip hatayı fırlatır", async () => {
    const started: number[] = [];
    let finished = 0;
    await expect(
      mapLimit([0, 1, 2, 3, 4, 5], 2, async (i) => {
        started.push(i);
        if (i === 0) throw new Error("boom");
        await new Promise((r) => setTimeout(r, 10));
        finished++;
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
    expect(finished).toBe(1);
  });

  it("anlatım düzenlenince o sahnenin eski sesi silinir", () => {
    const state = newEpisodeState(input);
    state.script = { scenes: [{ id: "s1", beatId: "b1", narration: "eski", visualIntent: "", emotion: "calm", location: "x" }] } as never;
    state.voice = { s1: { key: "k", mimeType: "audio/mpeg", durationMs: 1, words: [], estimatedTiming: true, text: "eski" } };
    editNarration(state, "s1", "yeni");
    expect(state.voice.s1).toBeUndefined();
  });

  it("düz çizgi stili grup konturunu siler ama fill=none çizgilere taşır (ağız/kaş görünür kalır)", () => {
    const svg =
      '<svg viewBox="0 0 1 1"><g id="head" fill="#f2e8d0" stroke="#000" stroke-width="5"><circle r="1"/><g id="mouth"><path fill="none" d="M0 0"/></g></g><rect fill="#fff" stroke="#111111"/></svg>';
    const out = applyLineStyle(svg, "flat");
    expect(out).toContain('<g id="head" fill="#f2e8d0">');
    expect(out).toContain('<circle r="1"/>');
    expect(out).toContain('<path fill="none" d="M0 0" stroke="#000" stroke-width="5"/>');
    expect(out).toContain('<rect fill="#fff"/>');
  });

  it("aynı noktadaki üç karakter birbirinden ayrılır", () => {
    const ch = (id: string): VectorAsset => ({ id, kind: "character", svg: "<svg/>", width: 400, height: 800, meta: { realHeight: 1.7 } });
    const assets = { room: { id: "room", kind: "background", svg: "<svg/>", width: 1920, height: 1080, meta: { floorY: 700 } } as VectorAsset, a: ch("a"), b: ch("b"), c: ch("c") };
    const placed = resolveLayout(
      VectorShot.parse({ background: "room", layers: ["a", "b", "c"].map((asset) => ({ asset, x: 960, depth: 0.2 })) }),
      assets,
    ).sort((p, q) => p.x - q.x);
    for (let k = 1; k < placed.length; k++) {
      expect(placed[k]!.x - placed[k - 1]!.x).toBeGreaterThanOrEqual((placed[k]!.width + placed[k - 1]!.width) * 0.32 - 1);
    }
  });
});
