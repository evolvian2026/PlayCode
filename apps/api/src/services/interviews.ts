import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { deliverySummary, interviewDimensions, masteryFromRating, READINESS_PROFILES, spokenAnswer, type InterviewContext, type InterviewTrack } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { interviewExperiences, interviews, placementApplications, placementDrives, resumeEntries, skillRatings, skills, users, type InterviewTurn } from "../db/schema";
import { aiProvider, AiUnavailableError, type HrScorecardOut, type InterviewInput, type ProjectScorecardOut, type TechnicalScorecardOut } from "../lib/ai";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";

// AI mock interviews: a short text interview with Claude as the interviewer,
// either a technical round pitched at service or product companies (leaning
// on the student's weakest relevant skills), an HR round scored on how well
// answers tell a real story (situation, task, action, result), or a project
// round about the student's own projects and internships. Any of the first
// three can be practice for a drive the student registered for, pitched with
// what past candidates reported of that company. It ends in a scorecard the
// student and their teachers can see. The server keeps the transcript and
// enforces the limits.

/** Answers per interview, and interviews a student may start per week. */
export const MAX_ANSWERS = 8;
export const WEEKLY_LIMIT = 3;
const MIN_ANSWERS_TO_SCORE = 2;
const DAY_MS = 86_400_000;

type Track = InterviewTrack;
type Mode = "text" | "voice";
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
  // The HR and project rounds aren't about skills.
  if (track === "hr" || track === "project") return [];
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
    mode: row.mode,
    status: row.status,
    driveId: row.driveId,
    company: row.context?.company ?? null,
    role: row.context?.role ?? null,
    projects: row.context?.projects?.map((p) => p.title) ?? [],
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
    interviews: rows.map((r) => ({ id: r.id, track: r.track, mode: r.mode, status: r.status, company: r.context?.company ?? null, overall: r.scorecard?.overall ?? null, answers: answersIn(r.turns), startedAt: r.startedAt, finishedAt: r.finishedAt })),
    // What the project round would ask about, and the drives there's practice for.
    projects: (await projectsOf(db, ctx)).map((p) => p.title),
    drives: await drivesToPractise(db, ctx),
  };
}

/** The projects and internships on the student's resume, most recent first: what the project round asks about. */
async function projectsOf(db: DbOrTx, ctx: Ctx): Promise<NonNullable<InterviewContext["projects"]>> {
  const rows = await db
    .select()
    .from(resumeEntries)
    .where(and(eq(resumeEntries.userId, ctx.userId), eq(resumeEntries.tenantId, ctx.tenantId), inArray(resumeEntries.kind, ["project", "internship"])))
    .orderBy(desc(resumeEntries.startMonth));
  return rows.slice(0, 4).map((r) => ({ kind: r.kind as "project" | "internship", title: r.title, organisation: r.organisation, months: `${r.startMonth} to ${r.endMonth ?? "now"}`, description: r.description.slice(0, 1200), link: r.link }));
}

/** Drives the student is registered for that haven't happened yet. */
async function drivesToPractise(db: DbOrTx, ctx: Ctx) {
  const today = ctx.now.toISOString().slice(0, 10);
  const rows = await db
    .select({ id: placementDrives.id, company: placementDrives.company, roleTitle: placementDrives.roleTitle, companyType: placementDrives.companyType, driveDate: placementDrives.driveDate, status: placementApplications.status })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.userId, ctx.userId), eq(placementApplications.tenantId, ctx.tenantId), gte(placementDrives.driveDate, today)))
    .orderBy(placementDrives.driveDate);
  return rows.filter((r) => r.status === "registered" || r.status === "shortlisted").map(({ status: _, ...d }) => d);
}

/** What students reported of a company's rounds in past drives here, published ones only and without names. */
async function experiencesOf(db: DbOrTx, tenantId: string, company: string) {
  const rows = await db
    .select({ rounds: interviewExperiences.rounds, tips: interviewExperiences.tips, difficulty: interviewExperiences.difficulty })
    .from(interviewExperiences)
    .innerJoin(placementDrives, eq(placementDrives.id, interviewExperiences.driveId))
    .where(and(eq(interviewExperiences.tenantId, tenantId), eq(interviewExperiences.status, "published"), sql`lower(${placementDrives.company}) = lower(${company})`))
    .orderBy(desc(interviewExperiences.publishedAt))
    .limit(6);
  return rows.map((r) =>
    [...r.rounds.filter((x) => x.description.trim()).map((x) => `${x.name}: ${x.description.slice(0, 600)}`), ...(r.tips.trim() ? [`Tips: ${r.tips.slice(0, 300)}`] : []), `Difficulty ${r.difficulty} of 5`].join("\n"),
  );
}

export async function getMine(db: Db, ctx: Ctx, id: string) {
  return view(db, await load(db, ctx.userId, id));
}

function input(row: Pick<Row, "track" | "turns" | "mode" | "context">, focus: { id: string; name: string }[]): InterviewInput {
  return { track: row.track, mode: row.mode, context: row.context, focusSkills: focus, turns: row.turns.map(({ role, text }) => ({ role, text })), answersLeft: MAX_ANSWERS - answersIn(row.turns) };
}

const deliveryOf = (turns: InterviewTurn[]) => deliverySummary(turns.flatMap((t) => (t.role === "candidate" && t.voice ? [t.voice] : [])));

/**
 * Start an interview (or return the one already in progress). With a drive,
 * it's practice for that company: a technical round takes the company's kind
 * (service or product), and past candidates' reports shape the questions.
 */
export async function startInterview(db: Db, ctx: Ctx, requested: Track, mode: Mode = "text", driveId: string | null = null) {
  const [active] = await db.select().from(interviews).where(and(eq(interviews.userId, ctx.userId), eq(interviews.status, "active")));
  if (active) return view(db, active);
  const allowed = await interviewAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(interviews)
    .where(and(eq(interviews.userId, ctx.userId), gte(interviews.startedAt, new Date(ctx.now.getTime() - 7 * DAY_MS))))) as [{ n: number }];
  if (n >= WEEKLY_LIMIT) throw badRequest(`You can start ${WEEKLY_LIMIT} mock interviews a week. Practise the skills from your last scorecard meanwhile.`);

  let track = requested;
  let context: InterviewContext | null = null;
  if (driveId) {
    if (requested === "project") throw badRequest("Practise for a drive in a technical or HR round");
    const drive = (await drivesToPractise(db, ctx)).find((d) => d.id === driveId);
    if (!drive) throw notFound("Drive you're registered for");
    if (requested !== "hr") track = drive.companyType === "product" ? "product" : "service";
    context = { company: drive.company, role: drive.roleTitle, experiences: await experiencesOf(db, ctx.tenantId, drive.company) };
  }
  if (track === "project") {
    const projects = await projectsOf(db, ctx);
    if (!projects.length) throw badRequest("Add a project or internship to your resume first: the project round asks about them.");
    context = { projects };
  }

  const focus = (await relevantSkills(db, ctx.userId, track)).slice(0, 3).map(({ id, name }) => ({ id, name }));
  let first;
  try {
    first = await aiProvider()!.interviewTurn({ track, mode, context, focusSkills: focus, turns: [], answersLeft: MAX_ANSWERS });
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "mock_interview", usage: first.usage, now: ctx.now });
  const [row] = await db
    .insert(interviews)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, track, mode, driveId, context, focusSkills: focus.map((f) => f.id), turns: [{ role: "interviewer", text: first.value.message, at: ctx.now.toISOString() }], startedAt: ctx.now })
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
  const delivery = deliveryOf(row.turns);
  let res;
  try {
    res = await aiProvider()!.interviewScorecard({ ...input(row, await focusOf(db, row)), skillChoices: choices, delivery });
  } catch (err) {
    aiError(err);
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "mock_interview", usage: res.usage, now: ctx.now });
  const clamp = (n: number | undefined) => Math.min(5, Math.max(1, Math.round(n ?? 1)));
  const valid = new Set(choices.map((c) => c.id));
  const card = res.value;
  const scores = card.scores as Record<string, number>;
  return {
    scores: Object.fromEntries(interviewDimensions(row.track).map(([key]) => [key, clamp(scores[key])])),
    overall: clamp(card.overall),
    strengths: card.strengths.slice(0, 4),
    improvements: card.improvements.slice(0, 4),
    summary: card.summary,
    practise: row.track === "hr" || row.track === "project" ? [] : [...new Set((card as TechnicalScorecardOut).practise.filter((id) => valid.has(id)))].slice(0, 3),
    ...(row.track === "hr" || row.track === "project" ? { prepare: ((card as HrScorecardOut | ProjectScorecardOut).prepare ?? []).slice(0, 3) } : {}),
    delivery,
  };
}

export async function answer(db: Db, ctx: Ctx, id: string, text: string, voice?: { durationMs: number; edited: boolean }) {
  const row = await load(db, ctx.userId, id);
  if (row.status !== "active") throw badRequest("This interview has finished");
  if (row.turns.at(-1)?.role !== "interviewer") throw conflict("interview_changed", "Your answer is already in. Reload to continue.");
  const allowed = await interviewAvailability(db, ctx);
  if (!allowed.ok) throw badRequest(allowed.reason);
  // Pace is measured on what was sent; an answer typed in a voice interview has no delivery stats.
  const spoken = voice && row.mode === "voice" ? { ...spokenAnswer(text, voice.durationMs), edited: voice.edited } : undefined;
  const turns: InterviewTurn[] = [...row.turns, { role: "candidate", text, at: ctx.now.toISOString(), ...(spoken ? { voice: spoken } : {}) }];
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
  if (studentIds.length === 0) return { interviews: [], averages: null, hrAverages: null, projectAverages: null };
  const rows = await db
    .select({ id: interviews.id, userId: interviews.userId, name: users.name, rollNo: users.rollNo, track: interviews.track, mode: interviews.mode, scorecard: interviews.scorecard, finishedAt: interviews.finishedAt })
    .from(interviews)
    .innerJoin(users, eq(users.id, interviews.userId))
    .where(and(inArray(interviews.userId, studentIds), eq(interviews.status, "finished")))
    .orderBy(desc(interviews.finishedAt))
    .limit(200);
  // Technical, HR and project rounds are scored on different dimensions, so they're averaged apart.
  const averagesOf = (kind: "technical" | "hr" | "project") => {
    const group = rows.filter((r) => (kind === "technical" ? r.track === "service" || r.track === "product" : r.track === kind));
    if (!group.length) return null;
    const avg = (pick: (s: NonNullable<Row["scorecard"]>) => number) => Math.round((group.reduce((a, r) => a + pick(r.scorecard!), 0) / group.length) * 10) / 10;
    return {
      count: group.length,
      overall: avg((s) => s.overall),
      ...Object.fromEntries(interviewDimensions(kind === "technical" ? "service" : kind).map(([key]) => [key, avg((s) => s.scores[key] ?? 0)])),
    };
  };
  return {
    interviews: rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name, rollNo: r.rollNo, track: r.track, mode: r.mode, overall: r.scorecard!.overall, scores: r.scorecard!.scores, finishedAt: r.finishedAt })),
    averages: averagesOf("technical"),
    hrAverages: averagesOf("hr"),
    projectAverages: averagesOf("project"),
  };
}

/** One interview with transcript, for a teacher (the caller checks the student is in their scope). */
export async function interviewForStaff(db: Db, tenantId: string, id: string) {
  const [row] = await db.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.tenantId, tenantId)));
  if (!row) throw notFound("Interview");
  const [student] = await db.select({ name: users.name, rollNo: users.rollNo }).from(users).where(eq(users.id, row.userId));
  return { userId: row.userId, student, ...(await view(db, row)) };
}
