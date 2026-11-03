import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { countWords, WRITING_DIMENSIONS, WRITING_PER_DAY, WRITING_TASKS, type WritingTask } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { users, writingAttempts, type WritingFeedback } from "../db/schema";
import { aiProvider, AiUnavailableError } from "../lib/ai";
import { badRequest, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";
import { getTenant } from "./tenant";

// Written English practice: the email and essay tasks in the written section
// of service-company tests. The student writes against the clock in the app,
// and the AI marks it on the test's rubric (task, structure, language, tone),
// checks which required points the email covered, and returns the most
// important corrections and a corrected version. It sits with the AI coach
// (same plan feature and institution switch).

const MIN_WORDS_TO_MARK = 20;
const DAY_MS = 86_400_000;

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof writingAttempts.$inferSelect;

const taskOf = (id: string) => WRITING_TASKS.find((t) => t.id === id);

async function writingAvailability(db: DbOrTx, ctx: Ctx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!aiProvider() || (await getTenant(db, ctx.tenantId)).settings.aiHints === false) return { ok: false, reason: "AI feedback is not switched on for your institution." };
  return aiAllowed(db, ctx.tenantId, "ai_coach", ctx.now);
}

async function markedToday(db: DbOrTx, ctx: Ctx) {
  const [{ n }] = (await db.select({ n: count() }).from(writingAttempts).where(and(eq(writingAttempts.userId, ctx.userId), gte(writingAttempts.createdAt, new Date(ctx.now.getTime() - DAY_MS))))) as [{ n: number }];
  return n;
}

const view = (row: Row) => ({ id: row.id, task: taskOf(row.taskId)!, text: row.text, words: row.words, timeMs: row.timeMs, feedback: row.feedback, createdAt: row.createdAt });

export async function writingHome(db: Db, ctx: Ctx) {
  const rows = await db.select().from(writingAttempts).where(eq(writingAttempts.userId, ctx.userId)).orderBy(desc(writingAttempts.createdAt)).limit(30);
  const availability = await writingAvailability(db, ctx);
  const best = new Map<string, number>();
  for (const r of rows) best.set(r.taskId, Math.max(best.get(r.taskId) ?? 0, r.feedback.overall));
  return {
    available: availability.ok,
    reason: availability.ok ? null : availability.reason,
    leftToday: Math.max(0, WRITING_PER_DAY - (await markedToday(db, ctx))),
    tasks: WRITING_TASKS.map((t) => ({ ...t, best: best.get(t.id) ?? null })),
    attempts: rows.map((r) => ({ id: r.id, taskId: r.taskId, title: taskOf(r.taskId)?.title ?? r.taskId, kind: taskOf(r.taskId)?.kind ?? "email", overall: r.feedback.overall, words: r.words, createdAt: r.createdAt })),
  };
}

export async function getMyWriting(db: Db, ctx: Ctx, id: string) {
  const [row] = await db.select().from(writingAttempts).where(and(eq(writingAttempts.id, id), eq(writingAttempts.userId, ctx.userId)));
  if (!row) throw notFound("Answer");
  return view(row);
}

/** Keep the model's feedback inside the rubric: scores 1-5, real point indexes, and corrections that quote the text. */
function clean(task: WritingTask, text: string, raw: Omit<WritingFeedback, "scores"> & { scores: Record<string, number> }): WritingFeedback {
  const clamp = (n: number | undefined) => Math.min(5, Math.max(1, Math.round(n ?? 1)));
  const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const body = squash(text);
  return {
    scores: Object.fromEntries(WRITING_DIMENSIONS.map(([key]) => [key, clamp(raw.scores[key])])),
    overall: clamp(raw.overall),
    pointsCovered: [...new Set(raw.pointsCovered)].filter((i) => Number.isInteger(i) && i >= 0 && i < task.points.length).sort((a, b) => a - b),
    strengths: raw.strengths.slice(0, 3),
    improvements: raw.improvements.slice(0, 3),
    corrections: raw.corrections.filter((c) => c.original.trim() && body.includes(squash(c.original)) && squash(c.original) !== squash(c.better)).slice(0, 6),
    improved: raw.improved.slice(0, 8000),
  };
}

export async function submitWriting(db: Db, ctx: Ctx, input: { taskId: string; text: string; timeMs: number }) {
  const task = taskOf(input.taskId);
  if (!task) throw badRequest("Unknown task");
  const words = countWords(input.text);
  if (words < MIN_WORDS_TO_MARK) throw badRequest(`Write at least ${MIN_WORDS_TO_MARK} words to get feedback`);
  const allowed = await writingAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  if ((await markedToday(db, ctx)) >= WRITING_PER_DAY) throw new HttpError(429, "writing_daily_limit", `You've had ${WRITING_PER_DAY} answers marked today. Try again tomorrow.`);

  let res;
  try {
    res = await aiProvider()!.writingFeedback({
      kind: task.kind,
      prompt: task.prompt,
      points: task.points,
      minWords: task.minWords,
      maxWords: task.maxWords,
      minutes: task.minutes,
      text: input.text,
      words,
      minutesTaken: Math.max(1, Math.round(input.timeMs / 60_000)),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof AiUnavailableError) throw new HttpError(502, "writing_unavailable", err.message);
    throw new HttpError(503, "writing_unavailable", "The marker is busy right now. Try again in a moment.");
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "writing_feedback", usage: res.usage, now: ctx.now });
  const feedback = clean(task, input.text, res.value as Parameters<typeof clean>[2]);
  const [row] = await db.insert(writingAttempts).values({ tenantId: ctx.tenantId, userId: ctx.userId, taskId: task.id, text: input.text, words, timeMs: input.timeMs, feedback, createdAt: ctx.now }).returning();
  return view(row!);
}

/** Marked answers of the given students, newest first, with averages, for teachers. */
export async function writingFor(db: Db, studentIds: string[]) {
  if (studentIds.length === 0) return { attempts: [], averages: null };
  const rows = await db
    .select({ id: writingAttempts.id, userId: writingAttempts.userId, name: users.name, rollNo: users.rollNo, taskId: writingAttempts.taskId, words: writingAttempts.words, feedback: writingAttempts.feedback, createdAt: writingAttempts.createdAt })
    .from(writingAttempts)
    .innerJoin(users, eq(users.id, writingAttempts.userId))
    .where(inArray(writingAttempts.userId, studentIds))
    .orderBy(desc(writingAttempts.createdAt))
    .limit(200);
  const avg = (pick: (f: WritingFeedback) => number) => Math.round((rows.reduce((a, r) => a + pick(r.feedback), 0) / rows.length) * 10) / 10;
  return {
    attempts: rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name, rollNo: r.rollNo, task: taskOf(r.taskId)?.title ?? r.taskId, kind: taskOf(r.taskId)?.kind ?? "email", words: r.words, overall: r.feedback.overall, scores: r.feedback.scores, createdAt: r.createdAt })),
    averages: rows.length ? { count: rows.length, overall: avg((f) => f.overall), ...Object.fromEntries(WRITING_DIMENSIONS.map(([key]) => [key, avg((f) => f.scores[key] ?? 0)])) } : null,
  };
}

/** One marked answer, for a teacher (the caller checks the student is in their scope). */
export async function writingForStaff(db: Db, tenantId: string, id: string) {
  const [row] = await db.select().from(writingAttempts).where(and(eq(writingAttempts.id, id), eq(writingAttempts.tenantId, tenantId)));
  if (!row) throw notFound("Answer");
  const [student] = await db.select({ name: users.name, rollNo: users.rollNo }).from(users).where(eq(users.id, row.userId));
  return { userId: row.userId, student, ...view(row) };
}
