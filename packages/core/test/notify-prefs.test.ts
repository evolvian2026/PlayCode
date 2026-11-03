import { describe, expect, it } from "vitest";
import { notifyCategory, quietHoursOf, quietUntil, reachesPhone } from "../src";

describe("what reaches a student's phone", () => {
  it("follows the categories they muted, except the placement cell's", () => {
    expect(reachesPhone({ muted: ["practice", "classmates"] }, "streak_at_risk")).toBe(false);
    expect(reachesPhone({ muted: ["practice", "classmates"] }, "duel_invite")).toBe(false);
    expect(reachesPhone({ muted: ["practice", "classmates"] }, "test_open")).toBe(true);
    // Placements can't be muted, even if the setting says so.
    expect(reachesPhone({ muted: ["placements"] }, "placement")).toBe(true);
    expect(notifyCategory("something_new")).toBe("placements");
  });

  it("holds messages during quiet hours, in the college's time zone, until they end", () => {
    const quiet = { from: "22:00", to: "07:00" };
    // 23:30 IST is 18:00 UTC: quiet until 07:00 IST, 01:30 UTC next day.
    expect(quietUntil(new Date("2026-11-02T18:00:00Z"), "Asia/Kolkata", quiet)?.toISOString()).toBe("2026-11-03T01:30:00.000Z");
    // 06:59 IST is still quiet; 07:00 isn't.
    expect(quietUntil(new Date("2026-11-03T01:29:00Z"), "Asia/Kolkata", quiet)?.toISOString()).toBe("2026-11-03T01:30:00.000Z");
    expect(quietUntil(new Date("2026-11-03T01:30:00Z"), "Asia/Kolkata", quiet)).toBeNull();
    // Midday is fine; a range that doesn't cross midnight works too.
    expect(quietUntil(new Date("2026-11-02T06:30:00Z"), "Asia/Kolkata", quiet)).toBeNull();
    expect(quietUntil(new Date("2026-11-02T08:30:00Z"), "Asia/Kolkata", { from: "13:00", to: "15:00" })?.toISOString()).toBe("2026-11-02T09:30:00.000Z");
    // Default quiet hours unless switched off.
    expect(quietHoursOf({})).toEqual(quiet);
    expect(quietHoursOf({ quiet: null })).toBeNull();
    expect(quietUntil(new Date("2026-11-02T18:00:00Z"), "Asia/Kolkata", null)).toBeNull();
  });
});
