import { describe, expect, it } from "vitest";
import { applyCuration, lessonKey, mergeLessons, topLessons, type LessonBook } from "../src/lessons.ts";

describe("ders defteri", () => {
  it("aynı kuralı farklı yazımla birleştirir, her bölüm bir kez sayılır", () => {
    let book: LessonBook = { lessons: [] };
    book = mergeLessons(book, [{ target: "director", rule: "Keep on-screen text out of the subtitle area." }], "ep1", "2026-10-30T10:00:00Z");
    book = mergeLessons(book, [{ target: "director", rule: "keep on-screen text out of the subtitle area" }], "ep1", "2026-10-30T11:00:00Z");
    book = mergeLessons(book, [{ target: "director", rule: "Keep on screen text out of subtitle area!" }], "ep2", "2026-10-31T10:00:00Z");
    expect(book.lessons).toHaveLength(1);
    expect(book.lessons[0]).toMatchObject({ count: 2, episodes: ["ep1", "ep2"], lastSeen: "2026-10-31T10:00:00Z" });
  });

  it("hedefe göre en çok tekrarlananları verir", () => {
    const book: LessonBook = { lessons: [] };
    mergeLessons(book, [{ target: "designer", rule: "No background behind characters" }], "a");
    mergeLessons(book, [{ target: "designer", rule: "No background behind characters" }], "b");
    mergeLessons(book, [{ target: "designer", rule: "Use thick outlines" }], "b");
    mergeLessons(book, [{ target: "script", rule: "Open with a concrete moment" }], "b");
    expect(topLessons(book, "designer")).toEqual(["No background behind characters", "Use thick outlines"]);
    expect(topLessons(book, "director")).toEqual([]);
  });

  it("anahtar sözcük sırasından ve noktalamadan bağımsız", () => {
    expect(lessonKey("Use mood changes often.")).toBe(lessonKey("often use mood changes"));
  });

  it("küratör birleştirdiği kuralların bölümlerini toplar; boş sonuçta defteri korur", () => {
    const book: LessonBook = { lessons: [] };
    mergeLessons(book, [{ target: "director", rule: "Vary the background between shots" }], "a", "2026-10-30T10:00:00Z");
    mergeLessons(book, [{ target: "director", rule: "Do not reuse the same room twice in a row" }], "b", "2026-10-31T10:00:00Z");
    mergeLessons(book, [{ target: "designer", rule: "Thick outlines" }], "b");
    applyCuration(book, "director", [{ rule: "Change background or framing between consecutive shots", sources: [0, 1] }]);
    const director = book.lessons.filter((l) => l.target === "director");
    expect(director).toEqual([
      expect.objectContaining({ rule: "Change background or framing between consecutive shots", count: 2, episodes: ["a", "b"], lastSeen: "2026-10-31T10:00:00Z" }),
    ]);
    expect(book.lessons.filter((l) => l.target === "designer")).toHaveLength(1);

    applyCuration(book, "designer", []);
    expect(book.lessons.filter((l) => l.target === "designer")).toHaveLength(1);
  });
});