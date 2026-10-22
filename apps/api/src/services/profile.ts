import { eq } from "drizzle-orm";
import { currentStreak, heartsAt, levelProgress, nextHeartInMs, type StreakRules, type StreakState } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { playerProfiles } from "../db/schema";

export type PlayerProfile = typeof playerProfiles.$inferSelect;

export async function getOrCreateProfile(db: DbOrTx, userId: string, tenantId: string, forUpdate = false): Promise<PlayerProfile> {
  const query = db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId));
  const [existing] = forUpdate ? await query.for("update") : await query;
  if (existing) return existing;
  await db.insert(playerProfiles).values({ userId, tenantId }).onConflictDoNothing();
  const again = db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId));
  const [created] = forUpdate ? await again.for("update") : await again;
  return created!;
}

export function streakState(p: PlayerProfile): StreakState {
  return {
    current: p.streakCurrent,
    longest: p.streakLongest,
    lastActiveDate: p.streakLastDate,
    freezesLeft: p.freezesLeft,
    freezesMonth: p.freezesMonth,
  };
}

export function streakColumns(s: StreakState) {
  return {
    streakCurrent: s.current,
    streakLongest: s.longest,
    streakLastDate: s.lastActiveDate,
    freezesLeft: s.freezesLeft,
    freezesMonth: s.freezesMonth,
  };
}

/** What the student app shows in its header. */
export function profileSummary(p: PlayerProfile, today: string, now: Date, rules: StreakRules) {
  const streak = currentStreak(streakState(p), today, rules);
  const hearts = heartsAt({ hearts: p.hearts, updatedAt: p.heartsUpdatedAt }, now);
  return {
    xp: p.xp,
    ...levelProgress(p.xp),
    streak: { ...streak, longest: p.streakLongest, freezesLeft: p.freezesMonth === today.slice(0, 7) ? p.freezesLeft : rules.freezesPerMonth },
    hearts: hearts.hearts,
    nextHeartInMs: nextHeartInMs({ hearts: p.hearts, updatedAt: p.heartsUpdatedAt }, now),
    division: p.division,
  };
}
