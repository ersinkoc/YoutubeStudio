import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { surviveBrokenPipe } from "../src/pipes.ts";

describe("kırık boru", () => {
  it("EPIPE süreci düşürmez, başka akış hatası düşürür", () => {
    const out = new EventEmitter();
    const err = new EventEmitter();
    surviveBrokenPipe(out, err);
    const fail = (code: string) => Object.assign(new Error(code), { code });
    expect(() => out.emit("error", fail("EPIPE"))).not.toThrow();
    expect(() => err.emit("error", fail("EPIPE"))).not.toThrow();
    expect(() => out.emit("error", fail("EIO"))).toThrow("EIO");
  });
});
