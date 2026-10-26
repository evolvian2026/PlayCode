import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  describeAnswer,
  EXECUTION_TYPES,
  grade,
  hashString,
  LIVE_MAX_QUESTIONS,
  liveJoinCode,
  livePoints,
  liveRanking,
  liveStatus,
  shuffle,
  toStudentView,
  type StudentResponse,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { liveQuizAnswers, liveQuizPlayers, liveQuizzes, packs, questions, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { publish } from "../lib/realtime";
import { quickVisibleTo, toCoreQuestion } from "./practice";

// Live classroom quizzes. The teacher's screen (on the projector) shows one
// question at a time with a timer; students join with a 6-digit code and
// answer on their phones. The server owns the clock: answers after the timer
// are refused, and a right answer scores more the faster it came. Students
// learn whether they were right when the teacher reveals the answer.

type Quiz = typeof liveQuizzes.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };

/** Tell everyone in the quiz (and the host) to refresh. */
async function notify(db: DbOrTx, quiz: Quiz) {
  const players = await db.select({ userId: liveQuizPlayers.userId }).from(liveQuizPlayers).where(eq(liveQuizPlayers.quizId, quiz.id));
  const event = { type: "live_quiz", quizId: quiz.id };
  for (const p of players) publish(p.userId, event);
  publish(quiz.hostId, event);
}

export async function createLiveQuiz(
  db: Db,
  ctx: Ctx,
  input: { title: string; packId?: string; skillId?: string; count: number; secondsPerQuestion: number },
) {
  let ids: string[];
  if (input.packId) {
    const [pack] = await db.select().from(packs).where(eq(packs.id, input.packId));
    if (!pack || (pack.tenantId && pack.tenantId !== ctx.tenantId)) throw notFound("Mission");
    ids = pack.questionIds;
  } else if (input.skillId) {
    const pool = await db.select({ id: questions.id }).from(questions).where(and(quickVisibleTo(ctx.tenantId), eq(questions.skillId, input.skillId)));
    ids = shuffle(pool.map((p) => p.id), hashString(`${ctx.userId}:${ctx.now.toISOString()}`));
  } else throw badRequest("Choose a mission or a skill");
  // Quick questions only: nobody writes code against a 20-second timer.
  const quick = await db.select({ id: questions.id, type: questions.type }).from(questions).where(and(inArray(questions.id, ids.length ? ids : ["-"]), quickVisibleTo(ctx.tenantId)));
  const usable = ids.filter((id) => quick.some((q) => q.id === id && !EXECUTION_TYPES.includes(q.type))).slice(0, Math.min(input.count, LIVE_MAX_QUESTIONS));
  if (usable.length === 0) throw badRequest("That has no quick questions to use");

  // A join code no running quiz is using.
  let code = liveJoinCode();
  for (let i = 0; i < 20; i++) {
    const [taken] = await db.select({ id: liveQuizzes.id }).from(liveQuizzes).where(and(eq(liveQuizzes.code, code), ne(liveQuizzes.status, "ended")));
    if (!taken) break;
    code = liveJoinCode();
  }
  const [quiz] = await db
    .insert(liveQuizzes)
    .values({ tenantId: ctx.tenantId, hostId: ctx.userId, title: input.title, code, questionIds: usable, secondsPerQuestion: input.secondsPerQuestion, createdAt: ctx.now })
    .returning();
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "live_quiz.create", target: quiz!.id, data: { questions: usable.length } });
  return quiz!;
}

async function loadQuiz(db: DbOrTx, tenantId: string, id: string): Promise<Quiz> {
  const [q] = await db.select().from(liveQuizzes).where(and(eq(liveQuizzes.id, id), eq(liveQuizzes.tenantId, tenantId)));
  if (!q) throw notFound("Quiz");
  return q;
}

async function ranking(db: DbOrTx, quizId: string) {
  const rows = await db
    .select({ userId: liveQuizPlayers.userId, name: users.name, score: liveQuizPlayers.score, lastScoredAt: liveQuizPlayers.lastScoredAt })
    .from(liveQuizPlayers)
    .innerJoin(users, eq(users.id, liveQuizPlayers.userId))
    .where(eq(liveQuizPlayers.quizId, quizId));
  return liveRanking(rows.map((r) => ({ ...r, lastScoredAt: r.lastScoredAt?.getTime() ?? Number.MAX_SAFE_INTEGER })));
}

async function currentQuestion(db: DbOrTx, quiz: Quiz) {
  const id = quiz.questionIds[quiz.currentIndex];
  if (!id) return null;
  const [q] = await db.select().from(questions).where(eq(questions.id, id));
  return q ?? null;
}

/** The teacher's (projector) view: the question, the timer, how many have answered, and after the reveal the answer, the spread of answers and the leaderboard. */
export async function hostView(db: Db, ctx: Ctx, id: string) {
  const quiz = await loadQuiz(db, ctx.tenantId, id);
  const status = liveStatus(quiz, ctx.now);
  const q = await currentQuestion(db, quiz);
  const answers = quiz.currentIndex >= 0 ? await db.select().from(liveQuizAnswers).where(and(eq(liveQuizAnswers.quizId, quiz.id), eq(liveQuizAnswers.questionIndex, quiz.currentIndex))) : [];
  const ranked = await ranking(db, quiz.id);
  const revealed = status === "reveal" || status === "ended";
  const spread = new Map<string, number>();
  for (const a of answers) if (a.response.kind === "option") spread.set(a.response.optionId, (spread.get(a.response.optionId) ?? 0) + 1);
  return {
    id: quiz.id,
    title: quiz.title,
    code: quiz.code,
    isHost: quiz.hostId === ctx.userId,
    status,
    index: quiz.currentIndex,
    total: quiz.questionIds.length,
    secondsPerQuestion: quiz.secondsPerQuestion,
    endsAt: status === "question" && quiz.questionStartedAt ? new Date(quiz.questionStartedAt.getTime() + quiz.secondsPerQuestion * 1000) : null,
    question: q && status !== "lobby" ? toStudentView(toCoreQuestion(q), quiz.id) : null,
    answer: q && revealed ? { text: describeAnswer(toCoreQuestion(q)), explanation: q.explanation, optionId: q.answer.kind === "option" ? q.answer.optionId : null } : null,
    answered: answers.length,
    correct: revealed ? answers.filter((a) => a.correct).length : null,
    spread: revealed ? Object.fromEntries(spread) : null,
    players: ranked.length,
    leaderboard: ranked.slice(0, 10).map(({ name, score, rank }) => ({ name, score, rank })),
  };
}

/** Move the quiz on: start, reveal the answer (even before the timer ends), next question, or finish after the last. */
export async function advanceQuiz(db: Db, ctx: Ctx, id: string, action: "next" | "end") {
  const quiz = await loadQuiz(db, ctx.tenantId, id);
  if (quiz.hostId !== ctx.userId) throw forbidden("Only the teacher running this quiz can move it on");
  if (quiz.status === "ended") throw conflict("quiz_ended", "This quiz has ended");
  const status = liveStatus(quiz, ctx.now);
  let set: Partial<typeof liveQuizzes.$inferInsert>;
  if (action === "end" || (status === "reveal" && quiz.currentIndex >= quiz.questionIds.length - 1)) set = { status: "ended", endedAt: ctx.now };
  else if (status === "question") set = { status: "reveal" };
  else set = { status: "question", currentIndex: quiz.currentIndex + 1, questionStartedAt: ctx.now };
  // Guard against a double click moving it twice.
  const [updated] = await db
    .update(liveQuizzes)
    .set(set)
    .where(and(eq(liveQuizzes.id, quiz.id), eq(liveQuizzes.status, quiz.status), eq(liveQuizzes.currentIndex, quiz.currentIndex)))
    .returning();
  if (updated) await notify(db, updated);
  return hostView(db, ctx, id);
}

export async function myQuizzes(db: Db, ctx: Ctx) {
  const rows = await db.select().from(liveQuizzes).where(eq(liveQuizzes.hostId, ctx.userId)).orderBy(desc(liveQuizzes.createdAt)).limit(20);
  const counts = rows.length
    ? await db.select({ quizId: liveQuizPlayers.quizId, n: sql<number>`count(*)::int` }).from(liveQuizPlayers).where(inArray(liveQuizPlayers.quizId, rows.map((r) => r.id))).groupBy(liveQuizPlayers.quizId)
    : [];
  return { quizzes: rows.map((q) => ({ id: q.id, title: q.title, code: q.code, status: liveStatus(q, ctx.now), questions: q.questionIds.length, players: counts.find((c) => c.quizId === q.id)?.n ?? 0, createdAt: q.createdAt })) };
}

// ---------- Students ----------

export async function joinQuiz(db: Db, ctx: Ctx, code: string) {
  const [quiz] = await db.select().from(liveQuizzes).where(and(eq(liveQuizzes.code, code), eq(liveQuizzes.tenantId, ctx.tenantId), ne(liveQuizzes.status, "ended")));
  if (!quiz) throw notFound("Quiz with that code");
  const [added] = await db.insert(liveQuizPlayers).values({ quizId: quiz.id, userId: ctx.userId, joinedAt: ctx.now }).onConflictDoNothing().returning();
  if (added) publish(quiz.hostId, { type: "live_quiz", quizId: quiz.id });
  return { id: quiz.id };
}

async function player(db: DbOrTx, quiz: Quiz, userId: string) {
  const [p] = await db.select().from(liveQuizPlayers).where(and(eq(liveQuizPlayers.quizId, quiz.id), eq(liveQuizPlayers.userId, userId)));
  if (!p) throw notFound("Quiz");
  return p;
}

/** What a student's phone shows. */
export async function playerView(db: Db, ctx: Ctx, id: string) {
  const quiz = await loadQuiz(db, ctx.tenantId, id);
  await player(db, quiz, ctx.userId);
  const status = liveStatus(quiz, ctx.now);
  const q = await currentQuestion(db, quiz);
  const [mine] = quiz.currentIndex >= 0
    ? await db.select().from(liveQuizAnswers).where(and(eq(liveQuizAnswers.quizId, quiz.id), eq(liveQuizAnswers.userId, ctx.userId), eq(liveQuizAnswers.questionIndex, quiz.currentIndex)))
    : [];
  const ranked = await ranking(db, quiz.id);
  const me = ranked.find((r) => r.userId === ctx.userId);
  const revealed = status === "reveal" || status === "ended";
  return {
    id: quiz.id,
    title: quiz.title,
    status,
    index: quiz.currentIndex,
    total: quiz.questionIds.length,
    endsAt: status === "question" && quiz.questionStartedAt ? new Date(quiz.questionStartedAt.getTime() + quiz.secondsPerQuestion * 1000) : null,
    question: q && status === "question" && !mine ? toStudentView(toCoreQuestion(q), quiz.id) : null,
    answered: Boolean(mine),
    result: revealed && q && quiz.currentIndex >= 0 ? { correct: mine?.correct ?? false, points: mine?.points ?? 0, answered: Boolean(mine), answer: describeAnswer(toCoreQuestion(q)) } : null,
    me: me ? { score: me.score, rank: me.rank, of: ranked.length } : null,
    leaderboard: revealed ? ranked.slice(0, 5).map(({ name, score, rank }) => ({ name, score, rank })) : [],
  };
}

export async function answerLive(db: Db, ctx: Ctx, id: string, input: { index: number; response: StudentResponse }) {
  const quiz = await loadQuiz(db, ctx.tenantId, id);
  await player(db, quiz, ctx.userId);
  if (liveStatus(quiz, ctx.now) !== "question" || input.index !== quiz.currentIndex) throw conflict("question_closed", "Time's up for that question");
  const q = (await currentQuestion(db, quiz))!;
  const correct = grade(q.answer, input.response);
  const points = livePoints(correct, ctx.now.getTime() - quiz.questionStartedAt!.getTime(), quiz.secondsPerQuestion * 1000);
  const [saved] = await db
    .insert(liveQuizAnswers)
    .values({ quizId: quiz.id, userId: ctx.userId, questionIndex: quiz.currentIndex, response: input.response, correct, points, answeredAt: ctx.now })
    .onConflictDoNothing()
    .returning();
  if (!saved) throw conflict("already_answered", "You have already answered this question");
  if (points > 0) {
    await db
      .update(liveQuizPlayers)
      .set({ score: sql`${liveQuizPlayers.score} + ${points}`, lastScoredAt: ctx.now })
      .where(and(eq(liveQuizPlayers.quizId, quiz.id), eq(liveQuizPlayers.userId, ctx.userId)));
  }
  publish(quiz.hostId, { type: "live_quiz", quizId: quiz.id });
  // Whether it was right shows when the teacher reveals the answer.
  return { received: true };
}
