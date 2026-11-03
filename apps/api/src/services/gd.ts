import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { GD_DIMENSIONS, GD_MAX_CONTRIBUTIONS, GD_MAX_ROUNDS, GD_MIN_CONTRIBUTIONS, GD_PERSONAS, GD_TOPICS, gdParticipation, type GdSpeaker } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { groupDiscussions, users, type GdScorecard, type GdTurn } from "../db/schema";
import { aiProvider, AiUnavailableError, type GdInput } from "../lib/ai";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";

// Group discussion practice: a moderated GD on a topic between the student and
// three AI participants with different styles (assertive, contrarian,
// inclusive). Each round the student either speaks or listens, and the others
// reply. After six contributions or ten rounds the moderator asks for a
// summary, which the student may give. The scorecard follows the rubric campus
// recruiters use, alongside measured participation: how often the student
// spoke, their share of the words, whether they opened and whether they summed up.

export const GD_WEEKLY_LIMIT = 3;
const DAY_MS = 86_400_000;
const MESSAGES_PER_ROUND = 3;

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof groupDiscussions.$inferSelect;

const topicOf = (id: string) => GD_TOPICS.find((t) => t.id === id)!;
const contributions = (turns: GdTurn[]) => turns.filter((t) => t.speaker === "student" && !t.summary).length;

function aiError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof AiUnavailableError) throw new HttpError(502, "gd_unavailable", err.message);
  throw new HttpError(503, "gd_unavailable", "The group is busy right now. Try again in a moment.");
}

export async function gdAvailability(db: DbOrTx, ctx: Ctx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!aiProvider()) return { ok: false, reason: "Group discussion practice is not switched on." };
  return aiAllowed(db, ctx.tenantId, "ai_interviews", ctx.now);
}

async function firstName(db: DbOrTx, userId: string) {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name.split(/\s+/)[0] || "You";
}

function nameOf(speaker: GdSpeaker, student: string) {
  if (speaker === "moderator") return "Moderator";
  if (speaker === "student") return student;
  return GD_PERSONAS.find((p) => p.id === speaker)!.name;
}

function view(row: Row, student: string) {
  return {
    id: row.id,
    topic: topicOf(row.topicId),
    status: row.status,
    phase: row.phase,
    personas: GD_PERSONAS,
    turns: row.turns.map((t) => ({ ...t, name: nameOf(t.speaker, student) })),
    contributionsLeft: row.status === "active" && row.phase === "discussion" ? GD_MAX_CONTRIBUTIONS - contributions(row.turns) : 0,
    roundsLeft: row.status === "active" && row.phase === "discussion" ? GD_MAX_ROUNDS - row.rounds : 0,
    scorecard: row.scorecard,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

async function load(db: DbOrTx, userId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(groupDiscussions).where(and(eq(groupDiscussions.id, id), eq(groupDiscussions.userId, userId)));
  if (!row) throw notFound("Group discussion");
  return row;
}

export async function listMyGds(db: Db, ctx: Ctx) {
  const rows = await db.select().from(groupDiscussions).where(eq(groupDiscussions.userId, ctx.userId)).orderBy(desc(groupDiscussions.startedAt)).limit(20);
  const startedThisWeek = rows.filter((r) => r.startedAt.getTime() > ctx.now.getTime() - 7 * DAY_MS).length;
  const availability = await gdAvailability(db, ctx);
  const done = new Set(rows.filter((r) => r.status === "finished").map((r) => r.topicId));
  return {
    available: availability.ok,
    reason: availability.ok ? null : availability.reason,
    weeklyLeft: Math.max(0, GD_WEEKLY_LIMIT - startedThisWeek),
    active: rows.find((r) => r.status === "active")?.id ?? null,
    topics: GD_TOPICS.map((t) => ({ ...t, done: done.has(t.id) })),
    personas: GD_PERSONAS,
    discussions: rows.map((r) => ({ id: r.id, topic: topicOf(r.topicId), status: r.status, overall: r.scorecard?.overall ?? null, startedAt: r.startedAt, finishedAt: r.finishedAt })),
  };
}

export async function getMyGd(db: Db, ctx: Ctx, id: string) {
  return view(await load(db, ctx.userId, id), await firstName(db, ctx.userId));
}

/** Start a GD on the chosen topic, or the first one the student hasn't done. Returns the one in progress if any. */
export async function startGd(db: Db, ctx: Ctx, topicId?: string) {
  const student = await firstName(db, ctx.userId);
  const [active] = await db.select().from(groupDiscussions).where(and(eq(groupDiscussions.userId, ctx.userId), eq(groupDiscussions.status, "active")));
  if (active) return view(active, student);
  const allowed = await gdAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  const past = await db.select({ topicId: groupDiscussions.topicId, startedAt: groupDiscussions.startedAt }).from(groupDiscussions).where(eq(groupDiscussions.userId, ctx.userId));
  if (past.filter((p) => p.startedAt.getTime() > ctx.now.getTime() - 7 * DAY_MS).length >= GD_WEEKLY_LIMIT) {
    throw badRequest(`You can start ${GD_WEEKLY_LIMIT} group discussions a week. Work on the points from your last scorecard meanwhile.`);
  }
  if (topicId && !GD_TOPICS.some((t) => t.id === topicId)) throw badRequest("Unknown topic");
  const seen = new Set(past.map((p) => p.topicId));
  const topic = topicId ? topicOf(topicId) : (GD_TOPICS.find((t) => !seen.has(t.id)) ?? GD_TOPICS[past.length % GD_TOPICS.length]!);
  const opening = `Good afternoon, everyone. Today's topic is "${topic.title}". Anyone may begin. Please keep your points brief and let everyone speak.`;
  const [row] = await db
    .insert(groupDiscussions)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, topicId: topic.id, turns: [{ speaker: "moderator", text: opening, at: ctx.now.toISOString() }], startedAt: ctx.now })
    .returning();
  return view(row!, student);
}

/** Save only if nobody changed the transcript meanwhile (a double-submitted contribution, another tab). */
async function save(db: Db, row: Row, set: Partial<typeof groupDiscussions.$inferInsert>) {
  const [updated] = await db
    .update(groupDiscussions)
    .set(set)
    .where(and(eq(groupDiscussions.id, row.id), eq(groupDiscussions.status, "active"), sql`jsonb_array_length(${groupDiscussions.turns}) = ${row.turns.length}`))
    .returning();
  if (!updated) throw conflict("gd_changed", "This discussion moved on in another tab. Reload to continue.");
  return updated;
}

function aiInput(row: Pick<Row, "topicId" | "turns" | "rounds">, student: string, cue: GdInput["cue"]): GdInput {
  return {
    topic: topicOf(row.topicId).title,
    studentName: student,
    personas: GD_PERSONAS,
    turns: row.turns.map((t) => ({ name: nameOf(t.speaker, student), text: t.text })),
    cue,
    roundsLeft: GD_MAX_ROUNDS - row.rounds,
  };
}

const summaryRequest = (at: Date): GdTurn => ({ speaker: "moderator", text: "Thank you, everyone. We're almost out of time. Would someone like to sum up the discussion?", at: at.toISOString() });

/** One round: the student speaks (or listens), then the others reply. */
async function round(db: Db, ctx: Ctx, row: Row, said: string | null) {
  if (row.status !== "active") throw badRequest("This discussion has finished");
  if (row.phase !== "discussion") throw conflict("gd_summary", "The moderator has asked for a summary");
  if (said !== null && contributions(row.turns) >= GD_MAX_CONTRIBUTIONS) throw conflict("gd_no_turns", "You've had all your turns in this discussion");
  const allowed = await gdAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  const student = await firstName(db, ctx.userId);
  const at = ctx.now.toISOString();
  const turns: GdTurn[] = said === null ? [...row.turns] : [...row.turns, { speaker: "student", text: said, at }];
  let res;
  try {
    res = await aiProvider()!.gdTurn(aiInput({ ...row, turns, rounds: row.rounds + 1 }, student, said === null ? "listening" : "spoke"));
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "group_discussion", usage: res.usage, now: ctx.now });
  const replies = res.value.messages.filter((m) => GD_PERSONAS.some((p) => p.id === m.speaker) && m.text.trim()).slice(0, MESSAGES_PER_ROUND);
  turns.push(...replies.map((m): GdTurn => ({ speaker: m.speaker, text: m.text.trim().slice(0, 800), at })));
  const rounds = row.rounds + 1;
  const timeUp = rounds >= GD_MAX_ROUNDS || contributions(turns) >= GD_MAX_CONTRIBUTIONS;
  if (timeUp) turns.push(summaryRequest(ctx.now));
  return view(await save(db, row, { turns, rounds, phase: timeUp ? "summary" : "discussion" }), student);
}

export async function speak(db: Db, ctx: Ctx, id: string, text: string) {
  const row = await load(db, ctx.userId, id);
  // Once the moderator asks, what the student says is their summary, and it closes the discussion.
  if (row.status === "active" && row.phase === "summary") {
    const turns: GdTurn[] = [...row.turns, { speaker: "student", text, at: ctx.now.toISOString(), summary: true }];
    return close(db, ctx, row, turns);
  }
  return round(db, ctx, row, text);
}

export async function listen(db: Db, ctx: Ctx, id: string) {
  return round(db, ctx, await load(db, ctx.userId, id), null);
}

/** The student signals they're ready to wrap up: the moderator asks for a summary. */
export async function wrapUp(db: Db, ctx: Ctx, id: string) {
  const row = await load(db, ctx.userId, id);
  if (row.status !== "active") throw badRequest("This discussion has finished");
  if (row.phase === "summary") return getMyGd(db, ctx, id);
  return view(await save(db, row, { turns: [...row.turns, summaryRequest(ctx.now)], phase: "summary" }), await firstName(db, ctx.userId));
}

/** End without (or after) a summary: scored if the student took part enough, otherwise set aside. */
export async function finishGd(db: Db, ctx: Ctx, id: string) {
  const row = await load(db, ctx.userId, id);
  if (row.status !== "active") return getMyGd(db, ctx, id);
  return close(db, ctx, row, row.turns);
}

async function close(db: Db, ctx: Ctx, row: Row, turns: GdTurn[]) {
  const student = await firstName(db, ctx.userId);
  const participation = gdParticipation(turns);
  if (participation.contributions < GD_MIN_CONTRIBUTIONS) return view(await save(db, row, { turns, status: "abandoned", finishedAt: ctx.now }), student);
  const allowed = await gdAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  const closing: GdTurn = { speaker: "moderator", text: "Thank you, everyone. That's time.", at: ctx.now.toISOString() };
  let res;
  try {
    res = await aiProvider()!.gdScorecard({ ...aiInput({ ...row, turns: [...turns, closing] }, student, "listening"), participation });
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "group_discussion", usage: res.usage, now: ctx.now });
  const clamp = (n: number | undefined) => Math.min(5, Math.max(1, Math.round(n ?? 1)));
  const card = res.value;
  const scores = card.scores as Record<string, number>;
  const scorecard: GdScorecard = {
    // No summary given scores 1 for it, whatever the model said.
    scores: Object.fromEntries(GD_DIMENSIONS.map(([key]) => [key, key === "summary" && !participation.summarised ? 1 : clamp(scores[key])])),
    overall: clamp(card.overall),
    strengths: card.strengths.slice(0, 4),
    improvements: card.improvements.slice(0, 4),
    summary: card.summary,
    missedPoints: card.missedPoints.slice(0, 3),
    participation,
  };
  return view(await save(db, row, { turns: [...turns, closing], status: "finished", scorecard, finishedAt: ctx.now }), student);
}

/** Scored GDs of the given students, newest first, with averages, for teachers. */
export async function gdsFor(db: Db, studentIds: string[]) {
  if (studentIds.length === 0) return { discussions: [], averages: null };
  const rows = await db
    .select({ id: groupDiscussions.id, userId: groupDiscussions.userId, name: users.name, rollNo: users.rollNo, topicId: groupDiscussions.topicId, scorecard: groupDiscussions.scorecard, finishedAt: groupDiscussions.finishedAt })
    .from(groupDiscussions)
    .innerJoin(users, eq(users.id, groupDiscussions.userId))
    .where(and(inArray(groupDiscussions.userId, studentIds), eq(groupDiscussions.status, "finished")))
    .orderBy(desc(groupDiscussions.finishedAt))
    .limit(200);
  const avg = (pick: (s: GdScorecard) => number) => Math.round((rows.reduce((a, r) => a + pick(r.scorecard!), 0) / rows.length) * 10) / 10;
  return {
    discussions: rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name, rollNo: r.rollNo, topic: topicOf(r.topicId).title, overall: r.scorecard!.overall, scores: r.scorecard!.scores, participation: r.scorecard!.participation, finishedAt: r.finishedAt })),
    averages: rows.length
      ? { count: rows.length, overall: avg((s) => s.overall), sharePct: avg((s) => s.participation.sharePct), ...Object.fromEntries(GD_DIMENSIONS.map(([key]) => [key, avg((s) => s.scores[key] ?? 0)])) }
      : null,
  };
}

/** One GD with transcript, for a teacher (the caller checks the student is in their scope). */
export async function gdForStaff(db: Db, tenantId: string, id: string) {
  const [row] = await db.select().from(groupDiscussions).where(and(eq(groupDiscussions.id, id), eq(groupDiscussions.tenantId, tenantId)));
  if (!row) throw notFound("Group discussion");
  const [student] = await db.select({ name: users.name, rollNo: users.rollNo }).from(users).where(eq(users.id, row.userId));
  return { userId: row.userId, student, ...view(row, student?.name.split(/\s+/)[0] ?? "Student") };
}

