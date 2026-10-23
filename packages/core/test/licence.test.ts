import { describe, expect, it } from "vitest";
import { effectiveEnd, licenceStatus, renewedUntil } from "../src";

describe("licence", () => {
  it("moves from active to ending, grace and read-only", () => {
    expect(licenceStatus(null, "2026-10-23").state).toBe("active");
    expect(licenceStatus("2027-07-31", "2026-10-23")).toMatchObject({ state: "active", daysLeft: 281 });
    expect(licenceStatus("2026-11-10", "2026-10-23").state).toBe("ending");
    expect(licenceStatus("2026-10-23", "2026-10-23")).toMatchObject({ state: "ending", daysLeft: 0 });
    expect(licenceStatus("2026-10-20", "2026-10-23")).toMatchObject({ state: "grace", daysLeft: -3, graceEndsOn: "2026-11-03" });
    expect(licenceStatus("2026-10-20", "2026-11-03").state).toBe("grace");
    expect(licenceStatus("2026-10-20", "2026-11-04").state).toBe("expired");
  });

  it("uses the earliest end date and renews from the later of today and the end date", () => {
    expect(effectiveEnd("2027-07-31", null, "2027-03-31")).toBe("2027-03-31");
    expect(effectiveEnd(null, undefined)).toBeNull();
    expect(renewedUntil("2027-07-31", "2026-10-23", 12)).toBe("2028-07-31");
    expect(renewedUntil("2026-09-30", "2026-10-23", 12)).toBe("2027-10-23"); // already lapsed: from today
    expect(renewedUntil("2026-12-31", "2026-10-23", 2)).toBe("2027-02-28"); // month end clamps
    expect(renewedUntil(null, "2026-10-23", 6)).toBe("2027-04-23");
  });
});
