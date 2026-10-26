import { randomInt } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { addDays, currentStreak, isoWeekKey, weekday } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { playerProfiles, responses, squadMembers, squads, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox, type NewNotification } from "./notifications";
import { streakState } from "./profile";
import { getTenant, streakRules, tenantToday } from "./tenant";

// Study squads: up to six classmates who share a weekly goal of answers. The
// squad's streak counts weeks in a row that hit the goal. Squadmates see each
// other's effort (answers this week, their streak) but not scores or mastery,
// and can nudge someone who hasn't practised today.

export const MAX_MEMBERS = 6;
export const GOALS = [50, 100, 150, 200, 300] as const;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Weeks looked back for the squad streak. */
const HISTORY_WEEKS = 26;

type Ctx = { tenantId: string; userId: string; now: Date };
type Squad = typeof squads.$inferSelect;

async function membershipOf(db: DbOrTx, userId: string) {
  const [m] = await db.select().from(squadMembers).innerJoin(squads, eq(squads.id, squadMembers.squadId)).where(eq(squadMembers.userId, userId));
  return m ? m.squads : null;
}

/** Answers per ISO week (in the institution's time zone) by the given students. */
async function answersByWeek(db: DbOrTx, userIds: string[], timeZone: string, since: Date) {
  if (!userIds.length) return new Map<string, number>();
  const rows = await db
    .select({ week: sql<string>`to_char(${responses.createdAt} at time zone ${timeZone}, 'IYYY-"W"IW')`, n: sql<number>`count(*)::int` })
    .from(responses)
    .where(and(inArray(responses.userId, userIds), gte(responses.createdAt, since)))
    .groupBy(sql`1`);
  return new Map(rows.map((r) => [r.week, r.n]));
}

/** Weeks in a row the squad hit its goal, counting back from last week (and this week, once it's hit). Weeks before the squad existed don't count. */
export function squadStreak(byWeek: Map<string, number>, goal: number, thisWeek: string, today: string, createdWeek: string) {
  let streak = (byWeek.get(thisWeek) ?? 0) >= goal ? 1 : 0;
  for (let k = 1; k <= HISTORY_WEEKS; k++) {
    const week = isoWeekKey(addDays(today, -7 * k));
    if (week < createdWeek || (byWeek.get(week) ?? 0) < goal) break;
    streak++;
  }
  return streak;
}

async function squadView(db: Db, ctx: Ctx, squad: Squad) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const thisWeek = isoWeekKey(today);
  const members = await db
    .select({ id: users.id, name: users.name, joinedAt: squadMembers.joinedAt, profile: playerProfiles })
    .from(squadMembers)
    .innerJoin(users, eq(users.id, squadMembers.userId))
    .leftJoin(playerProfiles, eq(playerProfiles.userId, squadMembers.userId))
    .where(eq(squadMembers.squadId, squad.id));
  const ids = members.map((m) => m.id);
  const total = await answersByWeek(db, ids, tenant.timeZone, new Date(ctx.now.getTime() - (HISTORY_WEEKS + 1) * 7 * 86_400_000));
  const mineThisWeek = ids.length
    ? await db
        .select({ userId: responses.userId, n: sql<number>`count(*)::int` })
        .from(responses)
        .where(and(inArray(responses.userId, ids), sql`to_char(${responses.createdAt} at time zone ${tenant.timeZone}, 'IYYY-"W"IW') = ${thisWeek}`))
        .groupBy(responses.userId)
    : [];
  const answers = total.get(thisWeek) ?? 0;
  const rules = streakRules(tenant);
  return {
    id: squad.id,
    name: squad.name,
    code: squad.code,
    weeklyGoal: squad.weeklyGoal,
    canEditGoal: squad.createdBy === ctx.userId,
    week: { answers, goal: squad.weeklyGoal, reached: answers >= squad.weeklyGoal, daysLeft: 7 - ((weekday(today) + 6) % 7) },
    streakWeeks: squadStreak(total, squad.weeklyGoal, thisWeek, today, isoWeekKey(tenantToday(tenant, squad.createdAt))),
    members: members
      .map((m) => ({
        id: m.id,
        name: m.name,
        me: m.id === ctx.userId,
        answersThisWeek: mineThisWeek.find((x) => x.userId === m.id)?.n ?? 0,
        streak: m.profile ? currentStreak(streakState(m.profile), today, rules).days : 0,
        practisedToday: m.profile?.streakLastDate === today,
      }))
      .sort((a, b) => b.answersThisWeek - a.answersThisWeek || a.name.localeCompare(b.name)),
    maxMembers: MAX_MEMBERS,
  };
}

export async function mySquad(db: Db, ctx: Ctx) {
  const squad = await membershipOf(db, ctx.userId);
  return { squad: squad ? await squadView(db, ctx, squad) : null, goals: GOALS };
}

async function newCode(db: Db): Promise<string> {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
    const [taken] = await db.select({ id: squads.id }).from(squads).where(eq(squads.code, code));
    if (!taken) return code;
  }
}

export async function createSquad(db: Db, ctx: Ctx, input: { name: string; weeklyGoal: number }) {
  if (await membershipOf(db, ctx.userId)) throw conflict("already_in_squad", "Leave your squad before starting a new one");
  const squad = await db.transaction(async (tx) => {
    const [s] = await tx.insert(squads).values({ tenantId: ctx.tenantId, name: input.name, code: await newCode(db), weeklyGoal: input.weeklyGoal, createdBy: ctx.userId, createdAt: ctx.now }).returning();
    await tx.insert(squadMembers).values({ userId: ctx.userId, squadId: s!.id, joinedAt: ctx.now });
    return s!;
  });
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "squad.create", target: squad.id });
  return mySquad(db, ctx);
}

export async function joinSquad(db: Db, ctx: Ctx, code: string) {
  const [squad] = await db.select().from(squads).where(and(eq(squads.code, code.trim().toUpperCase()), eq(squads.tenantId, ctx.tenantId)));
  // Another college's code looks the same as a wrong one.
  if (!squad) throw notFound("Squad");
  const current = await membershipOf(db, ctx.userId);
  if (current?.id === squad.id) return mySquad(db, ctx);
  if (current) throw conflict("already_in_squad", "Leave your squad before joining another");
  await db.transaction(async (tx) => {
    // Lock the squad so two people can't both take the last place.
    await tx.select().from(squads).where(eq(squads.id, squad.id)).for("update");
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(squadMembers).where(eq(squadMembers.squadId, squad.id));
    if (n >= MAX_MEMBERS) throw conflict("squad_full", `This squad already has ${MAX_MEMBERS} members`);
    await tx.insert(squadMembers).values({ userId: ctx.userId, squadId: squad.id, joinedAt: ctx.now });
  });
  return mySquad(db, ctx);
}

/** Leave; the last one out closes the squad. */
export async function leaveSquad(db: DbOrTx, userId: string) {
  const squad = await membershipOf(db, userId);
  if (!squad) return;
  await db.delete(squadMembers).where(eq(squadMembers.userId, userId));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(squadMembers).where(eq(squadMembers.squadId, squad.id));
  if (n === 0) await db.delete(squads).where(eq(squads.id, squad.id));
}

export async function setGoal(db: Db, ctx: Ctx, weeklyGoal: number) {
  const squad = await membershipOf(db, ctx.userId);
  if (!squad) throw notFound("Squad");
  if (squad.createdBy !== ctx.userId) throw forbidden("Only the person who started the squad can change its goal");
  await db.update(squads).set({ weeklyGoal }).where(eq(squads.id, squad.id));
  return mySquad(db, ctx);
}

/** Remind a squadmate who hasn't practised today; once a day per person. */
export async function nudge(db: Db, ctx: Ctx, targetId: string) {
  const squad = await membershipOf(db, ctx.userId);
  if (!squad || targetId === ctx.userId) throw badRequest("You can nudge someone else in your squad");
  const target = await membershipOf(db, targetId);
  if (target?.id !== squad.id) throw notFound("Squadmate");
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const [profile] = await db.select({ last: playerProfiles.streakLastDate }).from(playerProfiles).where(eq(playerProfiles.userId, targetId));
  if (profile?.last === today) throw conflict("already_practised", "They've already practised today");
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  const first = me!.name.split(/\s+/)[0];
  const sent = await enqueue(db, [
    {
      tenantId: ctx.tenantId,
      userId: targetId,
      template: "squad",
      title: `${first} nudged you`,
      body: `${squad.name} needs your answers today. A few minutes keeps your streak and the squad's going.`,
      link: appLink("/play/squad"),
      dedupeKey: `squad-nudge:${ctx.userId}:${targetId}:${today}`,
      sentBy: ctx.userId,
    },
  ]);
  if (!sent) throw conflict("already_nudged", "You've already nudged them today");
  void processOutbox(db, ctx.now).catch(() => {});
  return { ok: true };
}

/** Hour of the day in a time zone (0-23). */
function localHour(now: Date, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/**
 * Hourly: tell a squad when it reaches its goal, and on Friday evening when it's
 * well short (under 60%) with the weekend left. Each at most once a week.
 */
export async function squadReminders(db: Db, now: Date) {
  const rows = await db.select({ squad: squads, timeZone: tenants.timeZone }).from(squads).innerJoin(tenants, eq(tenants.id, squads.tenantId));
  const items: NewNotification[] = [];
  for (const { squad, timeZone } of rows) {
    const members = (await db.select({ userId: squadMembers.userId }).from(squadMembers).where(eq(squadMembers.squadId, squad.id))).map((m) => m.userId);
    if (!members.length) continue;
    const today = tenantToday({ timeZone }, now);
    const week = isoWeekKey(today);
    const answers = (await answersByWeek(db, members, timeZone, new Date(now.getTime() - 8 * 86_400_000))).get(week) ?? 0;
    const reached = answers >= squad.weeklyGoal;
    const behind = weekday(today) === 5 && localHour(now, timeZone) >= 17 && answers < squad.weeklyGoal * 0.6;
    if (!reached && !behind) continue;
    for (const userId of members) {
      items.push(
        reached
          ? { tenantId: squad.tenantId, userId, template: "squad", title: `${squad.name} hit its goal`, body: `${answers} answers this week against a goal of ${squad.weeklyGoal}. The squad streak goes on.`, link: appLink("/play/squad"), dedupeKey: `squad-goal:${squad.id}:${week}:${userId}` }
          : { tenantId: squad.tenantId, userId, template: "squad", title: `${squad.name} needs a push`, body: `${answers} of ${squad.weeklyGoal} answers so far this week, with the weekend left.`, link: appLink("/play/squad"), dedupeKey: `squad-behind:${squad.id}:${week}:${userId}` },
      );
    }
  }
  return enqueue(db, items);
}
