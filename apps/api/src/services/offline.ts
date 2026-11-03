import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { describeAnswer, hashString, isoWeekKey, masteryFromRating, toStudentView, type StudentResponse } from "@playcode/core";
import type { Db } from "../db/client";
import { questions, responses, sessions, skillRatings, users } from "../db/schema";
import { HttpError, notFound } from "../lib/errors";
import { answerQuestion, quickVisibleTo, toCoreQuestion, type StudentCtx } from "./practice";
import { getOrCreateProfile } from "./profile";
import { getTenant, tenantToday } from "./tenant";

// Offline practice: a pack of quick questions to answer with no connection
// (on a train, in a hostel with no signal). The phone gets the questions but
// never the answers, so the measured record stays honest: answers are marked
// when the pack syncs, through the same path as any other practice answer.
//
// An answer counts on the day it was given, as the phone reports it (never
// before the pack was issued or after the sync), unless that would land before
// the student's latest practice day or in an earlier league week; then it
// counts at sync time, so a late sync can't break a streak or a closed week.

const PACK_SIZE = 15;
const PER_SKILL = 4;
const PACK_DAYS = 7;
const DAY_MS = 86_400_000;

type Session = typeof sessions.$inferSelect;

export interface OfflineAnswer {
  questionId: string;
  response: StudentResponse;
  answeredAt: Date;
  timeMs: number;
}

async function packView(db: Db, s: Session) {
  const rows = await db.select().from(questions).where(inArray(questions.id, s.questionIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    id: s.id,
    issuedAt: s.startedAt,
    expiresAt: new Date(s.startedAt.getTime() + PACK_DAYS * DAY_MS),
    questions: s.questionIds.map((id) => toStudentView(toCoreQuestion(byId.get(id)!), s.id)),
  };
}

/** The student's open pack, or a new one: unsolved questions on their weakest skills first, a few per skill. */
export async function offlinePack(db: Db, ctx: StudentCtx) {
  const [open] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.userId), eq(sessions.kind, "offline"), isNull(sessions.finishedAt), eq(sessions.currentIndex, 0), gte(sessions.startedAt, new Date(ctx.now.getTime() - PACK_DAYS * DAY_MS))));
  if (open) return packView(db, open);

  const pool = await db.select({ id: questions.id, skillId: questions.skillId }).from(questions).where(quickVisibleTo(ctx.tenantId));
  const mastery = new Map(
    (await db.select().from(skillRatings).where(eq(skillRatings.userId, ctx.userId))).map((r) => [r.skillId, masteryFromRating(r.rating)]),
  );
  const solved = new Set(
    pool.length
      ? (await db.selectDistinct({ id: responses.questionId }).from(responses).where(and(eq(responses.userId, ctx.userId), eq(responses.correct, true), inArray(responses.questionId, pool.map((p) => p.id))))).map((r) => r.id)
      : [],
  );
  const seed = ctx.now.toISOString().slice(0, 10);
  const ranked = [...pool].sort(
    (a, b) =>
      Number(solved.has(a.id)) - Number(solved.has(b.id)) ||
      // Practised-but-weak skills first; untried ones count as middling.
      (mastery.get(a.skillId) ?? 50) - (mastery.get(b.skillId) ?? 50) ||
      hashString(`${ctx.userId}:${seed}:${a.id}`) - hashString(`${ctx.userId}:${seed}:${b.id}`),
  );
  const perSkill = new Map<string, number>();
  const picked: string[] = [];
  for (const q of ranked) {
    if (picked.length >= PACK_SIZE) break;
    if ((perSkill.get(q.skillId) ?? 0) >= PER_SKILL) continue;
    perSkill.set(q.skillId, (perSkill.get(q.skillId) ?? 0) + 1);
    picked.push(q.id);
  }
  const [s] = await db
    .insert(sessions)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, kind: "offline", questionIds: picked, usesHearts: false, startedAt: ctx.now })
    .returning();
  return packView(db, s!);
}

/** What a synced pack came to: each answer marked, with the right answer and why. */
async function syncedResult(db: Db, s: Session) {
  const rows = await db.select().from(responses).where(eq(responses.sessionId, s.id)).orderBy(asc(responses.createdAt));
  const qs = rows.length ? await db.select().from(questions).where(inArray(questions.id, rows.map((r) => r.questionId))) : [];
  const byId = new Map(qs.map((q) => [q.id, q]));
  return {
    id: s.id,
    synced: true,
    correct: rows.filter((r) => r.correct).length,
    total: rows.length,
    xp: rows.reduce((n, r) => n + r.xp, 0),
    results: rows.map((r) => {
      const q = byId.get(r.questionId)!;
      return { questionId: q.id, stem: q.body.stem, code: q.body.code ?? null, correct: r.correct, xp: r.xp, correctAnswer: describeAnswer(q), explanation: q.explanation, countedOn: r.createdAt };
    }),
  };
}

/**
 * Mark a pack's answers. Safe to retry: a pack that already synced returns its
 * results again (the phone may have lost the first reply).
 */
export async function syncPack(db: Db, ctx: StudentCtx, id: string, answers: OfflineAnswer[]) {
  const [s] = await db.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, ctx.userId), eq(sessions.kind, "offline")));
  if (!s) throw notFound("Offline pack");
  if (s.finishedAt || s.currentIndex > 0) return syncedResult(db, s);

  // One answer per question in the pack, in the order they were given.
  const seen = new Set<string>();
  const valid = answers
    .filter((a) => s.questionIds.includes(a.questionId) && !seen.has(a.questionId) && seen.add(a.questionId))
    .sort((a, b) => a.answeredAt.getTime() - b.answeredAt.getTime());
  // The session now holds only what was answered, so marking them all finishes it.
  const [claimed] = await db
    .update(sessions)
    .set(valid.length ? { questionIds: valid.map((a) => a.questionId) } : { questionIds: [], finishedAt: ctx.now })
    .where(and(eq(sessions.id, s.id), eq(sessions.currentIndex, 0), isNull(sessions.finishedAt)))
    .returning();
  if (!claimed || !valid.length) return syncedResult(db, claimed ?? s);

  const tenant = await getTenant(db, ctx.tenantId);
  const thisWeek = isoWeekKey(tenantToday(tenant, ctx.now));
  for (const a of valid) {
    let at = new Date(Math.min(ctx.now.getTime(), Math.max(s.startedAt.getTime(), a.answeredAt.getTime())));
    const day = tenantToday(tenant, at);
    const lastDay = (await getOrCreateProfile(db, ctx.userId, ctx.tenantId)).streakLastDate;
    if ((lastDay && day < lastDay) || isoWeekKey(day) !== thisWeek) at = ctx.now;
    try {
      await answerQuestion(db, { ...ctx, now: at }, s.id, { questionId: a.questionId, response: a.response, timeMs: a.timeMs });
    } catch (err) {
      // Another sync of the same pack got there first.
      if (err instanceof HttpError && (err.code === "not_current" || err.code === "session_finished")) break;
      throw err;
    }
  }
  await db.update(users).set({ lastActiveAt: ctx.now }).where(eq(users.id, ctx.userId));
  const [done] = await db.select().from(sessions).where(eq(sessions.id, s.id));
  return syncedResult(db, done!);
}
