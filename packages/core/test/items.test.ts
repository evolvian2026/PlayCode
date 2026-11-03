import { describe, expect, it } from "vitest";
import { itemFlags, itemStats, type ItemAttempt } from "../src";

// 40 students with abilities 0.025 .. 1.0.
const ability = new Map(Array.from({ length: 40 }, (_, i) => [`u${i}`, (i + 1) / 40]));
const make = (fn: (i: number) => Partial<ItemAttempt> & { correct: boolean }): ItemAttempt[] => Array.from({ length: 40 }, (_, i) => ({ userId: `u${i}`, ...fn(i) }));

describe("item analysis", () => {
  it("separates good questions from flawed ones", () => {
    const good = itemStats(make((i) => ({ correct: i >= 15 })), ability);
    expect(good.discrimination).toBe(1);
    expect(itemFlags(good, { difficulty: 2, openReports: 0 })).toEqual([]);

    const backwards = itemStats(make((i) => ({ correct: i < 20 })), ability);
    expect(backwards.discrimination).toBe(-1);
    expect(itemFlags(backwards, { difficulty: 2, openReports: 0 })).toEqual(["negative_discrimination"]);
  });

  it("spots a likely wrong answer key", () => {
    // Keyed answer is "a", but the strongest students pick "c".
    const stats = itemStats(make((i) => (i >= 28 ? { correct: false, optionId: "c" } : { correct: i % 3 === 0, optionId: i % 3 === 0 ? "a" : "b" })), ability, "a");
    expect(stats.upperGroupFavourite).toBe("c");
    expect(itemFlags(stats, { difficulty: 1, openReports: 2 })[0]).toBe("key_suspect");
    expect(itemFlags(stats, { difficulty: 1, openReports: 2 })).toContain("reported");
  });

  it("says nothing about difficulty until there are enough attempts", () => {
    const few = itemStats(make((i) => ({ correct: false })).slice(0, 10), ability);
    expect(few).toMatchObject({ attempts: 10, discrimination: null });
    expect(itemFlags(few, { difficulty: 3, openReports: 0 })).toEqual([]);
    const easy = itemStats(make(() => ({ correct: true })), ability);
    expect(itemFlags(easy, { difficulty: 3, openReports: 0 })).toEqual(["low_discrimination", "too_easy"]);
    expect(itemFlags(itemStats(make((i) => ({ correct: i > 36 })), ability), { difficulty: 3, openReports: 0 })).toContain("too_hard");
  });
});
