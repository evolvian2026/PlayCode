import { describe, expect, it } from "vitest";
import { exitSummary } from "../src";

describe("exit survey", () => {
  it("averages each item and counts who would recommend", () => {
    const r = (n: number, recommend: boolean) => ({ ratings: { training: n, practice: n, information: 3, support: 4, overall: n }, recommend });
    const s = exitSummary([r(5, true), r(4, true), r(2, false)]);
    expect(s.responses).toBe(3);
    expect(s.averages).toEqual({ training: 3.7, practice: 3.7, information: 3, support: 4, overall: 3.7 });
    expect(s.recommendPct).toBe(67);
    expect(exitSummary([])).toMatchObject({ responses: 0, recommendPct: null, averages: { overall: null } });
  });
});
