import { describe, expect, it } from "vitest";
import { formatRupees, gstSplit, planFor, planHas, PLAN_SPECS } from "../src";

describe("plans", () => {
  it("includes features cumulatively", () => {
    for (const f of PLAN_SPECS.pro.features) expect(planHas("enterprise", f)).toBe(true);
    expect(planHas("starter", "ai_coach")).toBe(false);
    expect(planFor("ai_coach")).toBe("pro");
    expect(planFor("saml")).toBe("enterprise");
  });

  it("splits GST by state", () => {
    expect(gstSplit(100_000, "29", "29")).toEqual({ cgst: 9_000, sgst: 9_000, igst: 0 });
    expect(gstSplit(100_000, "29", "27")).toEqual({ cgst: 0, sgst: 0, igst: 18_000 });
    expect(gstSplit(100_001, "29", null).igst).toBe(18_000);
    const odd = gstSplit(100_003, "29", "29");
    expect(odd.cgst + odd.sgst).toBe(18_001);
  });

  it("formats rupees the Indian way", () => {
    expect(formatRupees(12_345_678)).toBe("₹1,23,456.78");
  });
});
