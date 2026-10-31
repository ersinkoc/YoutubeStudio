// @vitest-environment happy-dom
import type { AssetCheck } from "@ys/core";
import type { EpisodeState, PlannedShotState } from "@ys/pipeline/light";
import { act as reactAct, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConceptTab, ScriptTab, ShotsTab } from "../../src/app/episodes/[id]/steps.tsx";
import { en, fmtTr, makeData, makeEstimate, makeState, okAct, renderIn, row, tr } from "./fixtures.tsx";

afterEach(cleanup);

const story = { title: "Kahve Yasağı", logline: "Bir sultan kahveyi yasaklar.", premise: "", hook: "Gece baskını", beats: [] };
const script = {
  scenes: [
    { id: "s1", beatId: "b1", narration: "Bir zamanlar İstanbul'da kahve vardı.", visualIntent: "", emotion: "merak", location: "Kahvehane" },
    { id: "s2", beatId: "b2", narration: "Sonra yasak geldi.", visualIntent: "", emotion: "korku", location: "Saray" },
  ],
};

// ---------------- senaryo ----------------

describe("ScriptTab", () => {
  it("senaryo yokken üret düğmesi eylemi gönderir; iş sürerken yazılıyor mesajı", () => {
    const act = okAct();
    const { rerender } = renderIn(<ScriptTab data={makeData(makeState())} busy={false} act={act} />);
    expect(screen.getByText(tr("script.none"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: tr("script.generate") }));
    expect(act).toHaveBeenCalledWith({ type: "generate-script" });
    rerender(<ScriptTab data={makeData(makeState())} busy act={act} />);
    expect(screen.getByText(tr("script.writing"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("onaysız senaryo: istatistik, onay düğmesi maliyetle, anlatım düzenlenince eylem", () => {
    const act = okAct();
    const state = makeState({
      story,
      script,
      voice: { s1: { key: "v1", mimeType: "audio/mpeg", durationMs: 4000, words: [], estimatedTiming: false } },
    });
    renderIn(<ScriptTab data={makeData(state)} busy={false} act={act} />);
    expect(screen.getByText(story.logline)).toBeTruthy();
    expect(screen.getByText(story.hook)).toBeTruthy();
    const words = script.scenes.reduce((n, sc) => n + sc.narration.split(/\s+/).length, 0);
    const chars = script.scenes.reduce((n, sc) => n + sc.narration.length, 0);
    expect(words).toBe(8);
    expect(screen.getByText(tr("script.stats", { scenes: 2, words: fmtTr.number(words), chars: fmtTr.number(chars) }))).toBeTruthy();
    expect(screen.getByText(fmtTr.duration(4))).toBeTruthy();
    // Hareket modu yok, klip oranı 0 → "still" tahmini; senaryodan sonra cast + concept.
    const approve = screen.getByRole("button", { name: new RegExp(tr("script.approve")) });
    expect(approve.textContent).toContain(`~${fmtTr.usd(0.5)} · ~${fmtTr.duration(90)}`);
    fireEvent.click(approve);
    expect(act).toHaveBeenCalledWith({ type: "approve-script" });

    const [first] = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // Değişmeyen metin eylem göndermez.
    fireEvent.blur(first!, { target: { value: `  ${script.scenes[0]!.narration}  ` } });
    expect(act).toHaveBeenCalledTimes(1);
    fireEvent.blur(first!, { target: { value: "Yeni anlatım" } });
    expect(act).toHaveBeenLastCalledWith({ type: "edit-narration", sceneId: "s1", narration: "Yeni anlatım" });
  });

  it("onaylı senaryo kilitli; konsept onayından önce geri alınabilir, otomatik onayda geri alma yok", () => {
    const act = okAct();
    const approvedState = makeState({ script, approvals: { script: "t" } });
    const { rerender } = renderIn(<ScriptTab data={makeData(approvedState)} busy={false} act={act} />);
    expect(screen.queryByRole("button", { name: new RegExp(tr("script.approve")) })).toBeNull();
    expect((screen.getAllByRole("textbox")[0] as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: tr("script.revoke") }));
    expect(act).toHaveBeenCalledWith({ type: "revoke-script" });

    rerender(<ScriptTab data={makeData(makeState({ script, approvals: { script: "t", concept: "t" } }))} busy={false} act={act} />);
    expect(screen.queryByRole("button", { name: tr("script.revoke") })).toBeNull();
    rerender(<ScriptTab data={makeData(makeState({ script, approvals: { script: "t" } }, { autoApprove: true }))} busy={false} act={act} />);
    expect(screen.queryByRole("button", { name: tr("script.revoke") })).toBeNull();
    rerender(<ScriptTab data={makeData(makeState({ script }, { autoApprove: true }))} busy={false} act={act} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// ---------------- konsept ----------------

const cast = {
  characters: [
    { id: "c1", name: "Sultan", kind: "person" as const, role: "hükümdar", visualDescription: "kaftanlı", scenes: ["s1"] },
    { id: "c2", name: "Kahveci", kind: "person" as const, role: "esnaf", visualDescription: "önlüklü", scenes: ["s1"] },
  ],
  locations: [{ id: "l1", name: "Kahvehane", visualDescription: "ahşap", scenes: ["s1"] }],
};
const svg = (key: string) => ({ key, mimeType: "image/svg+xml" });
const png = (key: string) => ({ key, mimeType: "image/png" });
const style = {
  pack: "flat-explainer",
  artStyle: "Düz renkler",
  promptPrefix: "",
  negativeRules: [],
  palette: ["#101010", "#202020", "#303030"],
  lighting: "",
  lensLanguage: "",
};

function conceptState(over: Partial<EpisodeState> = {}, input: Parameters<typeof makeState>[1] = {}) {
  return makeState(
    {
      script,
      approvals: { script: "t" },
      style,
      cast,
      concept: {
        candidates: { c1: [svg("c1-a.svg"), svg("c1-b.svg")], l1: [png("l1-a.png")] },
        selected: { c1: svg("c1-a.svg") },
        previews: [{ ...png("pv1.png"), caption: "Deneme 1" }],
      },
      ...over,
    },
    input,
  );
}

const library = [
  { id: "x1", key: "library/vector/character/x1.svg", name: "Hoca", description: "", artStyle: "", lineStyle: "flat", episodes: ["e1", "e2"] },
  { id: "x2", key: "library/vector/character/x2.svg", name: "Çırak", description: "", artStyle: "", lineStyle: "flat", episodes: [] },
  // Zaten aday olan anahtar listelenmez.
  { id: "c1", key: "c1-a.svg", name: "Aynı", description: "", artStyle: "", lineStyle: "flat", episodes: [] },
];

describe("ConceptTab", () => {
  it("kadro yokken bilgi; kadro var konsept yokken üret düğmesi", () => {
    const act = okAct();
    const { rerender } = renderIn(<ConceptTab data={makeData(makeState())} busy={false} act={act} />);
    expect(screen.getByText(tr("concept.none"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ConceptTab data={makeData(makeState({ cast }))} busy={false} act={act} />);
    fireEvent.click(screen.getByRole("button", { name: tr("concept.generate") }));
    expect(act).toHaveBeenCalledWith({ type: "regenerate-concept" });
    rerender(<ConceptTab data={makeData(makeState({ cast }))} busy act={act} />);
    expect(screen.getByText(tr("concept.preparing"))).toBeTruthy();
  });

  it("adaylar, seçim, kütüphaneden kullanma, ses ve hareket modu eylemleri", () => {
    const act = okAct();
    const state = conceptState();
    const data = makeData(state, { library, quota: { providerId: "elevenlabs", needed: 1000, quota: { unit: "chars", used: 100, limit: 10_000, plan: "creator", resetsAt: "2026-11-15T00:00:00Z" } } });
    const { container } = renderIn(<ConceptTab data={data} busy={false} act={act} />);
    // Stil: paket adı + sanat stili, palet.
    expect(screen.getByText("Düz anlatım (explainer) ·", { exact: false })).toBeTruthy();
    expect(container.querySelectorAll('[title="#202020"]')).toHaveLength(1);
    // Varlıklar: karakterler rol ile, mekân rolsüz.
    expect(screen.getByText("· hükümdar")).toBeTruthy();
    expect(screen.getAllByText(tr("concept.location"))).toHaveLength(1);
    // Aday seçimi
    const candidate = screen.getByAltText(tr("concept.candidate", { name: "Sultan", n: 2 }));
    expect(candidate.className).toContain("object-contain");
    expect(screen.getByAltText(tr("concept.candidate", { name: "Kahvehane", n: 1 })).className).toContain("object-cover");
    fireEvent.click(candidate.closest("button")!);
    expect(act).toHaveBeenLastCalledWith({ type: "select", entityId: "c1", index: 1 });
    // Eksik seçim: c2 ve l1 → 2; deneme kareleri ve onay kapalı.
    expect(screen.getByText(tr("concept.missing", { n: 2 }))).toBeTruthy();
    expect((screen.getByRole("button", { name: tr("concept.preview") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: new RegExp(tr("concept.approve")) }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: tr("concept.regenerate") }));
    expect(act).toHaveBeenLastCalledWith({ type: "regenerate-concept" });
    // Kütüphane: her karakterde iki seçenek (aday olan hariç); c2'nin adayı yok, onda üç.
    const reuse = screen.getAllByTitle(tr("concept.reuseHint")) as HTMLSelectElement[];
    expect(reuse).toHaveLength(2);
    expect(reuse[0]!.options[0]!.textContent).toBe(tr("concept.reuse", { n: 2 }));
    expect(reuse[1]!.options[0]!.textContent).toBe(tr("concept.reuse", { n: 3 }));
    expect(reuse[0]!.options[1]!.textContent).toBe(`Hoca (${tr("concept.reuseUsed", { n: 2 })})`);
    expect(reuse[0]!.options[2]!.textContent).toBe("Çırak");
    fireEvent.change(reuse[0]!, { target: { value: "library/vector/character/x2.svg" } });
    expect(act).toHaveBeenLastCalledWith({ type: "reuse-character", castId: "c1", key: "library/vector/character/x2.svg" });
    const calls = act.mock.calls.length;
    fireEvent.change(reuse[1]!, { target: { value: "" } });
    expect(act.mock.calls.length).toBe(calls);
    // Deneme kareleri
    expect(screen.getByText("Deneme 1")).toBeTruthy();
    // Ses seçimi
    const voice = screen.getByDisplayValue(tr("voice.gemini")) as HTMLSelectElement;
    fireEvent.change(voice, { target: { value: "nPczCjzI2devNBz1zQrb" } });
    expect(act).toHaveBeenLastCalledWith({ type: "change-voice", voiceId: "nPczCjzI2devNBz1zQrb" });
    // Kota yetiyor
    expect(screen.getByText(tr("quota.left", { provider: "elevenlabs", plan: "creator", left: fmtTr.number(9900), limit: fmtTr.number(10_000) }))).toBeTruthy();
    expect(screen.getByText(tr("quota.resets", { date: fmtTr.day("2026-11-15T00:00:00Z") }))).toBeTruthy();
    expect(screen.queryByText(tr("concept.quotaShort"))).toBeNull();
    // Hareket modu
    fireEvent.click(screen.getByText(tr("motion.vector")).closest("button")!);
    expect(act).toHaveBeenLastCalledWith({ type: "set-motion", motionMode: "vector" });
    expect(screen.getByText(tr("motion.still")).closest("button")!.className).toContain("border-accent");
  });

  it("tüm seçimler tamamsa onaylanır; vektör modunda deneme karesi yok; kota yetmezse onay kapalı", () => {
    const act = okAct();
    const selected = { c1: svg("c1-a.svg"), c2: svg("c2.svg"), l1: png("l1-a.png") };
    const estimates = makeData(makeState()).estimates;
    // Bir modun tahmini yoksa o mod listelenmez.
    const { animated: _a, ...partial } = estimates;
    const state = conceptState({ concept: { candidates: {}, selected } }, { motionMode: "vector" });
    const { rerender } = renderIn(
      <ConceptTab data={makeData(state, { estimates: partial as typeof estimates })} busy={false} act={act} />,
    );
    expect(screen.queryByRole("button", { name: tr("concept.preview") })).toBeNull();
    expect(screen.queryByText(tr("motion.animated"))).toBeNull();
    expect(screen.queryByText(tr("concept.missing", { n: 0 }))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tr("concept.approve")) }));
    expect(act).toHaveBeenLastCalledWith({ type: "approve-concept" });

    const short = { providerId: "elevenlabs", needed: 5000, quota: { unit: "chars" as const, used: 9000, limit: 10_000 } };
    const still = conceptState({ concept: { candidates: {}, selected } });
    rerender(<ConceptTab data={makeData(still, { quota: short })} busy={false} act={act} />);
    expect(screen.getByText(tr("concept.quotaShort"))).toBeTruthy();
    expect(screen.getByText(tr("quota.notEnough"), { exact: false }).className).toContain("text-bad");
    expect(screen.getByText(/elevenlabs/).textContent).toContain("(plan)");
    expect((screen.getByRole("button", { name: new RegExp(tr("concept.approve")) }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: tr("concept.preview") }));
    expect(act).toHaveBeenLastCalledWith({ type: "preview" });
  });

  it("onaylı konsept kilitli: seçim/kütüphane/onay yok; ses bittiyse ses seçimi kapalı; paketsiz stil (İngilizce)", () => {
    const act = okAct();
    const state = conceptState(
      { approvals: { script: "t", concept: "t" }, done: { voice: "t" }, style: { ...style, pack: undefined }, concept: { candidates: { c1: [svg("c1-a.svg"), svg("c1-b.svg")] }, selected: { c1: svg("c1-a.svg") } } },
      { voiceId: "JBFqnCBsd6RMkjVDRZzb" },
    );
    renderIn(<ConceptTab data={makeData(state, { library })} busy={false} act={act} />, "en");
    expect(screen.getByText(style.artStyle).textContent).toBe(style.artStyle);
    expect(screen.queryByTitle(en("concept.reuseHint"))).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(en("concept.approve")) })).toBeNull();
    expect(screen.queryByRole("button", { name: en("concept.regenerate") })).toBeNull();
    const [, second] = screen.getAllByAltText(/Sultan/);
    expect((second!.closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(second!.closest("button")!.className).toContain("opacity-50");
    expect((screen.getByDisplayValue(en("voice.george")) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(en("motion.animated")).closest("button")!.className).toContain("opacity-50");
  });

  it("stil yoksa stil kutusu, önizleme yoksa önizleme bölümü çizilmez", () => {
    renderIn(<ConceptTab data={makeData(conceptState({ style: undefined, concept: { candidates: {}, selected: {}, previews: [] } }))} busy={false} act={okAct()} />);
    expect(screen.queryByText(tr("concept.style"))).toBeNull();
    expect(screen.queryByText(tr("concept.previews"))).toBeNull();
  });
});

// ---------------- kalite kapısı ----------------

const check = (over: Partial<AssetCheck> & Pick<AssetCheck, "name">): AssetCheck => ({
  kind: "character",
  guess: "",
  recognizable: 8,
  passed: true,
  defects: [],
  attempts: 1,
  sources: [],
  refs: [],
  ...over,
});

describe("QualityGate (ConceptTab içinde)", () => {
  it("reddedilenler önce; puanlar, referanslar, plan, kaynaklar ve insan kararı", async () => {
    const act = okAct();
    const assetChecks: Record<string, AssetCheck> = {
      "a/ok.svg": check({ name: "Sultan", fidelity: 8, guess: "taçlı adam", query: "Suleiman portrait", refs: ["r1.jpg", "r2.jpg"], sources: [{ title: "Portre", url: "https://commons.example/1", license: "CC0" }, { title: "Minyatür", url: "https://commons.example/2" }], plan: { subject: "Sultan", moved: [], pose: "", silhouette: "", parts: [], cues: ["sarık"], avoid: [] } }),
      "a/bad.svg": check({ name: "Fincan", kind: "prop", recognizable: 3, fidelity: 4, passed: false, attempts: 3, defects: ["kulp yok", "renk yanlış"], rejectedKey: "a/bad-best.svg", plan: { subject: "Fincan", moved: ["tepsi"], pose: "", silhouette: "", parts: [], cues: [], avoid: [] } }),
      "a/human.svg": check({ name: "Kapı", kind: "background", passed: false, recognizable: 4, override: { decision: "accepted", note: "yeterli", at: "t" } }),
      "a/no.svg": check({ name: "Masa", kind: "prop", override: { decision: "rejected", at: "t" } }),
      "a/more.svg": check({ name: "Halı", kind: "prop" }),
    };
    const state = conceptState({ assetChecks, concept: { candidates: {}, selected: {} } });
    renderIn(<ConceptTab data={makeData(state)} busy={false} act={act} />);
    expect(screen.getByText(tr("gate.summary", { passed: 3, rejected: 2 })).className).toContain("text-bad");
    // En az 4 kart görünür; beşincisi düğmeyle.
    expect(screen.queryByText("Halı")).toBeNull();
    fireEvent.click(screen.getByText(tr("gate.showAll", { n: 5 })));
    expect(screen.getByText("Halı", { exact: false })).toBeTruthy();
    expect(screen.queryByText(tr("gate.showAll", { n: 5 }))).toBeNull();

    // Reddedilen çizim en iyi denemeyle gösterilir; düşük puanlar kırmızı.
    expect(screen.getByAltText("Fincan").getAttribute("src")).toBe("/api/assets/a/bad-best.svg");
    expect(screen.getByText(tr("gate.recognizable", { score: 3 })).className).toContain("text-bad");
    expect(screen.getByText(tr("gate.fidelity", { score: 8 })).className).toContain("text-ok");
    expect(screen.getByText(tr("gate.guess", { guess: "taçlı adam" }))).toBeTruthy();
    expect(screen.getByText("renk yanlış")).toBeTruthy();
    expect(screen.getByText(tr("gate.planCues", { items: "sarık" }))).toBeTruthy();
    expect(screen.getByText(tr("gate.planMoved", { items: "tepsi" }))).toBeTruthy();
    // Referans görselleri ve kaynaklar; ikinci kaynağın lisansı yok.
    expect(screen.getByAltText("Portre").getAttribute("src")).toBe("/api/assets/r1.jpg");
    expect(screen.getByText(/\("Suleiman portrait"\)/)).toBeTruthy();
    expect(screen.getByText("Minyatür").getAttribute("href")).toBe("https://commons.example/2");
    // İnsan kararları
    expect(screen.getByText(tr("gate.humanAccepted"))).toBeTruthy();
    expect(screen.getByText(tr("gate.humanRejected"))).toBeTruthy();
    expect(screen.getByText(tr("gate.note", { note: "yeterli" }))).toBeTruthy();
    expect(screen.getByText(`· ${tr("gate.kind.background")}`)).toBeTruthy();

    // Reddedileni kabul et
    const accept = screen.getAllByRole("button", { name: tr("gate.accept") });
    expect(accept).toHaveLength(2);
    fireEvent.click(accept[0]!);
    expect(act).toHaveBeenLastCalledWith({ type: "accept-asset", key: "a/bad.svg" });
    // Gerçeklik anahtarı
    fireEvent.click(screen.getByRole("checkbox"));
    expect(act).toHaveBeenLastCalledWith({ type: "set-realism", enabled: false });

    // Geçeni notla reddet: sunucu reddederse form açık kalır, kabul ederse kapanır.
    act.mockResolvedValueOnce(false);
    fireEvent.click(screen.getAllByRole("button", { name: tr("gate.rejectPassed") })[0]!);
    const note = screen.getByPlaceholderText(tr("gate.notePlaceholder"));
    fireEvent.change(note, { target: { value: "sarık daha büyük" } });
    await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: tr("gate.rejectConfirm") })));
    expect(act).toHaveBeenLastCalledWith({ type: "reject-asset", key: "a/ok.svg", note: "sarık daha büyük" });
    expect(screen.getByPlaceholderText(tr("gate.notePlaceholder"))).toBeTruthy();
    await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: tr("gate.rejectConfirm") })));
    expect(screen.queryByPlaceholderText(tr("gate.notePlaceholder"))).toBeNull();
    // Vazgeç
    fireEvent.click(screen.getAllByRole("button", { name: tr("gate.redrawWithNote") })[0]!);
    fireEvent.click(screen.getByRole("button", { name: tr("gate.cancel") }));
    expect(screen.queryByPlaceholderText(tr("gate.notePlaceholder"))).toBeNull();
  });

  it("hepsi geçtiyse yeşil özet; gerçeklik kapalıysa uyarı ve anahtar açılınca eylem", () => {
    const act = okAct();
    const state = conceptState({ assetChecks: { k: check({ name: "Tek", refs: ["r.jpg"] }) }, concept: { candidates: {}, selected: {} } }, { realism: false });
    renderIn(<ConceptTab data={makeData(state)} busy act={act} />);
    expect(screen.getByText(tr("gate.summary", { passed: 1, rejected: 0 })).className).toContain("text-ok");
    expect(screen.getByText(tr("gate.realismOff"))).toBeTruthy();
    expect(screen.getByText(tr("gate.passed"))).toBeTruthy();
    // Kaynağı olmayan referans görselin adı boş.
    expect(screen.getByAltText("").getAttribute("src")).toBe("/api/assets/r.jpg");
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(screen.queryByText(tr("gate.showAll", { n: 1 }))).toBeNull();
  });

  it("reddedilen sayısı 4'ü aşarsa hepsi gösterilir", () => {
    const assetChecks = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`k${i}`, check({ name: `Nesne ${i}`, passed: i === 5 ? true : false, recognizable: 1 })]),
    );
    renderIn(<ConceptTab data={makeData(conceptState({ assetChecks }))} busy={false} act={okAct()} />);
    expect(screen.getAllByText(tr("gate.rejected"))).toHaveLength(5);
    expect(screen.getByText(tr("gate.showAll", { n: 6 }))).toBeTruthy();
  });
});

// ---------------- çekimler ----------------

const shot = (id: string, sceneId: string, over: Partial<PlannedShotState> = {}): PlannedShotState => ({
  id,
  sceneId,
  kind: "still_motion",
  startMs: 0,
  endMs: 2500,
  description: `${id} tarifi`,
  imagePrompt: "",
  motionPrompt: "",
  camera: "push_in",
  ...over,
});

function shotsState(over: Partial<EpisodeState> = {}, input: Parameters<typeof makeState>[1] = {}) {
  return makeState(
    {
      script,
      shots: [
        shot("sh1", "s1", { ambience: "rain" }),
        shot("sh2", "s1", { ambience: "none", startMs: 2500, endMs: 6000 }),
        shot("sh3", "s2"),
        shot("sh4", "s9"),
      ],
      keyframes: { sh1: png("kf1.png"), sh2: png("kf2.png"), sh3: png("kf3.png") },
      qa: {
        sh1: { score: 4, issues: [{ type: "text", detail: "yazı" }], attempts: 2, passed: false },
        sh2: { score: 9, issues: [], attempts: 1, passed: true },
        sh3: { score: 0, issues: [], attempts: 1, passed: true, skipped: "ajan hatası" },
      },
      review: {
        at: "t",
        shots: { sh3: { score: 5, issues: [] }, sh4: { score: 8, issues: [{ type: "hands", detail: "el" }] }, sh1: { score: 7, issues: [] } },
        lessons: [],
      },
      clips: { sh2: { ...png("c2.mp4"), durationSec: 5 } },
      draftReview: { at: "t", shots: {}, lessons: [], avg: 6.25, revisedScenes: ["s1", "s2"] },
      ...over,
    },
    input,
  );
}

describe("ShotsTab", () => {
  it("çekim yoksa boş mesajı", () => {
    renderIn(<ShotsTab data={makeData(makeState())} busy={false} act={okAct()} />);
    expect(screen.getByText(tr("shots.empty"))).toBeTruthy();
  });

  it("kartlar: puan rozeti, klip, sorunlular süzgeci, taslak denetimi", () => {
    const { container } = renderIn(<ShotsTab data={makeData(shotsState())} busy={false} act={okAct()} />);
    expect(screen.getByText(tr("shots.count", { n: 4 }))).toBeTruthy();
    expect(screen.getByText(tr("prod.draft", { avg: "6.3", n: 2 }))).toBeTruthy();
    // sh1: kare denetimi geçmedi; sh2: geçti; sh3: denetim atlandı → inceleme puanı (5 → zayıf); sh4: inceleme sorunu.
    expect(screen.getByText("4/10 · 1!").className).toContain("text-bad");
    expect(screen.getByText("9/10").className).toContain("text-ok");
    expect(screen.getByText("5/10").className).toContain("text-bad");
    expect(screen.getByText("8/10 · 1!").className).toContain("text-bad");
    expect(screen.getByText(`▶ 5 ${tr("unit.sec")}`)).toBeTruthy();
    expect(screen.getByText(`3.5 ${tr("unit.sec")}`)).toBeTruthy();
    // Karesi olmayan çekim kimliğiyle gösterilir.
    expect(container.querySelectorAll("img")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: tr("shots.weakOnly") }));
    expect(screen.queryByText("9/10")).toBeNull();
    expect(screen.getByText("4/10 · 1!")).toBeTruthy();
  });

  it("geçmeyenleri seç, temizle ve yeniden çizdir (sunucu reddederse seçim kalır)", async () => {
    const act = okAct();
    renderIn(<ShotsTab data={makeData(shotsState())} busy={false} act={act} />);
    fireEvent.click(screen.getByRole("button", { name: `${tr("prod.pickFailed")} (1)` }));
    // Kare başına maliyet: 1$ / 10 kare.
    const redraw = screen.getByRole("button", { name: tr("prod.redraw", { n: 1, usd: fmtTr.usd(0.1) }) });
    act.mockResolvedValueOnce(false);
    await reactAct(async () => fireEvent.click(redraw));
    expect(act).toHaveBeenLastCalledWith({ type: "redraw", shotIds: ["sh1"] });
    expect(screen.getByRole("button", { name: tr("prod.clear") })).toBeTruthy();
    // Kartın seçim kutusuyla ikinciyi ekle, sonra çıkar, sonra yeniden ekle.
    fireEvent.click(screen.getByRole("button", { name: "sh2" }));
    fireEvent.click(screen.getByRole("button", { name: "sh2" }));
    fireEvent.click(screen.getByRole("button", { name: "sh2" }));
    await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: tr("prod.redraw", { n: 2, usd: fmtTr.usd(0.2) }) })));
    expect(act).toHaveBeenLastCalledWith({ type: "redraw", shotIds: ["sh1", "sh2"] });
    expect(screen.queryByRole("button", { name: tr("prod.clear") })).toBeNull();
    // Temizle
    fireEvent.click(screen.getByRole("button", { name: "sh3" }));
    fireEvent.click(screen.getByRole("button", { name: tr("prod.clear") }));
    expect(screen.queryByRole("button", { name: tr("prod.clear") })).toBeNull();
    // Karesi olmayan çekimde seçim kutusu yok.
    expect(screen.queryByRole("button", { name: "sh4" })).toBeNull();
  });

  it("iş sürerken ve vektör modunda seçim yok; kare tahmini yoksa maliyet sıfır", () => {
    const state = shotsState({}, { motionMode: "vector" });
    const { rerender } = renderIn(<ShotsTab data={makeData(state)} busy={false} act={okAct()} />);
    expect(screen.queryByRole("button", { name: "sh1" })).toBeNull();
    expect(screen.queryByText(tr("prod.pickFailed"), { exact: false })).toBeNull();
    const noKf = makeData(shotsState({ qa: {} }), {});
    noKf.estimates.still = makeEstimate("still", { rows: [row({ stage: "keyframes", quantity: 0, costUsd: 3 })] });
    rerender(<ShotsTab data={noKf} busy={false} act={okAct()} />);
    expect(screen.queryByText(tr("prod.pickFailed"), { exact: false })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "sh1" }));
    expect(screen.getByRole("button", { name: tr("prod.redraw", { n: 1, usd: fmtTr.usd(0) }) })).toBeTruthy();
    rerender(<ShotsTab data={makeData(shotsState({ draftReview: undefined }))} busy act={okAct()} />);
    expect(screen.queryByRole("button", { name: "sh1" })).toBeNull();
    expect((screen.getByRole("button", { name: `${tr("prod.pickFailed")} (1)` }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("çekim ayrıntısı: açılır, oklarla gezilir, Esc ve arka planla kapanır", () => {
    const { container } = renderIn(<ShotsTab data={makeData(shotsState())} busy={false} act={okAct()} />);
    const open = (id: string) =>
      fireEvent.click((container.querySelector(`img[alt="${id}"]`) ?? screen.getAllByText(id, { exact: false })[0]!).closest("button")!);
    fireEvent.click(container.querySelector('img[alt="sh1"]')!.closest("button")!);
    let dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("#1");
    expect(dialog.textContent).toContain(" / 4 · ");
    expect(dialog.textContent).toContain("Kahvehane");
    expect(screen.getByText(`· ${tr("prod.effect", { name: "rain" })}`)).toBeTruthy();
    expect(dialog.textContent).toContain(`${tr("prod.qa", { score: 4, n: 2 })} · ${tr("prod.review", { score: 7 })}`);
    expect(dialog.textContent).toContain("yazı");
    // İç tıklama kapatmaz.
    fireEvent.click(screen.getByText("sh1 tarifi"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Sonraki (düğme ve ok tuşu), önceki; sondan başa sarar.
    fireEvent.click(screen.getByRole("button", { name: "→" }));
    dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(tr("prod.qa", { score: 9, n: 1 }));
    expect(dialog.textContent).not.toContain(tr("prod.effect", { name: "none" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // sh3: denetim atlandı, yalnız inceleme puanı; ambiyans yok.
    expect(screen.getByRole("dialog").textContent).toContain(tr("prod.review", { score: 5 }));
    expect(screen.getByRole("dialog").textContent).not.toContain(tr("prod.qa", { score: 0, n: 1 }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // sh4: karesi ve sahnesi yok.
    dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.textContent).toContain("s9");
    expect(dialog.textContent).not.toContain(" · Saray");
    fireEvent.click(screen.getByRole("button", { name: "→" }));
    expect(screen.getByRole("dialog").textContent).toContain("#1");
    fireEvent.click(screen.getByRole("button", { name: "←" }));
    expect(screen.getByRole("dialog").textContent).toContain("#4");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog").textContent).toContain("#3");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("dialog").textContent).toContain("#3");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Kart yeniden tıklanınca açılır, aynı karta tekrar tıklanınca kapanır.
    open("sh4");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getAllByText("sh4", { exact: false })[0]!.closest("button")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    open("sh2");
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
    open("sh2");
    fireEvent.click(screen.getByRole("button", { name: tr("shots.close") }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("vektör modunda küçük resim inceleme karesinden; puanı olmayan kartta rozet yok (İngilizce)", () => {
    const state = makeState({ shots: [shot("v1", "s1")], stills: { v1: png("st/v1.png") } }, { motionMode: "vector" });
    const { container } = renderIn(<ShotsTab data={makeData(state)} busy={false} act={okAct()} />, "en");
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/api/assets/st/v1.png");
    expect(screen.queryByText(/\/10/)).toBeNull();
    fireEvent.click(container.querySelector("img")!.closest("button")!);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toContain(en("shots.score"));
    expect(dialog.textContent).not.toContain(en("shots.issues"));
  });
});
