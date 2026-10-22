import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { masteryFromRating, READINESS_PROFILES } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { interviews, skillRatings, skills, users, type InterviewTurn } from "../db/schema";
import { aiProvider, AiUnavailableError, type InterviewInput } from "../lib/ai";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";

// AI mock interviews: a short text interview with Claude as the interviewer,
// pitched at service or product companies and leaning on the student's
// weakest relevant skills, ending in a scorecard the student and their
// teachers can see. The server keeps the transcript and enforces the limits.

/** Answers per interview, and interviews a student may start per week. */
export const MAX_ANSWERS = 8;
export const WEEKLY_LIMIT = 3;
const MIN_ANSWERS_TO_SCORE = 2;
const DAY_MS = 86_400_000;

type Track = "service" | "product";
type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof interviews.$inferSelect;

function aiError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof AiUnavailableError) throw new HttpError(502, "interviewer_unavailable", err.message);
  throw new HttpError(503, "interviewer_unavailable", "The interviewer is busy right now. Try again in a moment.");
}

export async function interviewAvailability(db: DbOrTx, ctx: Ctx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!aiProvider()) return { ok: false, reason: "Mock interviews are not switched on." };
  return aiAllowed(db, ctx.tenantId, "ai_interviews", ctx.now);
}

/** Skills in the topics this kind of company weighs most, the student's weakest first. */
async function relevantSkills(db: DbOrTx, userId: string, track: Track) {
  const profile = READINESS_PROFILES.find((p) => p.id === track)!;
  const all = await db.select({ id: skills.id, name: skills.name, topic: skills.topic, topicName: skills.topicName }).from(skills);
  const ratings = new Map((await db.select().from(skillRatings).where(eq(skillRatings.userId, userId))).map((r) => [r.skillId, r]));
  return all
    .filter((s) => (profile.weights[s.topic] ?? 0) >= 2)
    .map((s) => {
      const r = ratings.get(s.id);
      return { id: s.id, name: `${s.topicName}: ${s.name}`, weight: profile.weights[s.topic]!, mastery: r?.attempts ? masteryFromRating(r.rating) : 0 };
    })
    .sort((a, b) => a.mastery - b.mastery || b.weight - a.weight || a.id.localeCompare(b.id));
}

const answersIn = (turns: InterviewTurn[]) => turns.filter((t) => t.role === "candidate").length;

async function load(db: DbOrTx, userId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.userId, userId)));
  if (!row) throw notFound("Interview");
  return row;
}

async function view(db: DbOrTx, row: Row) {
  const names = row.focusSkills.length ? await db.select({ id: skills.id, name: skills.name }).from(skills).where(inArray(skills.id, [...row.focusSkills, ...(row.scorecard?.practise ?? [])])) : [];
  const name = (id: string) => names.find((n) => n.id === id)?.name ?? id;
  return {
    id: row.id,
    track: row.track,
    status: row.status,
    focusSkills: row.focusSkills.map((id) => ({ id, name: name(id) })),
    turns: row.turns,
    answersLeft: row.status === "active" ? MAX_ANSWERS - answersIn(row.turns) : 0,
    scorecard: row.scorecard ? { ...row.scorecard, practise: row.scorecard.practise.map((id) => ({ id, name: name(id) })) } : null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listMine(db: Db, ctx: Ctx) {
  const rows = await db.select().from(interviews).where(eq(interviews.userId, ctx.userId)).orderBy(desc(interviews.startedAt)).limit(20);
  const startedThisWeek = rows.filter((r) => r.startedAt.getTime() > ctx.now.getTime() - 7 * DAY_MS).length;
  const availability = await interviewAvailability(db, ctx);
  return {
    available: availability.ok,
    reason: availability.ok ? null : availability.reason,
    weeklyLeft: Math.max(0, WEEKLY_LIMIT - startedThisWeek),
    active: rows.find((r) => r.status === "active")?.id ?? null,
    interviews: rows.map((r) => ({ id: r.id, track: r.track, status: r.status, overall: r.scorecard?.overall ?? null, answers: answersIn(r.turns), startedAt: r.startedAt, finishedAt: r.finishedAt })),
  };
}

export async function getMine(db: Db, ctx: Ctx, id: string) {
  return view(db, await load(db, ctx.userId, id));
}

function input(row: Pick<Row, "track" | "turns">, focus: { id: string; name: string }[]): InterviewInput {
  return { track: row.track, focusSkills: focus, turns: row.turns.map(({ role, text }) => ({ role, text })), answersLeft: MAX_ANSWERS - answersIn(row.turns) };
}

/** Start an interview (or return the one already in progress). */
export async function startInterview(db: Db, ctx: Ctx, track: Track) {
  const [active] = await db.select().from(interviews).where(and(eq(interviews.userId, ctx.userId), eq(interviews.status, "active")));
  if (active) return view(db, active);
  const allowed = await interviewAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(interviews)
    .where(and(eq(interviews.userId, ctx.userId), gte(interviews.startedAt, new Date(ctx.now.getTime() - 7 * DAY_MS))))) as [{ n: number }];
  if (n >= WEEKLY_LIMIT) throw badRequest(`You can start ${WEEKLY_LIMIT} mock interviews a week. Practise the skills from your last scorecard meanwhile.`);

  const focus = (await relevantSkills(db, ctx.userId, track)).slice(0, 3).map(({ id, name }) => ({ id, name }));
  let first;
  try {
    first = await aiProvider()!.interviewTurn({ track, focusSkills: focus, turns: [], answersLeft: MAX_ANSWERS });
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "mock_interview", usage: first.usage, now: ctx.now });
  const [row] = await db
    .insert(interviews)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, track, focusSkills: focus.map((f) => f.id), turns: [{ role: "interviewer", text: first.value.message, at: ctx.now.toISOString() }], startedAt: ctx.now })
    .returning();
  return view(db, row!);
}

/** Save turns only if nobody else changed the transcript meanwhile (a double-submitted answer). */
async function saveTurns(db: Db, row: Row, turns: InterviewTurn[], extra: Partial<typeof interviews.$inferInsert> = {}) {
  const updated = await db
    .update(interviews)
    .set({ turns, ...extra })
    .where(and(eq(interviews.id, row.id), eq(interviews.status, "active"), sql`jsonb_array_length(${interviews.turns}) = ${row.turns.length}`))
    .returning();
  if (!updated[0]) throw conflict("interview_changed", "This interview moved on in another tab. Reload to continue.");
  return updated[0];
}

async function focusOf(db: DbOrTx, row: Row) {
  const names = await db.select({ id: skills.id, name: skills.name, topicName: skills.topicName }).from(skills).where(inArray(skills.id, row.focusSkills.length ? row.focusSkills : ["-"]));
  return row.focusSkills.map((id) => {
    const s = names.find((n) => n.id === id);
    return { id, name: s ? `${s.topicName}: ${s.name}` : id };
  });
}

async function score(db: Db, ctx: Ctx, row: Row) {
  const choices = (await relevantSkills(db, ctx.userId, row.track)).map(({ id, name }) => ({ id, name }));
  let res;
  try {
    res = await aiProvider()!.interviewScorecard({ ...input(row, await focusOf(db, row)), skillChoices: choices });
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "mock_interview", usage: res.usage, now: ctx.now });
  const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
  const valid = new Set(choices.map((c) => c.id));
  const card = res.value;
  return {
    scores: { problemSolving: clamp(card.scores.problemSolving), fundamentals: clamp(card.scores.fundamentals), communication: clamp(card.scores.communication), code: clamp(card.scores.code) },
    overall: clamp(card.overall),
    strengths: card.strengths.slice(0, 4),
    improvements: card.improvements.slice(0, 4),
    summary: card.summary,
    practise: [...new Set(card.practise.filter((id) => valid.has(id)))].slice(0, 3),
  };
}

export async function answer(db: Db, ctx: Ctx, id: string, text: string) {
  const row = await load(db, ctx.userId, id);
  if (row.status !== "active") throw badRequest("This interview has finished");
  if (row.turns.at(-1)?.role !== "interviewer") throw conflict("interview_changed", "Your answer is already in. Reload to continue.");
  const allowed = await interviewAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  const turns: InterviewTurn[] = [...row.turns, { role: "candidate", text, at: ctx.now.toISOString() }];
  const withAnswer = { ...row, turns };
  let next;
  try {
    next = await aiProvider()!.interviewTurn(input(withAnswer, await focusOf(db, row)));
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "mock_interview", usage: next.usage, now: ctx.now });
  const all: InterviewTurn[] = [...turns, { role: "interviewer", text: next.value.message, at: ctx.now.toISOString() }];
  // The interview ends when the interviewer closes it, or when the answers run out.
  if (!next.value.done && answersIn(all) < MAX_ANSWERS) return view(db, await saveTurns(db, row, all));
  const scorecard = await score(db, ctx, { ...row, turns: all });
  return view(db, await saveTurns(db, row, all, { status: "finished", scorecard, finishedAt: ctx.now }));
}

/** End early: scored if there is enough to go on, otherwise set aside. */
export async function finishEarly(db: Db, ctx: Ctx, id: string) {
  const row = await load(db, ctx.userId, id);
  if (row.status !== "active") return view(db, row);
  if (answersIn(row.turns) < MIN_ANSWERS_TO_SCORE) return view(db, await saveTurns(db, row, row.turns, { status: "abandoned", finishedAt: ctx.now }));
  const scorecard = await score(db, ctx, row);
  return view(db, await saveTurns(db, row, row.turns, { status: "finished", scorecard, finishedAt: ctx.now }));
}

/** Scored interviews of the given students, newest first, for teachers. */
export async function interviewsFor(db: Db, studentIds: string[]) {
  if (studentIds.length === 0) return { interviews: [], averages: null };
  const rows = await db
    .select({ id: interviews.id, userId: interviews.userId, name: users.name, rollNo: users.rollNo, track: interviews.track, scorecard: interviews.scorecard, finishedAt: interviews.finishedAt })
    .from(interviews)
    .innerJoin(users, eq(users.id, interviews.userId))
    .where(and(inArray(interviews.userId, studentIds), eq(interviews.status, "finished")))
    .orderBy(desc(interviews.finishedAt))
    .limit(200);
  const avg = (pick: (s: NonNullable<Row["scorecard"]>) => number) => Math.round((rows.reduce((a, r) => a + pick(r.scorecard!), 0) / Math.max(1, rows.length)) * 10) / 10;
  return {
    interviews: rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name, rollNo: r.rollNo, track: r.track, overall: r.scorecard!.overall, scores: r.scorecard!.scores, finishedAt: r.finishedAt })),
    averages: rows.length
      ? { overall: avg((s) => s.overall), problemSolving: avg((s) => s.scores.problemSolving), fundamentals: avg((s) => s.scores.fundamentals), communication: avg((s) => s.scores.communication), code: avg((s) => s.scores.code) }
      : null,
  };
}

/** One interview with transcript, for a teacher (the caller checks the student is in their scope). */
export async function interviewForStaff(db: Db, tenantId: string, id: string) {
  const [row] = await db.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.tenantId, tenantId)));
  if (!row) throw notFound("Interview");
  const [student] = await db.select({ name: users.name, rollNo: users.rollNo }).from(users).where(eq(users.id, row.userId));
  return { userId: row.userId, student, ...(await view(db, row)) };
}
