import { describe, expect, it } from "vitest";
import { followUpState, targetProgress } from "../src";

describe("recruiter relations", () => {
  it("knows which follow-ups are due", () => {
    expect(followUpState("2026-10-28", "2026-10-29")).toBe("overdue");
    expect(followUpState("2026-10-29", "2026-10-29")).toBe("today");
    expect(followUpState("2026-11-02", "2026-10-29")).toBe("upcoming");
  });
  it("measures progress against a target", () => {
    expect(targetProgress(13, 24, 80)).toEqual({ placedPct: 54.2, needed: 7, met: false });
    expect(targetProgress(7, 7, 90)).toEqual({ placedPct: 100, needed: 0, met: true });
    expect(targetProgress(0, 0, 80)).toEqual({ placedPct: 0, needed: 0, met: false });
  });
});
