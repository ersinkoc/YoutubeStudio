import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsAssetStore } from "@ys/storage";
import {
  approve,
  editNarration,
  EpisodeRepo,
  changeVoice,
  gateBefore,
  isApproved,
  missingSelections,
  revokeApproval,
  selectCandidate,
  type EpisodeInput,
  type EpisodeState,
} from "../src/light.ts";

const input: EpisodeInput = {
  topic: "t",
  lang: "tr",
  targetSec: 180,
  tier: "standard",
  aiClipRatio: 0.1,
  budgetUsd: 10,
  width: 1920,
  height: 1080,
  fps: 30,
};

const baseState = (): EpisodeState => ({
  id: "ep",
  createdAt: "2026-10-29T00:00:00Z",
  input: { ...input },
  done: { style: "x", story: "x", script: "x", cast: "x", concept: "x" },
  agentCostUsd: 0,
  script: { scenes: [{ id: "s1", beatId: "b1", narration: "eski", visualIntent: "", emotion: "", location: "" }] },
  cast: {
    characters: [{ id: "c1", name: "Murad", role: "", visualDescription: "", scenes: ["s1"] }],
    locations: [{ id: "l1", name: "Sokak", visualDescription: "", scenes: ["s1"] }],
  },
  concept: {
    candidates: {
      c1: [
        { key: "a", mimeType: "image/png" },
        { key: "b", mimeType: "image/png" },
      ],
      l1: [{ key: "c", mimeType: "image/png" }],
    },
    selected: {},
    previews: [{ key: "p", mimeType: "image/png", caption: "" }],
  },
});

describe("onay kapıları", () => {
  it("cast senaryo onayını, voice konsept onayını bekler", () => {
    expect(gateBefore("cast")).toBe("script");
    expect(gateBefore("voice")).toBe("concept");
    expect(gateBefore("keyframes")).toBeUndefined();
  });

  it("autoApprove tüm kapıları geçer (CLI)", () => {
    const s = baseState();
    expect(isApproved(s, "script")).toBe(false);
    s.input.autoApprove = true;
    expect(isApproved(s, "concept")).toBe(true);
  });

  it("konsept, her karakter ve mekân için seçim yapılmadan onaylanamaz", () => {
    const s = baseState();
    expect(() => approve(s, "concept")).toThrow(/c1, l1/);
    selectCandidate(s, "c1", 1);
    expect(missingSelections(s)).toEqual(["l1"]);
    selectCandidate(s, "l1", 0);
    s.waitingFor = "concept";
    approve(s, "concept");
    expect(s.approvals?.concept).toBeDefined();
    expect(s.waitingFor).toBeUndefined();
  });

  it("seçim değişince eski deneme kareleri silinir", () => {
    const s = baseState();
    selectCandidate(s, "c1", 1);
    expect(s.concept?.selected.c1?.key).toBe("b");
    expect(s.concept?.previews).toBeUndefined();
    expect(() => selectCandidate(s, "c1", 5)).toThrow();
  });

  it("onaylanmış senaryo düzenlenemez; onay geri alınınca sonraki aşamalar yeniden çalışır", () => {
    const s = baseState();
    editNarration(s, "s1", "  yeni metin ");
    expect(s.script?.scenes[0]?.narration).toBe("yeni metin");
    approve(s, "script");
    expect(() => editNarration(s, "s1", "x")).toThrow(/onay/);
    revokeApproval(s, "script");
    expect(s.done).toEqual({ style: "x", story: "x", script: "x" });
  });
});

describe("changeVoice", () => {
  it("sesi ve zamanlamaya bağlı tüm aşamaları sıfırlar; render sonrası izin vermez", () => {
    const s = baseState();
    s.done = { ...s.done, voice: "x", shots: "x", keyframes: "x" };
    s.voice = { s1: { key: "v", mimeType: "audio/mpeg", durationMs: 1000, words: [], estimatedTiming: false } };
    s.voiceProviderId = "elevenlabs:tts";
    s.lastError = { stage: "voice", message: "kota", at: "" };
    changeVoice(s, "");
    expect(s.input.voiceId).toBeUndefined();
    expect(s.voice).toBeUndefined();
    expect(s.voiceProviderId).toBeUndefined();
    expect(s.lastError).toBeUndefined();
    expect(Object.keys(s.done)).toEqual(["style", "story", "script", "cast", "concept"]);
    s.done.render = "x";
    expect(() => changeVoice(s, "v2")).toThrow(/render/);
  });
});
describe("EpisodeRepo", () => {
  it("bölümleri yeniden eskiye listeler", async () => {
    const repo = new EpisodeRepo(new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-repo-"))));
    await repo.save({ ...baseState(), id: "eski", createdAt: "2026-01-01T00:00:00Z" });
    await repo.save({ ...baseState(), id: "yeni", createdAt: "2026-10-01T00:00:00Z" });
    expect((await repo.list()).map((s) => s.id)).toEqual(["yeni", "eski"]);
    const updated = await repo.update("eski", (s) => selectCandidate(s, "c1", 0));
    expect(updated.concept?.selected.c1?.key).toBe("a");
  });
});
