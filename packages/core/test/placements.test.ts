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

describe("eligibility reasons", () => {
  it("each match a listed template, so the student app can translate them", async () => {
    const { DEFAULT_PLACEMENT_POLICY, ELIGIBILITY_REASON_TEMPLATES } = await import("../src");
    const patterns = ELIGIBILITY_REASON_TEMPLATES.map((t) => new RegExp(`^${t.split(/\{\w+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`));
    const strict = { unitIds: ["x"], minCgpa: 7, maxBacklogs: 0, min10th: 60, min12th: 60, graduationYears: [2027, 2028], minAttendancePct: 75, minAptitude: 500 };
    const weak = { cgpa: 6, backlogs: 2, tenthPct: 50, twelfthPct: 50, graduationYear: 2026 };
    const empty = { cgpa: null, backlogs: null, tenthPct: null, twelfthPct: null, graduationYear: null };
    const policy = { ...DEFAULT_PLACEMENT_POLICY, tiers: true };
    const seen = new Set<string>();
    for (const record of [weak, empty, null])
      for (const maxBacklogs of [0, 1, 3])
        for (const extra of [
          { inUnits: false, placed: true, attendancePct: 40, aptitude: null, noShows: 1 },
          { inUnits: true, placed: false, attendancePct: 60, aptitude: 450, noShows: 3 },
          { inUnits: true, placed: true, policy, offers: ["regular" as const], driveCtcRupees: 400_000 },
          { inUnits: true, placed: true, policy, offers: ["super_dream" as const], driveCtcRupees: 400_000 },
          { inUnits: true, placed: true, policy, offers: ["dream" as const, "regular" as const, "regular" as const], driveCtcRupees: 2_000_000 },
          { inUnits: true, placed: true, policy: { ...policy, maxOffers: 1 }, offers: ["regular" as const], driveCtcRupees: 2_000_000 },
        ])
          for (const r of checkEligibility({ ...strict, maxBacklogs }, record, extra).reasons) {
            expect(patterns.some((p) => p.test(r)), r).toBe(true);
            seen.add(r);
          }
    // Enough variety that this would notice a reason dropped from the list.
    expect(seen.size).toBeGreaterThan(15);
  });
});
