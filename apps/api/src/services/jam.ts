import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { JAM_DIMENSIONS, JAM_PER_DAY, JAM_SECONDS, JAM_TOPICS, jamDelivery, MIN_JAM_WORDS } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { jamAttempts, users, type JamFeedback } from "../db/schema";
import { aiProvider, AiUnavailableError, type JamFeedbackOut } from "../lib/ai";
import { badRequest, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";
import { getTenant } from "./tenant";

// Speaking practice: a one-minute JAM talk. The browser transcribes the
// student's speech; the API measures delivery (core jamDelivery) and asks the
// AI to mark ideas, structure and language. Only the transcript and timings
// are stored. It sits with the AI coach (same plan feature and institution
// switch) and has its own daily limit.

const DAY_MS = 86_400_000;

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof jamAttempts.$inferSelect;

const topicOf = (id: string) => JAM_TOPICS.find((t) => t.id === id);

async function availability(db: DbOrTx, ctx: Ctx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!aiProvider() || (await getTenant(db, ctx.tenantId)).settings.aiHints === false) return { ok: false, reason: "AI feedback is not switched on for your institution." };
  return aiAllowed(db, ctx.tenantId, "ai_coach", ctx.now);
}

async function markedToday(db: DbOrTx, ctx: Ctx) {
  const [{ n }] = (await db.select({ n: count() }).from(jamAttempts).where(and(eq(jamAttempts.userId, ctx.userId), gte(jamAttempts.createdAt, new Date(ctx.now.getTime() - DAY_MS))))) as [{ n: number }];
  return n;
}

const view = (row: Row) => ({
  id: row.id,
  topic: topicOf(row.topicId) ?? { id: row.topicId, category: "everyday" as const, topic: row.topicId },
  transcript: row.transcript,
  delivery: jamDelivery(row.transcript, row.spokenMs),
  spokenMs: row.spokenMs,
  feedback: row.feedback,
  createdAt: row.createdAt,
});

export async function jamHome(db: Db, ctx: Ctx) {
  const rows = await db.select().from(jamAttempts).where(eq(jamAttempts.userId, ctx.userId)).orderBy(desc(jamAttempts.createdAt)).limit(30);
  const allowed = await availability(db, ctx);
  const best = new Map<string, number>();
  for (const r of rows) best.set(r.topicId, Math.max(best.get(r.topicId) ?? 0, r.feedback.overall));
  return {
    available: allowed.ok,
    reason: allowed.ok ? null : allowed.reason,
    leftToday: Math.max(0, JAM_PER_DAY - (await markedToday(db, ctx))),
    topics: JAM_TOPICS.map((t) => ({ ...t, best: best.get(t.id) ?? null })),
    attempts: rows.map((r) => ({ id: r.id, topicId: r.topicId, topic: topicOf(r.topicId)?.topic ?? r.topicId, overall: r.feedback.overall, words: r.words, wpm: r.wpm, spokenMs: r.spokenMs, createdAt: r.createdAt })),
  };
}

export async function getMyJam(db: Db, ctx: Ctx, id: string) {
  const [row] = await db.select().from(jamAttempts).where(and(eq(jamAttempts.id, id), eq(jamAttempts.userId, ctx.userId)));
  if (!row) throw notFound("Talk");
  return view(row);
}

/** Keep the model's feedback in shape: scores 1-5 and short lists. */
function clean(raw: JamFeedbackOut): JamFeedback {
  const clamp = (n: number | undefined) => Math.min(5, Math.max(1, Math.round(n ?? 1)));
  const scores = raw.scores as Record<string, number>;
  return {
    scores: Object.fromEntries(JAM_DIMENSIONS.map(([key]) => [key, clamp(scores[key])])),
    overall: clamp(raw.overall),
    strengths: raw.strengths.slice(0, 3),
    improvements: raw.improvements.slice(0, 3),
    betterOpening: raw.betterOpening.slice(0, 300),
    outline: raw.outline.slice(0, 3),
  };
}

export async function submitJam(db: Db, ctx: Ctx, input: { topicId: string; transcript: string; spokenMs: number }) {
  const topic = topicOf(input.topicId);
  if (!topic) throw badRequest("Unknown topic");
  const delivery = jamDelivery(input.transcript, input.spokenMs);
  if (delivery.words < MIN_JAM_WORDS) throw badRequest(`We heard only ${delivery.words} words. Speak for at least half a minute to get feedback.`);
  const allowed = await availability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  if ((await markedToday(db, ctx)) >= JAM_PER_DAY) throw new HttpError(429, "jam_daily_limit", `You've had ${JAM_PER_DAY} talks marked today. Try again tomorrow.`);

  let res;
  try {
    res = await aiProvider()!.jamFeedback({
      topic: topic.topic,
      transcript: input.transcript,
      words: delivery.words,
      seconds: Math.round(input.spokenMs / 1000),
      wordsPerMinute: delivery.wpm,
      fillersPer100Words: delivery.fillersPer100Words,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof AiUnavailableError) throw new HttpError(502, "jam_unavailable", err.message);
    throw new HttpError(503, "jam_unavailable", "The marker is busy right now. Try again in a moment.");
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "jam_feedback", usage: res.usage, now: ctx.now });
  const [row] = await db
    .insert(jamAttempts)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      topicId: topic.id,
      transcript: input.transcript,
      spokenMs: input.spokenMs,
      words: delivery.words,
      wpm: delivery.wpm,
      fillers: delivery.fillers,
      feedback: clean(res.value),
      createdAt: ctx.now,
    })
    .returning();
  return view(row!);
}

/** Talks by the given students, newest first, with averages, for teachers. */
export async function jamFor(db: Db, studentIds: string[]) {
  if (studentIds.length === 0) return { attempts: [], averages: null };
  const rows = await db
    .select({ id: jamAttempts.id, userId: jamAttempts.userId, name: users.name, rollNo: users.rollNo, topicId: jamAttempts.topicId, words: jamAttempts.words, wpm: jamAttempts.wpm, fillers: jamAttempts.fillers, spokenMs: jamAttempts.spokenMs, feedback: jamAttempts.feedback, createdAt: jamAttempts.createdAt })
    .from(jamAttempts)
    .innerJoin(users, eq(users.id, jamAttempts.userId))
    .where(inArray(jamAttempts.userId, studentIds))
    .orderBy(desc(jamAttempts.createdAt))
    .limit(200);
  const avg = (pick: (r: (typeof rows)[number]) => number) => Math.round((rows.reduce((a, r) => a + pick(r), 0) / rows.length) * 10) / 10;
  return {
    attempts: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      rollNo: r.rollNo,
      topic: topicOf(r.topicId)?.topic ?? r.topicId,
      words: r.words,
      wpm: r.wpm,
      fillersPer100Words: r.words ? Math.round((r.fillers / r.words) * 1000) / 10 : 0,
      usedPct: Math.min(100, Math.round((r.spokenMs / (JAM_SECONDS * 1000)) * 100)),
      overall: r.feedback.overall,
      scores: r.feedback.scores,
      createdAt: r.createdAt,
    })),
    averages: rows.length
      ? {
          count: rows.length,
          students: new Set(rows.map((r) => r.userId)).size,
          overall: avg((r) => r.feedback.overall),
          wpm: Math.round(avg((r) => r.wpm)),
          fillersPer100Words: avg((r) => (r.words ? (r.fillers / r.words) * 100 : 0)),
          ...Object.fromEntries(JAM_DIMENSIONS.map(([key]) => [key, avg((r) => r.feedback.scores[key] ?? 0)])),
        }
      : null,
  };
}

/** One talk, for a teacher (the caller checks the student is in their scope). */
export async function jamForStaff(db: Db, tenantId: string, id: string) {
  const [row] = await db.select().from(jamAttempts).where(and(eq(jamAttempts.id, id), eq(jamAttempts.tenantId, tenantId)));
  if (!row) throw notFound("Talk");
  const [student] = await db.select({ name: users.name, rollNo: users.rollNo }).from(users).where(eq(users.id, row.userId));
  return { userId: row.userId, student, ...view(row) };
}
