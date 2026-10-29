import { describe, expect, it } from "vitest";
import { checkEligibility, DEFAULT_PLACEMENT_POLICY, offerTier } from "../src";

const policy = { ...DEFAULT_PLACEMENT_POLICY, tiers: true };
const record = { cgpa: 8, backlogs: 0, tenthPct: 85, twelfthPct: 80, graduationYear: 2027 };
const base = { unitIds: [] };
const check = (offers: ("regular" | "dream" | "super_dream")[], ctc: number, allowPlaced = false) =>
  checkEligibility({ ...base, allowPlaced }, record, { inUnits: true, placed: offers.length > 0, policy, offers, driveCtcRupees: ctc });

describe("placement policy", () => {
  it("puts offers in tiers by CTC", () => {
    expect(offerTier(450_000, policy)).toBe("regular");
    expect(offerTier(600_000, policy)).toBe("dream");
    expect(offerTier(1_200_000, policy)).toBe("super_dream");
  });

  it("lets a student with an offer sit only for higher tiers", () => {
    expect(check([], 400_000).eligible).toBe(true);
    expect(check(["regular"], 400_000).reasons).toEqual(["You hold a Regular offer, so you can only sit for Dream and Super dream drives"]);
    expect(check(["regular"], 700_000).eligible).toBe(true);
    expect(check(["dream"], 900_000).reasons).toEqual(["You hold a Dream offer, so you can only sit for Super dream drives"]);
    expect(check(["super_dream"], 2_000_000).reasons).toEqual(["You hold a Super dream offer, the highest tier"]);
    // A drive open to everyone still counts the offers held.
    expect(check(["dream"], 400_000, true).eligible).toBe(true);
    expect(check(["regular", "dream"], 1_500_000, true).reasons).toEqual(["You already hold 2 offers, the most the placement policy allows"]);
  });

  it("falls back to the drive's own rule without tiers", () => {
    const r = checkEligibility(base, record, { inUnits: true, placed: true, policy: DEFAULT_PLACEMENT_POLICY, offers: ["regular"], driveCtcRupees: 900_000 });
    expect(r.reasons).toEqual(["You already hold an offer, and this drive is for students without one"]);
  });
});
