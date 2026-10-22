import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { competitions, duelPlayers, duels, memberships, orgUnits, responses, tenants } from "../db/schema";
import { notFound } from "../lib/errors";
import { descendants, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits } from "./scope";

// Events: sections (inside one institution) or colleges (platform-run)
// compete on XP earned during the event window. Teams are ranked by XP per
// member so a small section can beat a big one.

type CompetitionRow = typeof competitions.$inferSelect;

async function teamMembers(db: DbOrTx, c: CompetitionRow): Promise<{ teamId: string; name: string; members: string[] }[]> {
  if (c.scope === "colleges") {
    const ts = await db.select().from(tenants).where(inArray(tenants.id, c.teamIds));
    const out = [];
    for (const t of ts) {
      const members = await db
        .selectDistinct({ id: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, t.id), eq(memberships.role, "student")));
      out.push({ teamId: t.id, name: t.name, members: members.map((m) => m.id) });
    }
    return out;
  }
  const units = await tenantUnits(db, c.tenantId!);
  return Promise.all(
    c.teamIds.map(async (id) => ({
      teamId: id,
      name: units.find((u) => u.id === id)?.name ?? "Unknown",
      members: await studentIdsInUnits(db, c.tenantId!, descendants(units, [id])),
    })),
  );
}

export async function leaderboard(db: DbOrTx, c: CompetitionRow, now: Date) {
  const end = now < c.endsAt ? now : c.endsAt;
  const teams = await teamMembers(db, c);
  const all = teams.flatMap((t) => t.members);
  const xpByUser = new Map<string, number>();
  const activeUsers = new Set<string>();
  if (all.length && now > c.startsAt) {
    const practice = await db
      .select({ userId: responses.userId, xp: sql<number>`sum(${responses.xp})::int` })
      .from(responses)
      .where(and(inArray(responses.userId, all), gte(responses.createdAt, c.startsAt), lte(responses.createdAt, end)))
      .groupBy(responses.userId);
    for (const p of practice) {
      xpByUser.set(p.userId, (xpByUser.get(p.userId) ?? 0) + p.xp);
      activeUsers.add(p.userId);
    }
    const duelXp = await db
      .select({ userId: duelPlayers.userId, xp: sql<number>`sum(${duelPlayers.xp})::int` })
      .from(duelPlayers)
      .innerJoin(duels, eq(duels.id, duelPlayers.duelId))
      .where(and(inArray(duelPlayers.userId, all), gte(duels.finishedAt, c.startsAt), lte(duels.finishedAt, end)))
      .groupBy(duelPlayers.userId);
    for (const d of duelXp) {
      xpByUser.set(d.userId, (xpByUser.get(d.userId) ?? 0) + d.xp);
      if (d.xp > 0) activeUsers.add(d.userId);
    }
  }
  const rows = teams.map((t) => {
    const total = t.members.reduce((a, id) => a + (xpByUser.get(id) ?? 0), 0);
    return {
      teamId: t.teamId,
      name: t.name,
      members: t.members.length,
      activeMembers: t.members.filter((id) => activeUsers.has(id)).length,
      totalXp: total,
      score: t.members.length ? Math.round((total / t.members.length) * 10) / 10 : 0,
    };
  });
  rows.sort((a, b) => b.score - a.score || b.totalXp - a.totalXp);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function competitionState(c: CompetitionRow, now: Date): "upcoming" | "live" | "ended" {
  return now < c.startsAt ? "upcoming" : now > c.endsAt ? "ended" : "live";
}

/** Events a tenant's staff can see: their own, plus inter-college events they are part of. */
export async function tenantCompetitions(db: Db, tenantId: string) {
  return db
    .select()
    .from(competitions)
    .where(or(eq(competitions.tenantId, tenantId), and(isNull(competitions.tenantId), sql`${competitions.teamIds} ? ${tenantId}`)))
    .orderBy(sql`${competitions.startsAt} desc`);
}

export async function getCompetition(db: Db, tenantId: string, id: string): Promise<CompetitionRow> {
  const rows = (await tenantCompetitions(db, tenantId)).filter((c) => c.id === id);
  if (!rows[0]) throw notFound("Event");
  return rows[0];
}

/** Events a student takes part in (live, upcoming, or ended in the last week), with their team. */
export async function studentCompetitions(db: Db, args: { userId: string; tenantId: string; now: Date }) {
  const myUnits = new Set(await studentUnitIdsWithAncestors(db, args.tenantId, args.userId));
  const recent = new Date(args.now.getTime() - 7 * 86_400_000);
  const all = (await tenantCompetitions(db, args.tenantId)).filter((c) => c.endsAt > recent);
  const out = [];
  for (const c of all) {
    const myTeam = c.scope === "colleges" ? args.tenantId : c.teamIds.find((id) => myUnits.has(id));
    if (!myTeam) continue;
    const board = await leaderboard(db, c, args.now);
    out.push({
      id: c.id,
      title: c.title,
      description: c.description,
      scope: c.scope,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      state: competitionState(c, args.now),
      myTeam: board.find((r) => r.teamId === myTeam) ?? null,
      leaderboard: board.slice(0, 10),
    });
  }
  return out;
}

export async function unitNames(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(inArray(orgUnits.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
