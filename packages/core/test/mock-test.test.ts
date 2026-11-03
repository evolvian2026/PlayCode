import { describe, expect, it } from "vitest";
import { MOCK_PATTERNS, mockFocus, mockMinutes, mockPattern, percentile, sectionClock } from "../src/mock-test";

const at = (min: number) => new Date(Date.UTC(2026, 9, 26, 10, 0) + min * 60_000);
const sections = [{ minutes: 10 }, { minutes: 8 }, { minutes: 25 }];

describe("mock tests", () => {
  it("defines patterns that fit an hour or so", () => {
    expect(MOCK_PATTERNS.map((p) => [p.id, mockMinutes(p)])).toEqual([
      ["service", 60],
      ["product", 67],
    ]);
    expect(mockPattern("nope")).toBeUndefined();
  });

  it("keeps the clock running across sections while the student is away", () => {
    // Still inside the first section.
    expect(sectionClock(sections, 0, at(10), at(9))).toEqual({ section: 0, deadline: at(10), finished: false });
    // The first section ran out at 10; the second started then, not now.
    expect(sectionClock(sections, 0, at(10), at(12))).toEqual({ section: 1, deadline: at(18), finished: false });
    // Away for half an hour: two sections closed, the third ends at 43.
    expect(sectionClock(sections, 0, at(10), at(30))).toEqual({ section: 2, deadline: at(43), finished: false });
    expect(sectionClock(sections, 0, at(10), at(43))).toMatchObject({ section: 3, finished: true });
    // A section the student finished early: its successor runs from the early finish.
    expect(sectionClock(sections, 1, at(13), at(12))).toEqual({ section: 1, deadline: at(13), finished: false });
  });

  it("gives a percentile only with enough attempts, ties counting half", () => {
    expect(percentile([1, 2, 3], 2)).toBeNull();
    const scores = Array.from({ length: 20 }, (_, i) => i); // 0..19
    expect(percentile(scores, 10)).toBe(53); // 10 below, 1 equal: 10.5 / 20
    expect(percentile(scores, 0)).toBe(3);
    expect(percentile(scores, 19)).toBe(98);
  });

  it("points at the sections furthest below target", () => {
    const service = mockPattern("service")!;
    const focus = mockFocus(service, [
      { score: 5, max: 6 },
      { score: 1, max: 5 },
      { score: 3, max: 6 },
      { score: 4, max: 6 },
      { score: 0, max: 5 },
    ]);
    expect(focus.map((f) => [f.title, f.pct])).toEqual([
      ["Hands-on coding", 0],
      ["Logical reasoning", 20],
      ["Verbal ability", 50],
    ]);
  });
});
