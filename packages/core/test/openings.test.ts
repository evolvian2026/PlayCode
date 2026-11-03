import { describe, expect, it } from "vitest";
import { joiningDelayed, openingState } from "../src/openings";

describe("openings", () => {
  it("knows when an opening closes", () => {
    expect(openingState("2026-11-05", "2026-10-30")).toBe("open");
    expect(openingState("2026-10-31", "2026-10-30")).toBe("closing");
    expect(openingState("2026-10-30", "2026-10-30")).toBe("closing");
    expect(openingState("2026-10-29", "2026-10-30")).toBe("closed");
  });
});

describe("joining", () => {
  const today = "2026-10-30";
  it("counts an offer as delayed once the joining date passes without joining", () => {
    expect(joiningDelayed({ status: "date_given", joiningDate: "2026-10-01", driveDate: "2026-08-01" }, today)).toBe(true);
    expect(joiningDelayed({ status: "date_given", joiningDate: "2026-11-15", driveDate: "2026-01-01" }, today)).toBe(false);
  });
  it("or when there's no date long after the drive", () => {
    expect(joiningDelayed({ status: null, joiningDate: null, driveDate: "2026-07-01" }, today)).toBe(true);
    expect(joiningDelayed({ status: "letter_received", joiningDate: null, driveDate: "2026-09-01" }, today)).toBe(false);
  });
  it("never for offers that are settled", () => {
    expect(joiningDelayed({ status: "joined", joiningDate: "2026-07-01", driveDate: "2026-01-01" }, today)).toBe(false);
    expect(joiningDelayed({ status: "revoked", joiningDate: null, driveDate: "2026-01-01" }, today)).toBe(false);
  });
});
