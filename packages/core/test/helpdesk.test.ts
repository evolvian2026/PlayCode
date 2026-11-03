import { describe, expect, it } from "vitest";
import { checkEligibility, correctionError, DEFAULT_PLACEMENT_POLICY, entryDatesError, entryPeriod } from "../src";

describe("record corrections", () => {
  it("checks proposed values are possible", () => {
    expect(correctionError("cgpa", 8.4)).toBeNull();
    expect(correctionError("cgpa", 11)).toBe("CGPA must be between 0 and 10");
    expect(correctionError("backlogs", 1.5)).toBe("Active backlogs must be a whole number");
    expect(correctionError("graduationYear", 2027)).toBeNull();
  });
});

describe("projects and internships", () => {
  it("checks dates", () => {
    expect(entryDatesError("2026-05", "2026-07", "2026-10")).toBeNull();
    expect(entryDatesError("2026-05", null, "2026-10")).toBeNull();
    expect(entryDatesError("2026-13", null, "2026-10")).toBe("Use months like 2026-05");
    expect(entryDatesError("2026-11", null, "2026-10")).toBe("It can't start in the future");
    expect(entryDatesError("2026-05", "2026-04", "2026-10")).toBe("It can't end before it starts");
  });
  it("describes the period", () => {
    expect(entryPeriod("2026-05", "2026-07")).toBe("May 2026 to Jul 2026");
    expect(entryPeriod("2026-05", "2026-05")).toBe("May 2026");
    expect(entryPeriod("2026-05", null)).toBe("since May 2026");
  });
});

describe("no-show rule", () => {
  const record = { cgpa: 8, backlogs: 0, tenthPct: 85, twelfthPct: 80, graduationYear: 2027 };
  it("holds a student back after missing too many drives", () => {
    const policy = { ...DEFAULT_PLACEMENT_POLICY, maxNoShows: 2 };
    expect(checkEligibility({ unitIds: [] }, record, { inUnits: true, placed: false, policy, noShows: 1 }).eligible).toBe(true);
    expect(checkEligibility({ unitIds: [] }, record, { inUnits: true, placed: false, policy, noShows: 2 }).reasons).toEqual(["You missed 2 drives you registered for. Talk to your placement cell."]);
    expect(checkEligibility({ unitIds: [] }, record, { inUnits: true, placed: false, policy: DEFAULT_PLACEMENT_POLICY, noShows: 5 }).eligible).toBe(true);
  });
});
