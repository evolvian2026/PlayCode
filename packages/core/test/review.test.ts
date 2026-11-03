import { describe, expect, it } from "vitest";
import { afterAnswer, dueForReview, retentionLabel, REVIEW_INTERVALS, REVIEW_MIN_MASTERY } from "../src";

describe("spaced review", () => {
  it("starts a new skill at the first step", () => {
    expect(afterAnswer({ step: 0, dueOn: null }, true, "2026-10-01")).toEqual({ step: 0, dueOn: "2026-10-03" });
  });

  it("moves up a step only when remembered on or after the due date", () => {
    expect(afterAnswer({ step: 1, dueOn: "2026-10-05" }, true, "2026-10-04")).toEqual({ step: 1, dueOn: "2026-10-09" });
    expect(afterAnswer({ step: 1, dueOn: "2026-10-05" }, true, "2026-10-05")).toEqual({ step: 2, dueOn: "2026-10-17" });
    expect(afterAnswer({ step: 1, dueOn: "2026-10-05" }, true, "2026-11-20")).toEqual({ step: 2, dueOn: "2026-12-02" });
  });

  it("moves down a step on a wrong answer and stops at the ends", () => {
    expect(afterAnswer({ step: 3, dueOn: "2026-10-05" }, false, "2026-10-05")).toEqual({ step: 2, dueOn: "2026-10-17" });
    expect(afterAnswer({ step: 0, dueOn: "2026-10-05" }, false, "2026-10-05").step).toBe(0);
    const top = REVIEW_INTERVALS.length - 1;
    expect(afterAnswer({ step: top, dueOn: "2026-10-05" }, true, "2026-10-05").step).toBe(top);
  });

  it("only one step per due date: the second correct answer that day is early", () => {
    const first = afterAnswer({ step: 0, dueOn: "2026-10-05" }, true, "2026-10-05");
    expect(afterAnswer(first, true, "2026-10-05")).toEqual(first);
  });

  it("lists due skills that were learned, most overdue first", () => {
    const due = dueForReview(
      [
        { skillId: "a", mastery: 60, step: 1, dueOn: "2026-10-10" },
        { skillId: "b", mastery: 80, step: 2, dueOn: "2026-10-01" },
        { skillId: "c", mastery: REVIEW_MIN_MASTERY - 1, step: 0, dueOn: "2026-09-01" },
        { skillId: "d", mastery: 90, step: 0, dueOn: "2026-10-20" },
        { skillId: "e", mastery: 90, step: 0, dueOn: null },
        { skillId: "f", mastery: 90, step: 1, dueOn: "2026-10-10" },
      ],
      "2026-10-12",
    );
    expect(due.map((d) => d.skillId)).toEqual(["b", "f", "a"]);
    expect(due[0]!.overdueDays).toBe(11);
  });

  it("labels the interval", () => {
    expect(retentionLabel(0)).toBe("2 days");
    expect(retentionLabel(3)).toBe("1 month");
    expect(retentionLabel(5)).toBe("4 months");
  });
});
