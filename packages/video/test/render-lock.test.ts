import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Gerçek makine kilidine dokunulmasın (o sırada bir bölüm render ediyor olabilir).
const LOCK = join(mkdtempSync(join(tmpdir(), "ys-rlock-")), "render.lock");
process.env.YS_RENDER_LOCK = LOCK;
const { withRenderLock } = await import("../src/render.ts");

describe("render kilidi", () => {
  it("aynı anda tek iş çalışır, ikincisi sırayı bekler", async () => {
    const order: string[] = [];
    const job = (name: string, ms: number) => async () => {
      order.push(`${name}+`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}-`);
    };
    await Promise.all([withRenderLock(job("a", 300)), withRenderLock(job("b", 10))]);
    // Kilidi hangisinin önce alacağı yarışa bağlı; önemli olan işlerin iç içe geçmemesi.
    expect([["a+", "a-", "b+", "b-"], ["b+", "b-", "a+", "a-"]]).toContainEqual(order);
  }, 20_000);

  it("sahibi ölmüş kilit bayattır", async () => {
    writeFileSync(LOCK, `${2 ** 22 + 12345}:x`);
    let waited = false;
    expect(await withRenderLock(async () => 1, () => (waited = true))).toBe(1);
    expect(waited).toBe(false);
  });
});
