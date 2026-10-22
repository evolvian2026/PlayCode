import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  DUEL_COUNTDOWN_MS,
  DUEL_DAILY_XP_LIMIT,
  DUEL_INVITE_TTL_MS,
  DUEL_QUESTIONS,
  DUEL_SECONDS,
  duelOutcome,
  duelRatings,
  duelXp,
  grade,
  hashString,
  shuffle,
  toStudentView,
  type StudentResponse,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { duelPlayers, duels, memberships, playerProfiles, questions, users } from "../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { publish } from "../lib/realtime";
import { getOrCreateProfile } from "./profile";
import { quickVisibleTo, toCoreQuestion, type StudentCtx } from "./practice";
import { awardActivity } from "./rewards";
import { getTenant, streakRules, tenantToday } from "./tenant";

type DuelRow = typeof duels.$inferSelect;
type PlayerRow = typeof duelPlayers.$inferSelect;

/** Matchmaking pairs students whose duel ratings are within this range. */
const MATCH_RANGE = 300;

function notifyBoth(d: DuelRow, event: Record<string, unknown>) {
  for (const id of [d.challengerId, d.opponentId]) if (id) publish(id, { type: "duel", duelId: d.id, ...event });
}

async function lockDuel(tx: DbOrTx, id: string): Promise<DuelRow> {
  const [d] = await tx.select().from(duels).where(eq(duels.id, id)).for("update");
  if (!d) throw notFound("Duel");
  return d;
}

/** Pick the questions, create both player rows and start the countdown. */
async function activate(tx: DbOrTx, d: DuelRow, opponentId: string, now: Date): Promise<DuelRow> {
  const pool = await tx.select({ id: questions.id }).from(questions).where(quickVisibleTo(d.tenantId)).orderBy(questions.id);
  const questionIds = shuffle(pool.map((p) => p.id), hashString(d.id)).slice(0, DUEL_QUESTIONS);
  const startsAt = new Date(now.getTime() + DUEL_COUNTDOWN_MS);
  const [updated] = await tx
    .update(duels)
    .set({ status: "active", opponentId, questionIds, startsAt, endsAt: new Date(startsAt.getTime() + DUEL_SECONDS * 1000) })
    .where(eq(duels.id, d.id))
    .returning();
  for (const userId of [d.challengerId, opponentId]) {
    const profile = await getOrCreateProfile(tx, userId, d.tenantId);
    await tx.insert(duelPlayers).values({ duelId: d.id, userId, ratingBefore: profile.duelRating });
  }
  return updated!;
}

async function bothStudents(db: DbOrTx, tenantId: string, a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ userId: memberships.userId, unit: memberships.orgUnitId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, [a, b])));
  return rows.length > 0 && rows.some((r) => r.userId === b) && rows.some((r) => r.userId === a);
}

export async function createDuel(db: Db, ctx: StudentCtx, input: { opponentId?: string }) {
  const result = await db.transaction(async (tx) => {
    // One live duel at a time.
    const [live] = await tx
      .select()
      .from(duels)
      .where(
        and(
          eq(duels.tenantId, ctx.tenantId),
          inArray(duels.status, ["waiting", "active"]),
          or(eq(duels.challengerId, ctx.userId), and(eq(duels.opponentId, ctx.userId), eq(duels.status, "active"))),
        ),
      );
    if (live && !(live.status === "waiting" && ctx.now.getTime() - live.createdAt.getTime() > DUEL_INVITE_TTL_MS)) {
      return live;
    }
    if (live) await tx.update(duels).set({ status: "expired" }).where(eq(duels.id, live.id));

    if (input.opponentId) {
      if (input.opponentId === ctx.userId) throw badRequest("You cannot duel yourself");
      if (!(await bothStudents(tx, ctx.tenantId, ctx.userId, input.opponentId))) throw forbidden("You can only challenge students at your institution");
      const [d] = await tx.insert(duels).values({ tenantId: ctx.tenantId, challengerId: ctx.userId, opponentId: input.opponentId, createdAt: ctx.now }).returning();
      return d!;
    }

    // Matchmaking: join the oldest open duel from a similarly rated student.
    const me = await getOrCreateProfile(tx, ctx.userId, ctx.tenantId);
    const since = new Date(ctx.now.getTime() - DUEL_INVITE_TTL_MS);
    const [open] = await tx
      .select({ duel: duels })
      .from(duels)
      .innerJoin(playerProfiles, eq(playerProfiles.userId, duels.challengerId))
      .where(
        and(
          eq(duels.tenantId, ctx.tenantId),
          eq(duels.status, "waiting"),
          isNull(duels.opponentId),
          ne(duels.challengerId, ctx.userId),
          gte(duels.createdAt, since),
          sql`abs(${playerProfiles.duelRating} - ${me.duelRating}) <= ${MATCH_RANGE}`,
        ),
      )
      .orderBy(duels.createdAt)
      .limit(1)
      .for("update", { of: duels, skipLocked: true });
    if (open) return activate(tx, open.duel, ctx.userId, ctx.now);
    const [d] = await tx.insert(duels).values({ tenantId: ctx.tenantId, challengerId: ctx.userId, createdAt: ctx.now }).returning();
    return d!;
  });
  if (result.status === "active") notifyBoth(result, { event: "started" });
  else if (result.opponentId) publish(result.opponentId, { type: "duel_invite", duelId: result.id });
  return getDuel(db, ctx, result.id);
}

export async function respondToInvite(db: Db, ctx: StudentCtx, duelId: string, accept: boolean) {
  const d = await db.transaction(async (tx) => {
    const d = await lockDuel(tx, duelId);
    if (d.opponentId !== ctx.userId || d.status !== "waiting") throw conflict("not_pending", "This challenge is no longer waiting for you");
    if (ctx.now.getTime() - d.createdAt.getTime() > DUEL_INVITE_TTL_MS) {
      await tx.update(duels).set({ status: "expired" }).where(eq(duels.id, d.id));
      throw conflict("expired", "This challenge has expired");
    }
    if (!accept) {
      const [declined] = await tx.update(duels).set({ status: "declined" }).where(eq(duels.id, d.id)).returning();
      return declined!;
    }
    return activate(tx, d, ctx.userId, ctx.now);
  });
  notifyBoth(d, { event: d.status === "active" ? "started" : "declined" });
  return getDuel(db, ctx, d.id);
}

export async function cancelDuel(db: Db, ctx: StudentCtx, duelId: string) {
  const d = await db.transaction(async (tx) => {
    const d = await lockDuel(tx, duelId);
    if (d.challengerId !== ctx.userId || d.status !== "waiting") throw conflict("not_cancellable", "Only a waiting challenge can be cancelled");
    const [c] = await tx.update(duels).set({ status: "cancelled" }).where(eq(duels.id, d.id)).returning();
    return c!;
  });
  notifyBoth(d, { event: "cancelled" });
  return { ok: true };
}

/** Score both players, move ratings, award XP. Called once, with the duel row locked. */
async function finalize(tx: DbOrTx, d: DuelRow, now: Date): Promise<DuelRow> {
  const players = await tx.select().from(duelPlayers).where(eq(duelPlayers.duelId, d.id));
  const [a, b] = [players.find((p) => p.userId === d.challengerId)!, players.find((p) => p.userId === d.opponentId)!];
  const full = DUEL_SECONDS * 1000;
  // Unfinished players are charged the full time, so finishing fast never loses to giving up.
  const score = (p: PlayerRow) => ({ userId: p.userId, correct: p.correct, timeMs: p.finishedAt ? p.timeMs : full });
  const outcome = duelOutcome(score(a), score(b));
  const ratings = duelRatings(a.ratingBefore, b.ratingBefore, outcome.a);
  const tenant = await getTenant(tx, d.tenantId);
  const today = tenantToday(tenant, now);
  const dayStart = new Date(now.getTime() - 24 * 3600_000);

  for (const [p, out, rating] of [
    [a, outcome.a, ratings.a],
    [b, outcome.b, ratings.b],
  ] as const) {
    // Only the first few duels a day earn XP, so duels cannot be farmed.
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(duelPlayers)
      .innerJoin(duels, eq(duels.id, duelPlayers.duelId))
      .where(and(eq(duelPlayers.userId, p.userId), gte(duels.finishedAt, dayStart), sql`${duelPlayers.xp} > 0`));
    const xp = count < DUEL_DAILY_XP_LIMIT ? duelXp(out, p.correct) : 0;
    await tx.update(duelPlayers).set({ outcome: out, ratingAfter: rating, xp }).where(and(eq(duelPlayers.duelId, d.id), eq(duelPlayers.userId, p.userId)));
    await tx
      .update(playerProfiles)
      .set({
        duelRating: rating,
        duelWins: sql`${playerProfiles.duelWins} + ${out === "win" ? 1 : 0}`,
        duelLosses: sql`${playerProfiles.duelLosses} + ${out === "loss" ? 1 : 0}`,
        duelDraws: sql`${playerProfiles.duelDraws} + ${out === "draw" ? 1 : 0}`,
      })
      .where(eq(playerProfiles.userId, p.userId));
    if (p.answers.length > 0) await awardActivity(tx, { userId: p.userId, tenantId: d.tenantId, xp, today, now, rules: streakRules(tenant) });
  }
  const winnerId = outcome.a === "win" ? a.userId : outcome.b === "win" ? b.userId : null;
  const [done] = await tx.update(duels).set({ status: "finished", finishedAt: now, winnerId }).where(eq(duels.id, d.id)).returning();
  return done!;
}

/** Expire stale invites and finish duels whose clock ran out. */
async function settle(db: Db, id: string, now: Date): Promise<void> {
  const [d] = await db.select().from(duels).where(eq(duels.id, id));
  if (!d) return;
  const staleInvite = d.status === "waiting" && now.getTime() - d.createdAt.getTime() > DUEL_INVITE_TTL_MS;
  const timeUp = d.status === "active" && d.endsAt && now > d.endsAt;
  if (!staleInvite && !timeUp) return;
  const finished = await db.transaction(async (tx) => {
    const locked = await lockDuel(tx, id);
    if (locked.status === "waiting") {
      await tx.update(duels).set({ status: "expired" }).where(eq(duels.id, id));
      return null;
    }
    if (locked.status === "active") return finalize(tx, locked, now);
    return null;
  });
  if (finished) notifyBoth(finished, { event: "finished" });
}

export async function getDuel(db: Db, ctx: StudentCtx, id: string) {
  await settle(db, id, ctx.now);
  const [d] = await db.select().from(duels).where(eq(duels.id, id));
  if (!d || d.tenantId !== ctx.tenantId) throw notFound("Duel");
  const isPlayer = d.challengerId === ctx.userId || d.opponentId === ctx.userId;
  if (!isPlayer) throw notFound("Duel");
  const players = await db.select().from(duelPlayers).where(eq(duelPlayers.duelId, d.id));
  const ids = [d.challengerId, d.opponentId].filter((x): x is string => Boolean(x));
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  const profiles = await db.select({ userId: playerProfiles.userId, duelRating: playerProfiles.duelRating }).from(playerProfiles).where(inArray(playerProfiles.userId, ids));
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const rating = (uid: string | null) => profiles.find((p) => p.userId === uid)?.duelRating ?? 1000;
  const mine = players.find((p) => p.userId === ctx.userId);
  const opponentId = d.challengerId === ctx.userId ? d.opponentId : d.challengerId;
  const theirs = players.find((p) => p.userId === opponentId);
  const started = d.status === "active" && d.startsAt !== null && ctx.now >= d.startsAt;
  const nextId = started && mine && !mine.finishedAt ? d.questionIds[mine.answers.length] : undefined;
  const [next] = nextId ? await db.select().from(questions).where(eq(questions.id, nextId)) : [];
  const side = (p: PlayerRow | undefined, uid: string | null) =>
    uid
      ? {
          userId: uid,
          name: name(uid),
          rating: p?.ratingBefore ?? rating(uid),
          answered: p?.answers.length ?? 0,
          correct: p?.correct ?? 0,
          finished: Boolean(p?.finishedAt),
          outcome: p?.outcome ?? null,
          ratingAfter: p?.ratingAfter ?? null,
          xp: p?.xp ?? 0,
        }
      : null;
  return {
    id: d.id,
    status: d.status,
    total: d.questionIds.length || DUEL_QUESTIONS,
    role: d.challengerId === ctx.userId ? "challenger" : "opponent",
    startsInMs: d.status === "active" && d.startsAt ? Math.max(0, d.startsAt.getTime() - ctx.now.getTime()) : null,
    timeLeftMs: d.status === "active" && d.endsAt ? Math.max(0, d.endsAt.getTime() - ctx.now.getTime()) : null,
    me: side(mine, ctx.userId),
    opponent: side(theirs, opponentId),
    question: next ? toStudentView(toCoreQuestion(next), d.id) : null,
    // After the duel, each player sees which questions they got right.
    review:
      d.status === "finished" && mine
        ? mine.answers.map((a, i) => ({ number: i + 1, questionId: a.questionId, correct: a.correct }))
        : null,
  };
}

export async function answerDuel(db: Db, ctx: StudentCtx, id: string, input: { questionId: string; response: StudentResponse }) {
  const event = await db.transaction(async (tx) => {
    const d = await lockDuel(tx, id);
    if (d.tenantId !== ctx.tenantId || (d.challengerId !== ctx.userId && d.opponentId !== ctx.userId)) throw notFound("Duel");
    if (d.status !== "active" || !d.startsAt || !d.endsAt) throw conflict("not_active", "This duel is not running");
    if (ctx.now < d.startsAt) throw conflict("not_started", "The duel has not started yet");
    if (ctx.now > d.endsAt) throw conflict("time_up", "Time is up");
    const [me] = await tx
      .select()
      .from(duelPlayers)
      .where(and(eq(duelPlayers.duelId, d.id), eq(duelPlayers.userId, ctx.userId)))
      .for("update");
    if (!me || me.finishedAt) throw conflict("finished", "You have already finished this duel");
    if (d.questionIds[me.answers.length] !== input.questionId) throw conflict("not_current", "That question is not your current one");
    const [q] = await tx.select().from(questions).where(eq(questions.id, input.questionId));
    if (!q) throw notFound("Question");
    const correct = grade(q.answer, input.response);
    // Time for this question runs from the previous answer (or the start).
    const elapsedTotal = ctx.now.getTime() - d.startsAt.getTime();
    const answers = [...me.answers, { questionId: q.id, correct, timeMs: elapsedTotal - me.timeMs }];
    const finished = answers.length >= d.questionIds.length;
    await tx
      .update(duelPlayers)
      .set({ answers, correct: me.correct + (correct ? 1 : 0), timeMs: elapsedTotal, finishedAt: finished ? ctx.now : null })
      .where(and(eq(duelPlayers.duelId, d.id), eq(duelPlayers.userId, ctx.userId)));
    const players = await tx.select().from(duelPlayers).where(eq(duelPlayers.duelId, d.id));
    const done = players.every((p) => (p.userId === ctx.userId ? finished : Boolean(p.finishedAt)));
    if (done) await finalize(tx, d, ctx.now);
    return { d, done, correct };
  });
  notifyBoth(event.d, { event: event.done ? "finished" : "progress" });
  return { correct: event.correct, duel: await getDuel(db, ctx, id) };
}

/** Lobby: invites, my open challenge, recent results and classmates to challenge. */
export async function duelLobby(db: Db, ctx: StudentCtx) {
  const since = new Date(ctx.now.getTime() - DUEL_INVITE_TTL_MS);
  const invites = await db
    .select({ id: duels.id, from: users.name, createdAt: duels.createdAt })
    .from(duels)
    .innerJoin(users, eq(users.id, duels.challengerId))
    .where(and(eq(duels.opponentId, ctx.userId), eq(duels.status, "waiting"), gte(duels.createdAt, since)));
  const [live] = await db
    .select()
    .from(duels)
    .where(
      and(
        eq(duels.tenantId, ctx.tenantId),
        or(eq(duels.challengerId, ctx.userId), and(eq(duels.opponentId, ctx.userId), eq(duels.status, "active"))),
        or(eq(duels.status, "active"), and(eq(duels.status, "waiting"), gte(duels.createdAt, since))),
      ),
    );
  const recentRows = await db
    .select({ duel: duels, me: duelPlayers })
    .from(duelPlayers)
    .innerJoin(duels, eq(duels.id, duelPlayers.duelId))
    .where(and(eq(duelPlayers.userId, ctx.userId), eq(duels.status, "finished")))
    .orderBy(desc(duels.finishedAt))
    .limit(10);
  const opponentIds = recentRows.map((r) => (r.duel.challengerId === ctx.userId ? r.duel.opponentId : r.duel.challengerId)).filter((x): x is string => Boolean(x));
  const names = opponentIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, opponentIds)) : [];

  // Classmates: students who share a section with me.
  const myUnits = await db
    .select({ unit: memberships.orgUnitId })
    .from(memberships)
    .where(and(eq(memberships.userId, ctx.userId), eq(memberships.role, "student")));
  const unitIds = myUnits.flatMap((m) => (m.unit ? [m.unit] : []));
  const classmates = unitIds.length
    ? await db
        .selectDistinct({ id: users.id, name: users.name, rating: playerProfiles.duelRating, lastActiveAt: users.lastActiveAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(playerProfiles, eq(playerProfiles.userId, users.id))
        .where(and(inArray(memberships.orgUnitId, unitIds), eq(memberships.role, "student"), ne(users.id, ctx.userId), eq(users.status, "active")))
    : [];
  const profile = await getOrCreateProfile(db, ctx.userId, ctx.tenantId);
  return {
    rating: profile.duelRating,
    record: { wins: profile.duelWins, losses: profile.duelLosses, draws: profile.duelDraws },
    invites,
    live: live ? { id: live.id, status: live.status, waitingForMatch: live.status === "waiting" && !live.opponentId } : null,
    recent: recentRows.map((r) => {
      const oid = r.duel.challengerId === ctx.userId ? r.duel.opponentId : r.duel.challengerId;
      return { id: r.duel.id, opponent: names.find((n) => n.id === oid)?.name ?? "Unknown", outcome: r.me.outcome, correct: r.me.correct, ratingChange: (r.me.ratingAfter ?? r.me.ratingBefore) - r.me.ratingBefore, xp: r.me.xp, finishedAt: r.duel.finishedAt };
    }),
    classmates: classmates
      .map((c) => ({ id: c.id, name: c.name, rating: c.rating ?? 1000, lastActiveAt: c.lastActiveAt }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
