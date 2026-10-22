import { describe, expect, it } from "vitest";
import {
  addDays,
  closeWeek,
  computeReadiness,
  computeXp,
  currentStreak,
  EMPTY_STREAK,
  groupSkillsByTopic,
  heartsAt,
  HEART_REFILL_MS,
  isoWeekKey,
  levelForXp,
  levelProgress,
  localDate,
  loseHeart,
  masteryFromRating,
  MAX_HEARTS,
  READINESS_PROFILES,
  recordActivity,
  updateRatings,
  xpForLevel,
  zoneSizes,
  can,
  earnedBadges,
  type XpInput,
} from "../src";

const baseXp: XpInput = {
  correct: true,
  difficulty: 2,
  firstAttempt: false,
  previouslyCorrect: false,
  hintsUsed: 0,
  timeMs: 60_000,
  expectedTimeMs: 75_000,
  playerRating: 1000,
  questionRating: 1000,
  repeatXpToday: 0,
};

describe("xp", () => {
  it("gives nothing for wrong answers", () => {
    expect(computeXp({ ...baseXp, correct: false }).xp).toBe(0);
  });
  it("rewards first try and speed", () => {
    expect(computeXp(baseXp).xp).toBe(20);
    expect(computeXp({ ...baseXp, firstAttempt: true }).xp).toBe(25);
    expect(computeXp({ ...baseXp, firstAttempt: true, timeMs: 10_000 }).xp).toBe(29);
  });
  it("charges for hints and cancels the speed bonus", () => {
    expect(computeXp({ ...baseXp, hintsUsed: 1, timeMs: 10_000 }).xp).toBe(15);
    expect(computeXp({ ...baseXp, hintsUsed: 5 }).xp).toBe(0);
  });
  it("cuts XP for questions far below the player", () => {
    expect(computeXp({ ...baseXp, playerRating: 1400, questionRating: 1000 }).xp).toBe(4);
  });
  it("caps repeat XP per day", () => {
    expect(computeXp({ ...baseXp, previouslyCorrect: true }).xp).toBe(4);
    expect(computeXp({ ...baseXp, previouslyCorrect: true, repeatXpToday: 98 }).xp).toBe(2);
    expect(computeXp({ ...baseXp, previouslyCorrect: true, repeatXpToday: 100 }).xp).toBe(0);
  });
});

describe("levels", () => {
  it("follows 50 * n * (n - 1)", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(4500)).toBe(10);
    expect(levelForXp(10_000_000)).toBe(50);
    expect(levelProgress(150)).toEqual({ level: 2, title: "Rookie", current: 50, needed: 200 });
  });
});

describe("dates", () => {
  it("uses the tenant calendar", () => {
    // 20:00 UTC is already the next day in India.
    expect(localDate(new Date("2026-10-22T20:00:00Z"))).toBe("2026-10-23");
    expect(localDate(new Date("2026-10-22T20:00:00Z"), "UTC")).toBe("2026-10-22");
  });
  it("computes ISO weeks", () => {
    expect(isoWeekKey("2026-10-22")).toBe("2026-W43");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
  });
});

describe("streaks", () => {
  const day = "2026-10-01";
  it("starts, extends and ignores repeat days", () => {
    let s = recordActivity(EMPTY_STREAK, day).state;
    expect(s.current).toBe(1);
    s = recordActivity(s, day).state;
    expect(s.current).toBe(1);
    s = recordActivity(s, addDays(day, 1)).state;
    expect(s.current).toBe(2);
  });
  it("spends freezes on missed days, then breaks", () => {
    let s = recordActivity(EMPTY_STREAK, day).state;
    s = recordActivity(s, addDays(day, 1)).state;
    const u = recordActivity(s, addDays(day, 4)); // missed 2 days, 2 freezes
    expect(u.freezesUsed).toBe(2);
    expect(u.state.current).toBe(3);
    expect(u.state.freezesLeft).toBe(0);
    const broken = recordActivity(u.state, addDays(day, 6));
    expect(broken.broken).toBe(true);
    expect(broken.state.current).toBe(1);
    expect(broken.state.longest).toBe(3);
  });
  it("refills freezes each month", () => {
    let s = recordActivity(EMPTY_STREAK, "2026-10-30").state;
    s = { ...s, freezesLeft: 0 };
    const u = recordActivity(s, "2026-11-02"); // missed Oct 31, Nov 1
    expect(u.broken).toBe(false);
    expect(u.state.freezesLeft).toBe(0);
  });
  it("skips weekends when they are optional", () => {
    const rules = { freezesPerMonth: 0, weekendsOptional: true };
    const fri = "2026-10-23";
    const s = recordActivity({ ...EMPTY_STREAK, freezesLeft: 0 }, fri, rules).state;
    const mon = recordActivity(s, "2026-10-26", rules);
    expect(mon.broken).toBe(false);
    expect(mon.state.current).toBe(2);
  });
  it("reports at-risk and lost streaks for display", () => {
    const s = recordActivity(EMPTY_STREAK, day).state;
    expect(currentStreak(s, day)).toEqual({ days: 1, activeToday: true, atRisk: false });
    expect(currentStreak(s, addDays(day, 1))).toEqual({ days: 1, activeToday: false, atRisk: true });
    expect(currentStreak(s, addDays(day, 5)).days).toBe(0);
  });
});

describe("hearts", () => {
  const t0 = new Date("2026-10-22T10:00:00Z");
  it("loses and refills over time", () => {
    let h = loseHeart({ hearts: MAX_HEARTS, updatedAt: t0 }, t0);
    h = loseHeart(h, t0);
    expect(h.hearts).toBe(3);
    expect(heartsAt(h, new Date(t0.getTime() + HEART_REFILL_MS - 1)).hearts).toBe(3);
    expect(heartsAt(h, new Date(t0.getTime() + HEART_REFILL_MS)).hearts).toBe(4);
    expect(heartsAt(h, new Date(t0.getTime() + 10 * HEART_REFILL_MS)).hearts).toBe(5);
  });
  it("does not go below zero", () => {
    expect(loseHeart({ hearts: 0, updatedAt: t0 }, t0).hearts).toBe(0);
  });
});

describe("leagues", () => {
  it("sizes zones for a full group of 30", () => {
    expect(zoneSizes(30)).toEqual({ promote: 7, demote: 5 });
    expect(zoneSizes(3)).toEqual({ promote: 1, demote: 0 });
  });
  it("promotes the top and demotes the bottom", () => {
    const members = Array.from({ length: 30 }, (_, i) => ({ userId: `u${String(i).padStart(2, "0")}`, division: "silver" as const, weeklyXp: 300 - i * 10 }));
    const out = closeWeek(members);
    expect(out.filter((o) => o.result === "promoted").map((o) => o.userId)).toEqual(["u00", "u01", "u02", "u03", "u04", "u05", "u06"]);
    expect(out.filter((o) => o.result === "demoted")).toHaveLength(5);
    expect(out.find((o) => o.userId === "u00")!.nextDivision).toBe("gold");
    expect(out.find((o) => o.userId === "u29")!.nextDivision).toBe("bronze");
  });
  it("does not promote students with zero XP or demote out of bronze", () => {
    const out = closeWeek([
      { userId: "a", division: "bronze", weeklyXp: 0 },
      { userId: "b", division: "bronze", weeklyXp: 0 },
    ]);
    expect(out.every((o) => o.result === "stayed")).toBe(true);
  });
});

describe("ratings and readiness", () => {
  it("moves ratings in the right direction", () => {
    const r = updateRatings({ rating: 1000, attempts: 0 }, { rating: 1000, attempts: 0 }, true);
    expect(r.playerRating).toBeGreaterThan(1000);
    expect(r.questionRating).toBeLessThan(1000);
    expect(masteryFromRating(600)).toBe(0);
    expect(masteryFromRating(1800)).toBe(100);
    expect(masteryFromRating(1200)).toBe(50);
  });
  it("weights skills, decays stale ones and counts unattempted as zero", () => {
    const profile = { id: "t", name: "Test", weights: { loops: 1, arrays: 1 } };
    const topics = groupSkillsByTopic(["loops.for", "loops.while", "arrays.basics"]);
    const today = "2026-10-22";
    const r = computeReadiness(
      profile,
      [
        { skillId: "loops.for", mastery: 80, lastPractisedAt: today },
        { skillId: "loops.while", mastery: 60, lastPractisedAt: "2026-06-01" }, // old: decays to 0.5
        // arrays.basics never attempted
      ],
      topics,
      today,
    );
    expect(r.components.find((c) => c.key === "loops")!.mastery).toBe(55); // (80 + 30) / 2
    expect(r.score).toBe(28); // (55 + 0) / 2 rounded
    expect(READINESS_PROFILES.length).toBeGreaterThan(0);
  });
});

describe("permissions and badges", () => {
  it("maps roles to permissions", () => {
    expect(can(["faculty"], "assignments.manage")).toBe(true);
    expect(can(["student"], "assignments.manage")).toBe(false);
    expect(can(["student", "tpo"], "analytics.institution")).toBe(true);
  });
  it("derives badges from stats", () => {
    const codes = earnedBadges({ correctAnswers: 1, longestStreak: 7, level: 3, masteredSkills: 0, missionsPassed: 0, perfectSessions: 0 }).map((b) => b.code);
    expect(codes).toEqual(["first_blood", "streak_7"]);
  });
});
