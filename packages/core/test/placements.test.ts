import { describe, expect, it } from "vitest";
import { checkEligibility, engagementBand, formatLpa, median } from "../src";

describe("placements", () => {
  it("lets students in when every rule passes, and treats missing rules as open", () => {
    const record = { cgpa: 7.2, backlogs: 0, tenthPct: 80, twelfthPct: 75, graduationYear: 2027 };
    expect(checkEligibility({ unitIds: [], minCgpa: 7, maxBacklogs: 0, min10th: 60, min12th: 60, graduationYears: [2027] }, record, { inUnits: true, placed: false })).toEqual({ eligible: true, reasons: [] });
    expect(checkEligibility({ unitIds: [] }, null, { inUnits: true, placed: false }).eligible).toBe(true);
    expect(checkEligibility({ unitIds: [], allowPlaced: true }, record, { inUnits: true, placed: true }).eligible).toBe(true);
    expect(checkEligibility({ unitIds: [], maxBacklogs: 1 }, { ...record, backlogs: 2 }, { inUnits: true, placed: false }).reasons).toEqual(["Allows at most 1 active backlog"]);
  });

  it("checks training attendance, but not before any training has been held", () => {
    const c = { unitIds: [], minAttendancePct: 75 };
    expect(checkEligibility(c, null, { inUnits: true, placed: false, attendancePct: 80 }).eligible).toBe(true);
    expect(checkEligibility(c, null, { inUnits: true, placed: false, attendancePct: 50 }).reasons).toEqual(["Needs 75% attendance in placement training (yours is 50%)"]);
    expect(checkEligibility(c, null, { inUnits: true, placed: false, attendancePct: null }).eligible).toBe(true);
  });

  it("bands practice and formats salaries", () => {
    expect([0, 4, 5, 19, 20, 60].map(engagementBand)).toEqual(["rare", "rare", "occasional", "occasional", "regular", "regular"]);
    expect(formatLpa(336_000)).toBe("₹3.36 LPA");
    expect(formatLpa(1_200_000)).toBe("₹12 LPA");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});
