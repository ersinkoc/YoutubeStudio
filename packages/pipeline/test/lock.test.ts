import { mkdtempSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsAssetStore, putJson, type AssetStore } from "@ys/storage";
import { acquireLock, liveLock } from "../src/light.ts";

const store = (): AssetStore => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-lock-")));
const key = "episodes/e1/run.lock.json";

describe("çalışma kilidi", () => {
  it("canlı başka süreç tutuyorsa ikinci çalıştırma reddedilir; bırakınca serbest", async () => {
    const s = store();
    // Bu testin ana süreci (vitest işçisi değil) canlı bir başka süreçtir.
    await putJson(s, key, { pid: process.ppid, host: hostname(), startedAt: "t" });
    await expect(acquireLock(s, "e1")).rejects.toThrow("zaten çalışıyor");
    await putJson(s, key, null);
    const release = await acquireLock(s, "e1");
    expect((await liveLock(s, "e1"))?.pid).toBe(process.pid);
    await release();
    expect(await liveLock(s, "e1")).toBeUndefined();
  });

  it("sahibi ölmüş kilit bayattır", async () => {
    const s = store();
    await putJson(s, key, { pid: 2 ** 22 + 12345, host: hostname(), startedAt: "t" });
    expect(await liveLock(s, "e1")).toBeUndefined();
    await (await acquireLock(s, "e1"))();
  });
});
