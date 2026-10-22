import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  computeXp,
  describeAnswer,
  EXECUTION_TYPES,
  expectedTimeMs,
  gainHeart,
  grade,
  hashString,
  heartsAt,
  isoWeekKey,
  levelForXp,
  loseHeart,
  needsExecution,
  nextHeartInMs,
  recordActivity,
  shuffle,
  START_RATING,
  toStudentView,
  updateRatings,
  xpWeight,
  type Question,
  type StudentResponse,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import {
  assignments,
  mistakes,
  packs,
  playerProfiles,
  questions,
  responses,
  sessions,
  skillRatings,
  skills,
  users,
  type SessionKind,
} from "../db/schema";
import { checkRunRate, evaluate, tryRun, type Evaluation } from "../execution";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { issueMissionCertificate } from "./certificates";
import { addWeeklyXp } from "./leagues";
import { deliverDue, emitEvent } from "./webhooks";
import { getOrCreateProfile, profileSummary, streakColumns, streakState } from "./profile";
import { studentUnitIdsWithAncestors } from "./scope";
import { getTenant, streakRules, tenantToday } from "./tenant";

export const SKILL_SESSION_LENGTH = 8;
export const DAILY_LENGTH = 5;
export const MISTAKES_LENGTH = 10;
export const DEFAULT_PASS_MARK = 60;

type QuestionRow = typeof questions.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

export interface StudentCtx {
  userId: string;
  tenantId: string;
  now: Date;
}

export function toCoreQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    type: row.type,
    skillId: row.skillId,
    difficulty: row.difficulty,
    body: row.body,
    answer: row.answer,
    explanation: row.explanation,
    hints: row.hints,
  };
}

/** Live questions visible to a tenant: global content plus the tenant's own. */
export function visibleTo(tenantId: string) {
  return and(eq(questions.status, "live"), or(isNull(questions.tenantId), eq(questions.tenantId, tenantId)));
}

/** Quick questions only (no code execution): daily challenges and duels. */
export function quickVisibleTo(tenantId: string) {
  return and(visibleTo(tenantId), notInArray(questions.type, [...EXECUTION_TYPES]));
}

async function loadQuestions(db: DbOrTx, ids: string[]): Promise<Map<string, QuestionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(questions).where(inArray(questions.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function correctlyAnswered(db: DbOrTx, userId: string, questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ questionId: responses.questionId })
    .from(responses)
    .where(and(eq(responses.userId, userId), eq(responses.correct, true), inArray(responses.questionId, questionIds)));
  return new Set(rows.map((r) => r.questionId));
}

export type StartInput =
  | { kind: "skill"; skillId: string }
  | { kind: "daily" }
  | { kind: "pack"; packId: string }
  | { kind: "assignment"; assignmentId: string }
  | { kind: "mistakes" };

export async function startSession(db: Db, ctx: StudentCtx, input: StartInput) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const base = { tenantId: ctx.tenantId, userId: ctx.userId, kind: input.kind as SessionKind };

  let values: typeof sessions.$inferInsert;
  switch (input.kind) {
    case "skill": {
      const [skill] = await db.select().from(skills).where(eq(skills.id, input.skillId));
      if (!skill) throw notFound("Skill");
      const profile = await getOrCreateProfile(db, ctx.userId, ctx.tenantId);
      const hearts = heartsAt({ hearts: profile.hearts, updatedAt: profile.heartsUpdatedAt }, ctx.now);
      if (hearts.hearts <= 0) {
        throw conflict("out_of_hearts", "You are out of hearts. Review a past mistake or wait for a refill.", {
          nextHeartInMs: nextHeartInMs({ hearts: profile.hearts, updatedAt: profile.heartsUpdatedAt }, ctx.now),
        });
      }
      const pool = await db.select().from(questions).where(and(visibleTo(ctx.tenantId), eq(questions.skillId, skill.id)));
      if (pool.length === 0) throw badRequest("This skill has no questions yet");
      const [rating] = await db
        .select()
        .from(skillRatings)
        .where(and(eq(skillRatings.userId, ctx.userId), eq(skillRatings.skillId, skill.id)));
      const playerRating = rating?.rating ?? START_RATING;
      const solved = await correctlyAnswered(db, ctx.userId, pool.map((p) => p.id));
      // Unsolved questions first, then the ones closest to the student's level.
      const ordered = [...pool].sort(
        (a, b) =>
          Number(solved.has(a.id)) - Number(solved.has(b.id)) ||
          Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating) ||
          hashString(`${ctx.userId}:${today}:${a.id}`) - hashString(`${ctx.userId}:${today}:${b.id}`),
      );
      const picked = ordered.slice(0, SKILL_SESSION_LENGTH);
      // Serve easier ones first within the session.
      picked.sort((a, b) => a.rating - b.rating);
      values = { ...base, skillId: skill.id, questionIds: picked.map((p) => p.id), usesHearts: true };
      break;
    }
    case "daily": {
      const [existing] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, ctx.userId), eq(sessions.kind, "daily"), eq(sessions.day, today)));
      if (existing) return sessionView(db, existing);
      const pool = await db.select({ id: questions.id }).from(questions).where(quickVisibleTo(ctx.tenantId)).orderBy(asc(questions.id));
      // Same five questions for everyone in the institution today, so friends can compare.
      const picked = shuffle(pool.map((p) => p.id), hashString(`${ctx.tenantId}:${today}`)).slice(0, DAILY_LENGTH);
      values = { ...base, day: today, questionIds: picked };
      break;
    }
    case "pack": {
      const [pack] = await db.select().from(packs).where(eq(packs.id, input.packId));
      if (!pack || (pack.tenantId && pack.tenantId !== ctx.tenantId)) throw notFound("Mission");
      values = { ...base, packId: pack.id, questionIds: pack.questionIds };
      break;
    }
    case "assignment": {
      const [assignment] = await db
        .select()
        .from(assignments)
        .where(and(eq(assignments.id, input.assignmentId), eq(assignments.tenantId, ctx.tenantId)));
      if (!assignment) throw notFound("Assignment");
      const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
      if (!assignment.orgUnitIds.some((id) => myUnits.has(id))) throw forbidden("This assignment is not for your batch");
      if (ctx.now < assignment.openAt) throw badRequest("This assignment has not opened yet");
      if (ctx.now > assignment.closeAt) throw badRequest("This assignment has closed");
      const [existing] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, ctx.userId), eq(sessions.assignmentId, assignment.id)));
      if (existing) {
        if (existing.finishedAt) throw conflict("already_completed", "You have already completed this assignment");
        return sessionView(db, existing);
      }
      values = { ...base, assignmentId: assignment.id, packId: assignment.packId, questionIds: assignment.questionIds };
      break;
    }
    case "mistakes": {
      const open = await db
        .select({ questionId: mistakes.questionId })
        .from(mistakes)
        .where(and(eq(mistakes.userId, ctx.userId), isNull(mistakes.resolvedAt)))
        .orderBy(asc(mistakes.lastWrongAt))
        .limit(MISTAKES_LENGTH);
      if (open.length === 0) throw badRequest("No mistakes to review. Nice work!");
      values = { ...base, questionIds: open.map((m) => m.questionId) };
      break;
    }
  }
  const [session] = await db.insert(sessions).values({ ...values, startedAt: ctx.now }).returning();
  return sessionView(db, session!);
}

async function sessionTitle(db: DbOrTx, s: SessionRow): Promise<{ title: string; passMark: number | null }> {
  if (s.kind === "skill" && s.skillId) {
    const [skill] = await db.select({ name: skills.name }).from(skills).where(eq(skills.id, s.skillId));
    return { title: skill?.name ?? "Practice", passMark: null };
  }
  if (s.kind === "daily") return { title: "Daily challenge", passMark: null };
  if (s.kind === "mistakes") return { title: "Mistake review", passMark: null };
  if (s.kind === "assignment" && s.assignmentId) {
    const [a] = await db.select({ title: assignments.title }).from(assignments).where(eq(assignments.id, s.assignmentId));
    const pack = s.packId ? (await db.select({ passMark: packs.passMark }).from(packs).where(eq(packs.id, s.packId)))[0] : undefined;
    return { title: a?.title ?? "Assignment", passMark: pack?.passMark ?? DEFAULT_PASS_MARK };
  }
  const [pack] = await db.select({ title: packs.title, passMark: packs.passMark }).from(packs).where(eq(packs.id, s.packId ?? ""));
  return { title: pack?.title ?? "Mission", passMark: pack?.passMark ?? DEFAULT_PASS_MARK };
}

export function sessionScore(s: Pick<SessionRow, "correctCount" | "questionIds">): number {
  return s.questionIds.length === 0 ? 0 : Math.round((s.correctCount / s.questionIds.length) * 100);
}

export async function sessionView(db: DbOrTx, s: SessionRow) {
  const { title, passMark } = await sessionTitle(db, s);
  const currentId = s.finishedAt ? undefined : s.questionIds[s.currentIndex];
  const current = currentId ? (await loadQuestions(db, [currentId])).get(currentId) : undefined;
  const score = sessionScore(s);
  return {
    id: s.id,
    kind: s.kind,
    title,
    total: s.questionIds.length,
    answered: s.currentIndex,
    correctCount: s.correctCount,
    xpEarned: s.xpEarned,
    usesHearts: s.usesHearts,
    finished: Boolean(s.finishedAt),
    passMark,
    score: s.finishedAt ? score : null,
    passed: s.finishedAt && passMark !== null ? score >= passMark : null,
    question: current
      ? { ...toStudentView(toCoreQuestion(current), s.id), hintsUsed: s.hintsUsed[current.id] ?? 0, coachUsed: s.hintsUsed[`coach:${current.id}`] ?? 0 }
      : null,
  };
}

export async function getSession(db: DbOrTx, ctx: StudentCtx, sessionId: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s || s.userId !== ctx.userId) throw notFound("Session");
  return sessionView(db, s);
}

export async function takeHint(db: Db, ctx: StudentCtx, sessionId: string, questionId: string) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!s || s.userId !== ctx.userId) throw notFound("Session");
    if (s.finishedAt || s.questionIds[s.currentIndex] !== questionId) throw conflict("not_current", "That question is not the current one");
    const [q] = await tx.select().from(questions).where(eq(questions.id, questionId));
    const used = s.hintsUsed[questionId] ?? 0;
    if (!q || used >= q.hints.length) throw badRequest("No more hints for this question");
    await tx
      .update(sessions)
      .set({ hintsUsed: { ...s.hintsUsed, [questionId]: used + 1 } })
      .where(eq(sessions.id, s.id));
    return { hint: q.hints[used]!, hintsUsed: used + 1, hintsLeft: q.hints.length - used - 1 };
  });
}

export interface AnswerInput {
  questionId: string;
  response: StudentResponse;
  timeMs: number;
}

/** Run code against the sample tests (or a SQL query against the tables) without answering. */
export async function runCurrent(db: DbOrTx, ctx: StudentCtx, sessionId: string, input: { questionId: string; response: StudentResponse }) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s || s.userId !== ctx.userId) throw notFound("Session");
  if (s.finishedAt || s.questionIds[s.currentIndex] !== input.questionId) throw conflict("not_current", "That question is not the current one");
  const [q] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  if (!q) throw notFound("Question");
  checkRunRate(ctx.userId, ctx.now.getTime());
  return tryRun(toCoreQuestion(q), input.response);
}

/** Summary of an execution result kept with the response (no student-visible test data). */
function storedResult(e: Evaluation): Record<string, unknown> {
  return e.kind === "code"
    ? { kind: "code", score: e.score, passed: e.passed, total: e.total, statuses: e.tests.map((t) => t.status) }
    : { kind: "sql", score: e.score, ok: e.result.ok, rows: e.result.rows.length, error: e.result.error ?? null };
}

export async function answerQuestion(db: Db, ctx: StudentCtx, sessionId: string, input: AnswerInput) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const rules = streakRules(tenant);

  // Code and SQL run before the transaction: execution takes seconds and must not hold row locks.
  const [pending] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  let evaluation: Evaluation | null = null;
  if (pending && needsExecution(pending.answer)) {
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!s || s.userId !== ctx.userId) throw notFound("Session");
    if (s.finishedAt || s.questionIds[s.currentIndex] !== input.questionId) throw conflict("not_current", "That question is not the current one");
    evaluation = await evaluate(toCoreQuestion(pending), input.response, "practice");
  }

  let queuedEvents = 0;
  const out = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!s || s.userId !== ctx.userId) throw notFound("Session");
    if (s.finishedAt) throw conflict("session_finished", "This session is already finished");
    if (s.questionIds[s.currentIndex] !== input.questionId) throw conflict("not_current", "That question is not the current one");
    const [q] = await tx.select().from(questions).where(eq(questions.id, input.questionId)).for("update");
    if (!q) throw notFound("Question");

    const correct = evaluation ? evaluation.correct : grade(q.answer, input.response);
    const history = await tx
      .select({ correct: responses.correct })
      .from(responses)
      .where(and(eq(responses.userId, ctx.userId), eq(responses.questionId, q.id)));
    const firstAttempt = history.length === 0;
    const previouslyCorrect = history.some((h) => h.correct);

    const profile = await getOrCreateProfile(tx, ctx.userId, ctx.tenantId, true);
    const [rating] = await tx
      .select()
      .from(skillRatings)
      .where(and(eq(skillRatings.userId, ctx.userId), eq(skillRatings.skillId, q.skillId)))
      .for("update");
    const player = { rating: rating?.rating ?? START_RATING, attempts: rating?.attempts ?? 0 };
    // Written hints and AI coach hints both cost XP.
    const hintsUsed = (s.hintsUsed[q.id] ?? 0) + (s.hintsUsed[`coach:${q.id}`] ?? 0);
    const repeatXpToday = profile.repeatXpDay === today ? profile.repeatXpToday : 0;

    const xp = computeXp({
      correct,
      difficulty: q.difficulty,
      firstAttempt,
      previouslyCorrect,
      hintsUsed,
      timeMs: Math.max(0, Math.round(input.timeMs)),
      expectedTimeMs: expectedTimeMs(q.difficulty, Boolean(evaluation)),
      playerRating: player.rating,
      questionRating: q.rating,
      repeatXpToday,
      weight: xpWeight(q.type),
    });

    // Ratings: student mastery on the skill, and calibration of the question.
    const ratings = updateRatings(player, { rating: q.rating, attempts: q.attempts }, correct);
    await tx
      .insert(skillRatings)
      .values({ userId: ctx.userId, skillId: q.skillId, rating: ratings.playerRating, attempts: 1, correct: correct ? 1 : 0, lastPractisedAt: today })
      .onConflictDoUpdate({
        target: [skillRatings.userId, skillRatings.skillId],
        set: {
          rating: ratings.playerRating,
          attempts: sql`${skillRatings.attempts} + 1`,
          correct: sql`${skillRatings.correct} + ${correct ? 1 : 0}`,
          lastPractisedAt: today,
        },
      });
    await tx
      .update(questions)
      .set({ rating: ratings.questionRating, attempts: q.attempts + 1, correctCount: q.correctCount + (correct ? 1 : 0) })
      .where(eq(questions.id, q.id));

    // Streak, hearts and XP.
    const streak = recordActivity(streakState(profile), today, rules);
    let hearts = { hearts: profile.hearts, updatedAt: profile.heartsUpdatedAt };
    if (!correct && s.usesHearts) hearts = loseHeart(hearts, ctx.now);
    if (correct && s.kind === "mistakes") hearts = gainHeart(hearts, ctx.now);
    const levelBefore = levelForXp(profile.xp);
    const newXp = profile.xp + xp.xp;
    const [updatedProfile] = await tx
      .update(playerProfiles)
      .set({
        xp: newXp,
        ...streakColumns(streak.state),
        hearts: hearts.hearts,
        heartsUpdatedAt: hearts.updatedAt,
        repeatXpDay: today,
        repeatXpToday: repeatXpToday + (xp.countsAsRepeat ? xp.xp : 0),
        updatedAt: ctx.now,
      })
      .where(eq(playerProfiles.userId, ctx.userId))
      .returning();
    await addWeeklyXp(tx, { tenantId: ctx.tenantId, userId: ctx.userId, division: profile.division, weekKey: isoWeekKey(today), xp: xp.xp });

    // Mistake notebook: wrong answers go in, a correct answer anywhere clears them.
    if (!correct) {
      await tx
        .insert(mistakes)
        .values({ userId: ctx.userId, questionId: q.id, lastWrongAt: ctx.now })
        .onConflictDoUpdate({
          target: [mistakes.userId, mistakes.questionId],
          set: { wrongCount: sql`${mistakes.wrongCount} + 1`, lastWrongAt: ctx.now, resolvedAt: null },
        });
    } else {
      await tx
        .update(mistakes)
        .set({ resolvedAt: ctx.now })
        .where(and(eq(mistakes.userId, ctx.userId), eq(mistakes.questionId, q.id), isNull(mistakes.resolvedAt)));
    }

    await tx.insert(responses).values({
      tenantId: ctx.tenantId,
      sessionId: s.id,
      userId: ctx.userId,
      questionId: q.id,
      questionVersion: q.version,
      response: input.response,
      correct,
      xp: xp.xp,
      timeMs: Math.max(0, Math.round(input.timeMs)),
      hintsUsed,
      result: evaluation ? storedResult(evaluation) : null,
      createdAt: ctx.now,
    });

    const nextIndex = s.currentIndex + 1;
    const outOfHearts = s.usesHearts && hearts.hearts <= 0 && nextIndex < s.questionIds.length;
    const finished = nextIndex >= s.questionIds.length || outOfHearts;
    const [updatedSession] = await tx
      .update(sessions)
      .set({
        currentIndex: nextIndex,
        correctCount: s.correctCount + (correct ? 1 : 0),
        xpEarned: s.xpEarned + xp.xp,
        finishedAt: finished ? ctx.now : null,
      })
      .where(eq(sessions.id, s.id))
      .returning();
    await tx.update(users).set({ lastActiveAt: ctx.now }).where(eq(users.id, ctx.userId));

    // A passed mission earns a verifiable certificate.
    let certificate: string | null = null;
    if (finished && s.kind === "pack" && s.packId) {
      const [pack] = await tx.select().from(packs).where(eq(packs.id, s.packId));
      const scorePct = sessionScore(updatedSession!);
      if (pack && pack.kind === "mission" && scorePct >= pack.passMark) {
        certificate = await issueMissionCertificate(tx, { tenantId: ctx.tenantId, userId: ctx.userId, packId: pack.id, title: pack.title, scorePct, now: ctx.now });
        queuedEvents += await emitEvent(tx, ctx.tenantId, "certificate.issued", { code: certificate, userId: ctx.userId, packId: pack.id, title: pack.title, scorePct }, ctx.now);
      }
    }
    // Webhook events are written in the same transaction (an outbox), so they exist only if the answer does.
    if (finished && s.kind === "assignment" && s.assignmentId) {
      queuedEvents += await emitEvent(
        tx,
        ctx.tenantId,
        "assignment.completed",
        { assignmentId: s.assignmentId, userId: ctx.userId, sessionId: s.id, scorePct: sessionScore(updatedSession!), correct: updatedSession!.correctCount, total: s.questionIds.length },
        ctx.now,
      );
    }

    return {
      correct,
      correctAnswer: describeAnswer(toCoreQuestion(q)),
      // Hidden tests stay hidden after answering; only the model solution is revealed.
      answer: q.answer.kind === "tests" ? { kind: "tests" as const, tests: [], reference: q.answer.reference } : q.answer,
      evaluation,
      explanation: q.explanation,
      xp: xp.xp,
      xpBreakdown: xp.breakdown,
      levelUp: levelForXp(newXp) > levelBefore,
      streakExtended: streak.extended,
      streakBroken: streak.broken,
      freezesUsed: streak.freezesUsed,
      outOfHearts,
      certificate,
      profile: profileSummary(updatedProfile!, today, ctx.now, rules),
      session: await sessionView(tx, updatedSession!),
    };
  });
  if (queuedEvents) void deliverDue(db, ctx.now).catch(() => {});
  return out;
}
