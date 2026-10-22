import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  closeWeek,
  DEFAULT_LEAGUE_RULES,
  rankMembers,
  zoneForRank,
  type Division,
} from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { leagueMembers, playerProfiles, users } from "../db/schema";

/**
 * Add XP to the student's league group for the week, joining a group on the
 * first XP of the week (the lowest-numbered group in their division with room).
 */
export async function addWeeklyXp(
  tx: DbOrTx,
  args: { tenantId: string; userId: string; division: Division; weekKey: string; xp: number },
): Promise<void> {
  const [existing] = await tx
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.userId, args.userId), eq(leagueMembers.weekKey, args.weekKey)));
  if (existing) {
    if (args.xp > 0) {
      await tx
        .update(leagueMembers)
        .set({ weeklyXp: sql`${leagueMembers.weeklyXp} + ${args.xp}` })
        .where(eq(leagueMembers.id, existing.id));
    }
    return;
  }
  const groups = await tx
    .select({ groupNo: leagueMembers.groupNo, count: sql<number>`count(*)::int` })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.tenantId, args.tenantId), eq(leagueMembers.weekKey, args.weekKey), eq(leagueMembers.division, args.division)))
    .groupBy(leagueMembers.groupNo)
    .orderBy(asc(leagueMembers.groupNo));
  const open = groups.find((g) => g.count < DEFAULT_LEAGUE_RULES.groupSize);
  const groupNo = open?.groupNo ?? (groups.at(-1)?.groupNo ?? 0) + 1;
  await tx
    .insert(leagueMembers)
    .values({ tenantId: args.tenantId, userId: args.userId, weekKey: args.weekKey, division: args.division, groupNo, weeklyXp: args.xp })
    .onConflictDoUpdate({
      target: [leagueMembers.userId, leagueMembers.weekKey],
      set: { weeklyXp: sql`${leagueMembers.weeklyXp} + ${args.xp}` },
    });
}

export async function leagueStandings(db: DbOrTx, args: { tenantId: string; userId: string; weekKey: string; division: Division }) {
  const [me] = await db
    .select()
    .from(leagueMembers)
    .where(and(eq(leagueMembers.userId, args.userId), eq(leagueMembers.weekKey, args.weekKey)));
  if (!me) return { weekKey: args.weekKey, division: args.division, joined: false as const, members: [] };
  const rows = await db
    .select({ userId: leagueMembers.userId, weeklyXp: leagueMembers.weeklyXp, name: users.name })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .where(
      and(
        eq(leagueMembers.tenantId, args.tenantId),
        eq(leagueMembers.weekKey, args.weekKey),
        eq(leagueMembers.division, me.division),
        eq(leagueMembers.groupNo, me.groupNo),
      ),
    );
  const ranked = rankMembers(rows);
  return {
    weekKey: args.weekKey,
    division: me.division,
    joined: true as const,
    members: ranked.map((m) => ({
      userId: m.userId,
      name: m.name,
      weeklyXp: m.weeklyXp,
      rank: m.rank,
      isMe: m.userId === args.userId,
      zone: zoneForRank(m.rank, ranked.length, me.division),
    })),
  };
}

/**
 * Close one tenant's week: record results and move students between divisions.
 * Safe to re-run: groups already closed are skipped.
 */
export async function closeLeagueWeek(tx: DbOrTx, tenantId: string, weekKey: string) {
  const rows = await tx
    .select()
    .from(leagueMembers)
    .where(and(eq(leagueMembers.tenantId, tenantId), eq(leagueMembers.weekKey, weekKey), isNull(leagueMembers.result)));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.division}:${r.groupNo}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const summary = { groups: groups.size, promoted: 0, demoted: 0, stayed: 0 };
  for (const members of groups.values()) {
    for (const outcome of closeWeek(members)) {
      summary[outcome.result]++;
      await tx
        .update(leagueMembers)
        .set({ result: outcome.result, finalRank: outcome.rank })
        .where(and(eq(leagueMembers.userId, outcome.userId), eq(leagueMembers.weekKey, weekKey)));
      if (outcome.result !== "stayed") {
        await tx.update(playerProfiles).set({ division: outcome.nextDivision }).where(eq(playerProfiles.userId, outcome.userId));
      }
    }
  }
  return summary;
}
