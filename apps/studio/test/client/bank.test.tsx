// @vitest-environment happy-dom
import type { LibraryCharacter } from "@ys/pipeline/light";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { CharacterBank, type BankJob } from "../../src/app/characters/character-bank.tsx";
import { NewEpisodeForm } from "../../src/app/new-episode-form.tsx";
import { json, makeEstimates, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const char = (id: string, name: string, over: Partial<LibraryCharacter> = {}): LibraryCharacter => ({
  id: id.padEnd(32, "0"),
  key: `library/vector/character/${id.padEnd(32, "0")}.svg`,
  name,
  description: `${name} look`,
  pack: "flat-explainer",
  artStyle: "a",
  lineStyle: "outline",
  episodes: [],
  mascotOf: [],
  ...over,
});
const ADA = char("ada", "Ada", { role: "sunucu", bank: true, episodes: ["e1", "e2"] });
const CAN = char("can", "Can");
const INK = char("ink", "Mürekkep", { lineStyle: "ink" });

// ---------------- yeni bölüm formu: banka seçimi ----------------

describe("yeni bölüm formu: karakter bankası", () => {
  function api() {
    const creates: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/estimate") return json(makeEstimates());
        creates.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({ id: "yeni" });
      }),
    );
    return creates;
  }
  // Mod, tahmin zamanlayıcısıyla (400 ms) forma yansır.
  const mode = async (m: string) => {
    fireEvent.click(document.getElementById(`motionMode-${m}`)!);
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
  };
  const submit = () => act(async () => void fireEvent.submit(document.querySelector("form")!));

  it("yalnız vektör modunda görünür; sunucu ve kadro seçimi gönderilir, stil notu çıkar", async () => {
    vi.useFakeTimers();
    const creates = api();
    renderIn(<NewEpisodeForm bank={[ADA, CAN, INK]} />);
    expect(document.getElementById("presenter")).toBeNull();
    await mode("vector");
    fireEvent.change(document.getElementById("topic")!, { target: { value: "Konu" } });
    fireEvent.change(document.getElementById("presenter")!, { target: { value: ADA.id } });
    // Sunucu kadro listesinde yok.
    expect(screen.queryByRole("checkbox", { name: "Ada" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Can" }));
    expect(screen.getByText(tr("form.bank.style", { pack: "Düz anlatım (explainer)", line: tr("line.outline") }))).toBeTruthy();
    await submit();
    expect(creates[0]).toMatchObject({ presenter: ADA.id, bankCast: [CAN.id] });
  });

  it("farklı stiller seçilince uyarı; seçim kaldırılınca gönderilmez; vektör değilse gönderilmez", async () => {
    vi.useFakeTimers();
    const creates = api();
    renderIn(<NewEpisodeForm bank={[ADA, CAN, INK]} />);
    await mode("vector");
    fireEvent.change(document.getElementById("topic")!, { target: { value: "Konu" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Can" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mürekkep" }));
    expect(screen.getByText(tr("form.bank.mixed"))).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mürekkep" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Can" }));
    await submit();
    expect(creates[0]).not.toHaveProperty("presenter");
    expect(creates[0]).not.toHaveProperty("bankCast");
    fireEvent.click(screen.getByRole("checkbox", { name: "Can" }));
    await mode("animated");
    await submit();
    expect(creates[1]).not.toHaveProperty("bankCast");
  });

  it("banka boşsa bölüm görünmez", async () => {
    vi.useFakeTimers();
    api();
    renderIn(<NewEpisodeForm />);
    await mode("vector");
    expect(document.getElementById("presenter")).toBeNull();
  });
});

// ---------------- banka sayfası ----------------

describe("CharacterBank", () => {
  type Call = { url: string; body?: Record<string, unknown> };
  function bankApi(state: { characters: LibraryCharacter[]; job: BankJob | null }, fail?: (url: string) => string | undefined) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
        calls.push({ url, body });
        const error = fail?.(url);
        if (error) return new Response(error, { status: 400 });
        if (url === "/api/characters" && !init) return json(state);
        return json({ ok: true });
      }),
    );
    return calls;
  }

  it("kartlar: resim, rol, paket, bölüm sayısı, banka işareti; özel stilde maskot denetimi yok; stile göre süzülür", () => {
    bankApi({ characters: [], job: null });
    const custom = char("cus", "Özel", { pack: undefined });
    renderIn(<CharacterBank initial={[ADA, INK, custom]} series={["Bilim"]} initialJob={null} />);
    expect(screen.getByAltText("Ada").getAttribute("src")).toBe(`/api/assets/${ADA.key}`);
    expect(screen.getByText("sunucu")).toBeTruthy();
    expect(screen.getByText(tr("bank.episodes", { n: 2 }))).toBeTruthy();
    expect(screen.getAllByText(tr("bank.badge.bank"))).toHaveLength(1);
    expect(screen.getByText(tr("bank.custom"), { exact: false })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: tr("bank.mascot.add") })).toHaveLength(2);
    const filter = screen.getAllByLabelText(tr("bank.add.pack"))[1]!;
    fireEvent.change(filter, { target: { value: "flat-explainer" } });
    expect(screen.queryByAltText("Özel")).toBeNull();
    fireEvent.change(filter, { target: { value: "" } });
    expect(screen.getByAltText("Özel")).toBeTruthy();
  });

  it("yeni karakter isteği gönderilir; iş sürerken düğme kilitli ve durum sorulur, bitince liste yenilenir", async () => {
    vi.useFakeTimers();
    const state = { characters: [ADA], job: { status: "running", log: ["  Ada: çizim planı"] } as BankJob };
    const calls = bankApi(state);
    renderIn(<CharacterBank initial={[]} series={[]} initialJob={null} />);
    expect(screen.getByText(tr("bank.empty"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(tr("bank.add.name")), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(tr("bank.add.desc")), { target: { value: "host" } });
    fireEvent.change(screen.getByLabelText(tr("bank.add.role")), { target: { value: "sunucu" } });
    fireEvent.change(screen.getByLabelText(tr("bank.add.line")), { target: { value: "ink" } });
    await act(async () => void fireEvent.submit(screen.getByRole("button", { name: tr("bank.add.submit") }).closest("form")!));
    expect(calls[0]).toEqual({
      url: "/api/characters",
      body: { name: "Ada", description: "host", role: "sunucu", pack: "flat-explainer", lineStyle: "ink", reference: "" },
    });
    expect(screen.getByRole("status").textContent).toContain(tr("bank.job.running"));
    expect(screen.getByRole("status").textContent).toContain("Ada: çizim planı");
    expect((screen.getByRole("button", { name: tr("bank.add.submit") }) as HTMLButtonElement).disabled).toBe(true);
    state.job = { status: "done", log: [] };
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
    expect(screen.getByRole("status").textContent).toBe(tr("bank.job.done"));
    expect(screen.getByAltText("Ada")).toBeTruthy();
  });

  it("çizgi stili seçilmezse gönderilmez; hata ve başarısız iş görünür", async () => {
    const calls = bankApi({ characters: [], job: null }, () => "Bilinmeyen stil paketi: x");
    renderIn(<CharacterBank initial={[]} series={[]} initialJob={{ status: "error", log: ["Süreç çıkış kodu: 1"] }} />);
    expect(screen.getByRole("status").textContent).toContain(tr("bank.job.error"));
    expect(screen.getByRole("status").textContent).toContain("Süreç çıkış kodu: 1");
    fireEvent.change(screen.getByLabelText(tr("bank.add.name")), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText(tr("bank.add.desc")), { target: { value: "d" } });
    await act(async () => void fireEvent.submit(screen.getByRole("button", { name: tr("bank.add.submit") }).closest("form")!));
    expect(calls[0]!.body!.lineStyle).toBeUndefined();
    expect(screen.getByRole("alert").textContent).toBe("Bilinmeyen stil paketi: x");
    expect(calls).toHaveLength(1);
  });

  it("maskot: seri adıyla eklenir, boş adla istek gitmez, mevcut maskotluk çıkarılır", async () => {
    const calls = bankApi({ characters: [char("can", "Can", { mascotOf: ["Bilim"] })], job: null });
    renderIn(<CharacterBank initial={[char("can", "Can", { mascotOf: ["Eski"] })]} series={["Bilim"]} initialJob={null} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("bank.mascot.add") })));
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(tr("bank.mascot.placeholder")), { target: { value: "Bilim" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("bank.mascot.add") })));
    expect(calls[0]).toEqual({ url: "/api/characters/mascot", body: { id: CAN.id, series: "Bilim", on: true } });
    expect((screen.getByLabelText(tr("bank.mascot.placeholder")) as HTMLInputElement).value).toBe("");
    await act(async () => void fireEvent.click(screen.getByTitle(tr("bank.mascot.remove", { series: "Bilim" }))));
    expect(calls.at(-2)).toEqual({ url: "/api/characters/mascot", body: { id: CAN.id, series: "Bilim", on: false } });
  });
});
