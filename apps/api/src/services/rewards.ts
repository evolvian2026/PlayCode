import { eq } from "drizzle-orm";
import { isoWeekKey, levelForXp, recordActivity, type StreakRules } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { playerProfiles } from "../db/schema";
import { addWeeklyXp } from "./leagues";
import { getOrCreateProfile, streakColumns, streakState } from "./profile";

/**
 * Award XP for activity outside practice sessions (duels, events): adds XP,
 * counts toward the weekly league and keeps the streak alive.
 */
export async function awardActivity(
  tx: DbOrTx,
  args: { userId: string; tenantId: string; xp: number; today: string; now: Date; rules: StreakRules },
) {
  const profile = await getOrCreateProfile(tx, args.userId, args.tenantId, true);
  const streak = recordActivity(streakState(profile), args.today, args.rules);
  const [updated] = await tx
    .update(playerProfiles)
    .set({ xp: profile.xp + args.xp, ...streakColumns(streak.state), updatedAt: args.now })
    .where(eq(playerProfiles.userId, args.userId))
    .returning();
  await addWeeklyXp(tx, { tenantId: args.tenantId, userId: args.userId, division: profile.division, weekKey: isoWeekKey(args.today), xp: args.xp });
  return { profile: updated!, levelUp: levelForXp(updated!.xp) > levelForXp(profile.xp) };
}
