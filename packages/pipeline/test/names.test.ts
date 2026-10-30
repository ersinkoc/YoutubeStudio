import { describe, expect, it } from "vitest";
import { anonymizeNames, castAliases } from "../src/names.ts";

const cast = [
  { id: "c1", name: "Federico Faggin" },
  { id: "c2", name: "Ted Hoff" },
  { id: "c3", name: "Busicom Executive" },
];

describe("anonymizeNames", () => {
  it("tam adları ve soyadları kadro etiketiyle değiştirir", () => {
    expect(anonymizeNames("Federico Faggin hunches over a desk while Hoff watches; Faggin's lamp glows", cast)).toBe(
      "Character A hunches over a desk while Character B watches; Character A's lamp glows",
    );
  });

  it("başka kelimelerin içindeki parçalara dokunmaz", () => {
    expect(anonymizeNames("Hoffmann street, the Executive suite", cast)).toBe("Hoffmann street, the Character C suite");
    expect(anonymizeNames("Busicom Executive signs", cast)).toBe("Character C signs");
  });

  it("etiketler kadro sırasına göre sabittir", () => {
    expect(castAliases(cast).get("c2")).toBe("Character B");
  });
});
