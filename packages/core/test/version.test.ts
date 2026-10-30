import { describe, expect, it } from "vitest";
import { bumpVersion, compareVersions, parseVersion } from "../src/version.ts";

describe("sürüm", () => {
  it("v önekli ve öneksiz okunur, bozuk olan reddedilir", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersion("1.2")).toBeUndefined();
  });

  it("sayısal karşılaştırılır (0.10 > 0.9)", () => {
    expect(compareVersions("v0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
    expect(compareVersions("bozuk", "0.1.0")).toBeLessThan(0);
  });

  it("artırma alt haneleri sıfırlar", () => {
    expect(bumpVersion("0.1.9", "patch")).toBe("0.1.10");
    expect(bumpVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.9", "major")).toBe("1.0.0");
  });
});
