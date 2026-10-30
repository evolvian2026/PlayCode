import { describe, expect, it } from "vitest";
import { certificationPeriod, onDutyDateError, onDutyRef, partsOverlap } from "../src";

describe("on duty", () => {
  it("lets the forenoon and afternoon of a day go to different things", () => {
    expect(partsOverlap("forenoon", "afternoon")).toBe(false);
    expect(partsOverlap("forenoon", "forenoon")).toBe(true);
    expect(partsOverlap("full", "afternoon")).toBe(true);
  });

  it("takes dates from two weeks back to a month ahead, and for a drive its day or later rounds", () => {
    const today = "2026-10-22";
    expect(onDutyDateError("2026-10-08", today)).toBeNull();
    expect(onDutyDateError("2026-10-07", today)).toMatch(/within 14 days/);
    expect(onDutyDateError("2026-11-22", today)).toMatch(/30 days ahead/);
    expect(onDutyDateError("2026-11-21", today)).toBeNull();
    expect(onDutyDateError("2026-10-20", today, "2026-10-21")).toMatch(/drive day/);
    expect(onDutyDateError("2026-10-23", today, "2026-10-21")).toBeNull();
    expect(onDutyDateError("2026-10-29", today, "2026-10-21")).toMatch(/drive day/);
  });

  it("prints a short reference", () => {
    expect(onDutyRef("3f2a9c1e-0000-4000-8000-000000000000")).toBe("OD-3F2A9C1E");
  });
});

describe("certifications", () => {
  it("say when they were earned and until when they're valid", () => {
    expect(certificationPeriod("2026-05", null)).toBe("May 2026");
    expect(certificationPeriod("2026-05", "2029-05")).toBe("May 2026, valid until May 2029");
  });
});
