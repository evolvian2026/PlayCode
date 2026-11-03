import { describe, expect, it } from "vitest";
import { feedbackOpen, graduateStatus, guardianReportMonth, meanRating, monthLabel, monthRange } from "../src";

describe("graduate outcomes", () => {
  it("counts each graduate once: offer, then admission, then startup", () => {
    expect(graduateStatus({ offer: true, higherStudies: true, startup: false })).toBe("placed");
    expect(graduateStatus({ offer: false, higherStudies: true, startup: true })).toBe("higher_studies");
    expect(graduateStatus({ offer: false, higherStudies: false, startup: true })).toBe("startup");
    expect(graduateStatus({ offer: false, higherStudies: false, startup: false })).toBe("not_known");
  });
});

describe("training feedback", () => {
  const session = { startsAt: new Date("2026-10-20T04:30:00Z"), durationMinutes: 90 };
  it("is open from the start until a week after the end", () => {
    expect(feedbackOpen(session, new Date("2026-10-20T04:29:00Z"))).toBe(false);
    expect(feedbackOpen(session, new Date("2026-10-20T05:00:00Z"))).toBe(true);
    expect(feedbackOpen(session, new Date("2026-10-27T06:00:00Z"))).toBe(true);
    expect(feedbackOpen(session, new Date("2026-10-27T06:01:00Z"))).toBe(false);
  });
  it("averages ratings to one place", () => {
    expect(meanRating([4, 5, 4])).toBe(4.3);
    expect(meanRating([])).toBeNull();
  });
});

describe("guardian reports", () => {
  it("are due in the first week of the next month, from 9 on the 1st", () => {
    expect(guardianReportMonth("2026-11-01", 8)).toBeNull();
    expect(guardianReportMonth("2026-11-01", 9)).toBe("2026-10");
    expect(guardianReportMonth("2026-11-07", 23)).toBe("2026-10");
    expect(guardianReportMonth("2026-11-08", 9)).toBeNull();
    expect(guardianReportMonth("2027-01-02", 10)).toBe("2026-12");
  });
  it("knows month lengths", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});
