import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStudio, tempRoot } from "./fakes.ts";

vi.mock("server-only", () => ({}));
const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("../../src/lib/server", () => ({
  get ROOT() {
    return paths.root;
  },
}));

const { currentVersion, updateInfo } = await import("../../src/lib/update.ts");

const release = (tag: string) =>
  new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/r/${tag}`, published_at: "2026-10-30T00:00:00Z" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const fetchMock = vi.fn<typeof fetch>();
/** Arka planda süren GitHub sorgusunun bitmesini bekler. */
const settle = () => (globalThis as { __ysUpdateFlight?: Promise<void> }).__ysUpdateFlight;

beforeEach(() => {
  resetStudio();
  paths.root = tempRoot();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  delete process.env.YS_UPDATE_CHECK;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.YS_UPDATE_CHECK;
});

describe("currentVersion", () => {
  it("kök package.json'daki sürümü okur; yoksa, bozuksa ya da sürümsüzse 0.0.0", () => {
    expect(currentVersion()).toBe("1.2.3");
    writeFileSync(join(paths.root, "package.json"), "{}");
    expect(currentVersion()).toBe("0.0.0");
    writeFileSync(join(paths.root, "package.json"), "{bozuk");
    expect(currentVersion()).toBe("0.0.0");
    paths.root = join(paths.root, "yok");
    expect(currentVersion()).toBe("0.0.0");
  });
});

describe("updateInfo", () => {
  it("YS_UPDATE_CHECK=0 iken GitHub'a hiç sorulmaz", async () => {
    process.env.YS_UPDATE_CHECK = "0";
    expect(await updateInfo()).toEqual({ current: "1.2.3", latest: undefined, available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ilk istek sorguyu bekler; yeni sürüm varsa uyarır, eşzamanlı istekler tek sorguyu paylaşır", async () => {
    fetchMock.mockResolvedValue(release("v1.3.0"));
    const [a, b] = await Promise.all([updateInfo(), updateInfo()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/ersinkoc/AI-Video-Factory/releases/latest");
    expect(init?.headers).toMatchObject({ accept: "application/vnd.github+json" });
    expect(a).toEqual({
      current: "1.2.3",
      latest: { version: "1.3.0", url: "https://github.com/r/v1.3.0", publishedAt: "2026-10-30T00:00:00Z" },
      available: true,
    });
    expect(b.available).toBe(true);
  });

  it("6 saat önbelleklenir; sonra arka planda yenilenir ve sayfa eski bilgiyle hemen döner", async () => {
    fetchMock.mockResolvedValueOnce(release("1.2.3"));
    expect((await updateInfo()).available).toBe(false);
    vi.setSystemTime(new Date("2026-10-31T15:59:00Z"));
    await updateInfo();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-31T16:01:00Z"));
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const stale = await updateInfo();
    expect(stale.latest?.version).toBe("1.2.3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolve(release("v2.0.0"));
    await settle();
    expect(settle()).toBeUndefined();
    expect(await updateInfo()).toMatchObject({ latest: { version: "2.0.0" }, available: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("404 (henüz release yok) 6 saat, diğer hata 30 dk sonra yeniden sorulur", async () => {
    fetchMock.mockResolvedValueOnce(new Response("yok", { status: 404 }));
    expect(await updateInfo()).toEqual({ current: "1.2.3", latest: undefined, available: false });
    vi.setSystemTime(new Date("2026-10-31T11:00:00Z"));
    await updateInfo();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetStudio();
    fetchMock.mockResolvedValueOnce(new Response("hata", { status: 503 }));
    await updateInfo();
    vi.setSystemTime(new Date("2026-10-31T11:29:00Z"));
    await updateInfo();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-10-31T11:31:00Z"));
    fetchMock.mockResolvedValueOnce(release("1.0.0"));
    await updateInfo();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ağ hatası sayfayı bozmaz: bilinen son sürüm korunur, 30 dk sonra yeniden denenir", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ağ yok"));
    expect(await updateInfo()).toEqual({ current: "1.2.3", latest: undefined, available: false });

    resetStudio();
    fetchMock.mockResolvedValueOnce(release("v9.0.0"));
    await updateInfo();
    vi.setSystemTime(new Date("2026-10-31T17:00:00Z"));
    fetchMock.mockRejectedValueOnce(new Error("ağ yok"));
    await updateInfo();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const after = await updateInfo();
    expect(after.latest?.version).toBe("9.0.0");
    expect(after.available).toBe(true);
    vi.setSystemTime(new Date("2026-10-31T17:20:00Z"));
    await updateInfo();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
