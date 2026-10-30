import { describe, expect, it } from "vitest";
import { deskOpen, fixedShare, inAudience, offerDetailsError } from "../src/drive-day";

describe("drive updates", () => {
  const app = (status: string, roundsCleared = 0) => ({ status, roundsCleared });
  it("reaches the right applicants", () => {
    expect(inAudience(app("registered"), "all", null)).toBe(true);
    expect(inAudience(app("withdrawn"), "all", null)).toBe(false);
    expect(inAudience(app("shortlisted", 1), "in_selection", null)).toBe(true);
    expect(inAudience(app("offered", 3), "in_selection", null)).toBe(false);
    expect(inAudience(app("shortlisted", 1), "round", 1)).toBe(true);
    expect(inAudience(app("shortlisted", 2), "round", 1)).toBe(false);
    expect(inAudience(app("rejected", 1), "round", 1)).toBe(false);
    expect(inAudience(app("offered", 3), "offered", null)).toBe(true);
    expect(inAudience(app("rejected", 1), "not_selected", null)).toBe(true);
  });
});

describe("reporting desk", () => {
  it("opens the day before the drive and closes the day after", () => {
    expect(deskOpen("2026-11-04", "2026-11-02")).toBe(false);
    expect(deskOpen("2026-11-04", "2026-11-03")).toBe(true);
    expect(deskOpen("2026-11-04", "2026-11-05")).toBe(true);
    expect(deskOpen("2026-11-04", "2026-11-06")).toBe(false);
  });
});

describe("offer details", () => {
  it("checks the parts add up", () => {
    expect(offerDetailsError({ fixedRupees: 500_000, variableRupees: 200_000 }, 600_000)).toMatch(/more than the CTC/);
    expect(offerDetailsError({ bondAmountRupees: 100_000 }, 600_000)).toMatch(/service agreement/);
    expect(offerDetailsError({ fixedRupees: 500_000, bondMonths: 24, bondAmountRupees: 100_000 }, 600_000)).toBeNull();
  });
  it("gives the fixed share", () => {
    expect(fixedShare({ fixedRupees: 540_000 }, 600_000)).toBe(90);
    expect(fixedShare({}, 600_000)).toBeNull();
    expect(fixedShare(null, 600_000)).toBeNull();
  });
});
