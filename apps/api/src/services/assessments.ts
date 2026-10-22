import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  codeSimilarity,
  grade,
  hashString,
  INTEGRITY_EVENT_TYPES,
  needsExecution,
  riskScore,
  scoreAttempt,
  shuffle,
  toStudentView,
  type IntegrityEventType,
  type StudentResponse,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import {
  assessmentAttempts,
  assessments,
  attemptSnapshots,
  integrityEvents,
  plagiarismPairs,
  questions,
  users,
  type AssessmentSection,
  type AttemptResult,
} from "../db/schema";
import { checkRunRate, evaluate, tryRun } from "../execution";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { putObject } from "../lib/storage";
import { toCoreQuestion, type StudentCtx } from "./practice";
import { descendants, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits } from "./scope";

/** Answers saved within this grace period after the deadline still count (network lag). */
export const GRACE_MS = 30_000;
const SIMILARITY_FLAG = 0.85;
const MAX_SNAPSHOT_BYTES = 300_000;

type AttemptRow = typeof assessmentAttempts.$inferSelect;
type AssessmentRow = typeof assessments.$inferSelect;

export async function getAssessment(db: DbOrTx, tenantId: string, id: string): Promise<AssessmentRow> {
  const [a] = await db.select().from(assessments).where(and(eq(assessments.id, id), eq(assessments.tenantId, tenantId)));
  if (!a) throw notFound("Assessment");
  return a;
}

export function resultsVisible(a: AssessmentRow): boolean {
  return a.releasePolicy === "immediate" || a.resultsReleasedAt !== null;
}

// ---------- Creating ----------

export interface SectionInput {
  title: string;
  packId?: string;
  skillIds?: string[];
  questionIds?: string[];
  pick: number;
  marks: number;
  negative: number;
}

export async function resolveSections(db: DbOrTx, tenantId: string, input: SectionInput[], packQuestionIds: (id: string) => Promise<string[]>): Promise<AssessmentSection[]> {
  const out: AssessmentSection[] = [];
  for (const s of input) {
    let pool: string[];
    if (s.questionIds?.length) pool = s.questionIds;
    else if (s.packId) pool = await packQuestionIds(s.packId);
    else if (s.skillIds?.length) {
      const rows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(inArray(questions.skillId, s.skillIds), eq(questions.status, "live"), sql`(${questions.tenantId} is null or ${questions.tenantId} = ${tenantId})`))
        .orderBy(asc(questions.id));
      pool = rows.map((r) => r.id);
    } else throw badRequest(`Section "${s.title}" needs skills, a pack or questions`);
    if (pool.length === 0) throw badRequest(`Section "${s.title}" has no questions`);
    if (s.pick > pool.length) throw badRequest(`Section "${s.title}" asks for ${s.pick} questions but only ${pool.length} are available`);
    out.push({ title: s.title, questionIds: pool, pick: s.pick, marks: s.marks, negative: s.negative });
  }
  return out;
}

// ---------- Student side ----------

async function assertTargeted(db: DbOrTx, a: AssessmentRow, ctx: StudentCtx) {
  const units = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  if (!a.orgUnitIds.some((u) => units.has(u))) throw forbidden("This test is not for your batch");
}

export async function studentAssessments(db: Db, ctx: StudentCtx) {
  const units = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  const recent = new Date(ctx.now.getTime() - 30 * 86_400_000);
  const rows = (await db.select().from(assessments).where(eq(assessments.tenantId, ctx.tenantId)).orderBy(asc(assessments.openAt))).filter(
    (a) => a.orgUnitIds.some((u) => units.has(u)) && a.closeAt > recent,
  );
  const attempts = rows.length
    ? await db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.userId, ctx.userId), inArray(assessmentAttempts.assessmentId, rows.map((r) => r.id))))
    : [];
  return rows.map((a) => {
    const at = attempts.find((x) => x.assessmentId === a.id);
    const state = at ? (at.status === "in_progress" ? "in_progress" : "submitted") : ctx.now < a.openAt ? "upcoming" : ctx.now > a.closeAt ? "missed" : "open";
    return {
      id: a.id,
      title: a.title,
      proctorLevel: a.proctorLevel,
      durationMinutes: a.durationMinutes,
      openAt: a.openAt,
      closeAt: a.closeAt,
      questionCount: a.sections.reduce((n, s) => n + s.pick, 0),
      state,
      attemptId: at?.id ?? null,
      score: at && resultsVisible(a) && at.score !== null ? at.score / 100 : null,
      maxScore: at && resultsVisible(a) && at.maxScore !== null ? at.maxScore / 100 : null,
    };
  });
}

export async function startAttempt(db: Db, ctx: StudentCtx, assessmentId: string, deviceId: string) {
  const a = await getAssessment(db, ctx.tenantId, assessmentId);
  await assertTargeted(db, a, ctx);
  const [existing] = await db
    .select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.assessmentId, a.id), eq(assessmentAttempts.userId, ctx.userId)));
  if (existing) {
    if (existing.status !== "in_progress") throw conflict("already_submitted", "You have already submitted this test");
    if (existing.deviceId && existing.deviceId !== deviceId) {
      await recordEvents(db, existing, [{ type: "device_changed", detail: "Tried to open the test on another device" }], ctx.now);
      // Strict tests stay on one device until a proctor allows the switch.
      if (a.proctorLevel >= 2) throw conflict("device_locked", "This test is open on another device. Ask your proctor to allow a switch.");
      await db.update(assessmentAttempts).set({ deviceId }).where(eq(assessmentAttempts.id, existing.id));
    }
    return attemptView(db, ctx, existing.id);
  }
  if (ctx.now < a.openAt) throw badRequest("This test has not opened yet");
  if (ctx.now > a.closeAt) throw badRequest("This test has closed");
  // Each student draws their own questions from each section's pool, in their own order.
  const seed = hashString(`${a.id}:${ctx.userId}`);
  const drawn = a.sections.flatMap((s, i) => shuffle(s.questionIds, seed + i).slice(0, s.pick).map((questionId) => ({ questionId, section: i })));
  const deadline = new Date(Math.min(ctx.now.getTime() + a.durationMinutes * 60_000, a.closeAt.getTime()));
  const [created] = await db
    .insert(assessmentAttempts)
    .values({ assessmentId: a.id, tenantId: ctx.tenantId, userId: ctx.userId, questions: drawn, startedAt: ctx.now, deadline, deviceId, lastSeenAt: ctx.now })
    .onConflictDoNothing()
    .returning();
  if (!created) return startAttempt(db, ctx, assessmentId, deviceId); // a parallel request created it first
  return attemptView(db, ctx, created.id);
}

async function loadOwnAttempt(db: DbOrTx, ctx: StudentCtx, attemptId: string): Promise<AttemptRow> {
  const [at] = await db.select().from(assessmentAttempts).where(eq(assessmentAttempts.id, attemptId));
  if (!at || at.userId !== ctx.userId) throw notFound("Test attempt");
  return at;
}

export async function attemptView(db: Db, ctx: StudentCtx, attemptId: string) {
  let at = await loadOwnAttempt(db, ctx, attemptId);
  if (at.status === "in_progress" && ctx.now.getTime() > at.deadline.getTime() + GRACE_MS) {
    await submitAttempt(db, at.id, ctx.now, "auto_submitted");
    at = await loadOwnAttempt(db, ctx, attemptId);
  }
  const a = await getAssessment(db, ctx.tenantId, at.assessmentId);
  const qRows = await db.select().from(questions).where(inArray(questions.id, at.questions.map((q) => q.questionId)));
  const byId = new Map(qRows.map((q) => [q.id, q]));
  if (at.status === "in_progress") await db.update(assessmentAttempts).set({ lastSeenAt: ctx.now }).where(eq(assessmentAttempts.id, at.id));
  const visible = resultsVisible(a);
  return {
    id: at.id,
    assessment: { id: a.id, title: a.title, instructions: a.instructions, proctorLevel: a.proctorLevel, durationMinutes: a.durationMinutes, sections: a.sections.map((s) => ({ title: s.title, marks: s.marks, negative: s.negative })) },
    status: at.status,
    deadline: at.deadline,
    timeLeftMs: Math.max(0, at.deadline.getTime() - ctx.now.getTime()),
    questions:
      at.status === "in_progress"
        ? at.questions.map((q) => ({ section: q.section, question: toStudentView(toCoreQuestion(byId.get(q.questionId)!), at.id), saved: at.answers[q.questionId]?.response ?? null }))
        : [],
    result:
      at.status !== "in_progress" && visible
        ? { score: (at.score ?? 0) / 100, maxScore: (at.maxScore ?? 0) / 100, sections: at.sectionScores }
        : null,
    resultsPending: at.status !== "in_progress" && !visible,
  };
}

function assertWritable(at: AttemptRow, now: Date) {
  if (at.status !== "in_progress") throw conflict("submitted", "This test has been submitted");
  if (now.getTime() > at.deadline.getTime() + GRACE_MS) throw conflict("time_up", "Time is up");
}

export async function saveAnswer(db: Db, ctx: StudentCtx, attemptId: string, input: { questionId: string; response: StudentResponse | null }) {
  const at = await loadOwnAttempt(db, ctx, attemptId);
  assertWritable(at, ctx.now);
  if (!at.questions.some((q) => q.questionId === input.questionId)) throw badRequest("That question is not in your test");
  // jsonb_set keeps concurrent saves of different questions from overwriting each other.
  const value = input.response ? { response: input.response, savedAt: ctx.now.toISOString() } : null;
  await db
    .update(assessmentAttempts)
    .set({
      answers: value
        ? sql`jsonb_set(${assessmentAttempts.answers}, ${`{${input.questionId}}`}::text[], ${JSON.stringify(value)}::jsonb, true)`
        : sql`${assessmentAttempts.answers} - ${input.questionId}`,
      lastSeenAt: ctx.now,
    })
    .where(eq(assessmentAttempts.id, at.id));
  return { savedAt: ctx.now };
}

export async function runInAttempt(db: Db, ctx: StudentCtx, attemptId: string, input: { questionId: string; response: StudentResponse }) {
  const at = await loadOwnAttempt(db, ctx, attemptId);
  assertWritable(at, ctx.now);
  if (!at.questions.some((q) => q.questionId === input.questionId)) throw badRequest("That question is not in your test");
  const [q] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  checkRunRate(ctx.userId, ctx.now.getTime());
  return tryRun(toCoreQuestion(q!), input.response);
}

async function recordEvents(db: DbOrTx, at: AttemptRow, events: { type: IntegrityEventType; detail?: string }[], now: Date) {
  if (events.length === 0) return;
  await db.insert(integrityEvents).values(events.map((e) => ({ attemptId: at.id, type: e.type, detail: e.detail?.slice(0, 200) ?? null, at: now })));
  const counts = { ...at.integrity };
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  await db
    .update(assessmentAttempts)
    .set({ integrity: counts, riskScore: riskScore(counts, at.maxSimilarity / 100) })
    .where(eq(assessmentAttempts.id, at.id));
}

export async function logIntegrity(db: Db, ctx: StudentCtx, attemptId: string, events: { type: string; detail?: string }[]) {
  const at = await loadOwnAttempt(db, ctx, attemptId);
  if (at.status !== "in_progress") return { ok: true };
  const valid = events.filter((e): e is { type: IntegrityEventType; detail?: string } => (INTEGRITY_EVENT_TYPES as readonly string[]).includes(e.type)).slice(0, 50);
  await recordEvents(db, at, valid, ctx.now);
  await db.update(assessmentAttempts).set({ lastSeenAt: ctx.now }).where(eq(assessmentAttempts.id, at.id));
  return { ok: true };
}

export async function saveSnapshot(db: Db, ctx: StudentCtx, attemptId: string, dataUrl: string) {
  const at = await loadOwnAttempt(db, ctx, attemptId);
  assertWritable(at, ctx.now);
  const a = await getAssessment(db, ctx.tenantId, at.assessmentId);
  if (a.proctorLevel < 2) throw badRequest("This test does not use the camera");
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest("Snapshots must be JPEG, PNG or WebP images");
  const data = Buffer.from(m[2]!, "base64");
  if (data.length > MAX_SNAPSHOT_BYTES) throw badRequest("Snapshot is too large");
  const key = `snapshots/${at.tenantId}/${at.id}/${ctx.now.getTime()}-${randomUUID().slice(0, 8)}`;
  await putObject(key, data);
  await db.insert(attemptSnapshots).values({ attemptId: at.id, storageKey: key, contentType: m[1]!, at: ctx.now });
  return { ok: true };
}

// ---------- Submitting and grading ----------

/** Grade every answer, score the sections, and compare code with other submissions. */
export async function submitAttempt(db: Db, attemptId: string, now: Date, status: "submitted" | "auto_submitted") {
  const [at] = await db.select().from(assessmentAttempts).where(eq(assessmentAttempts.id, attemptId));
  if (!at || at.status !== "in_progress") return;
  const a = (await db.select().from(assessments).where(eq(assessments.id, at.assessmentId)))[0]!;
  const qRows = await db.select().from(questions).where(inArray(questions.id, at.questions.map((q) => q.questionId)));
  const byId = new Map(qRows.map((q) => [q.id, q]));
  const results: AttemptResult[] = [];
  for (const { questionId, section } of at.questions) {
    const saved = at.answers[questionId];
    const q = byId.get(questionId)!;
    if (!saved) {
      results.push({ questionId, section, answered: false, score: 0, correct: false });
      continue;
    }
    if (needsExecution(q.answer)) {
      try {
        const e = await evaluate(toCoreQuestion(q), saved.response, "assessment");
        const detail = e.kind === "code" ? { passed: e.passed, total: e.total, compileError: Boolean(e.compileError) } : { ok: e.result.ok };
        results.push({ questionId, section, answered: true, score: e.score, correct: e.correct, detail });
      } catch {
        // A malformed answer (wrong language, too long) scores zero rather than blocking submission.
        results.push({ questionId, section, answered: true, score: 0, correct: false });
      }
    } else {
      const correct = grade(q.answer, saved.response);
      results.push({ questionId, section, answered: true, score: correct ? 1 : 0, correct });
    }
  }
  const scored = scoreAttempt(a.sections, results);
  const [updated] = await db
    .update(assessmentAttempts)
    .set({ status, submittedAt: now, results, score: Math.round(scored.score * 100), maxScore: Math.round(scored.max * 100), sectionScores: scored.sections })
    .where(and(eq(assessmentAttempts.id, at.id), eq(assessmentAttempts.status, "in_progress")))
    .returning();
  if (updated) await checkPlagiarism(db, updated, byId);
}

/** Compare this attempt's code answers with every other submitted attempt on the same question. */
async function checkPlagiarism(db: Db, at: AttemptRow, byId: Map<string, typeof questions.$inferSelect>) {
  const codeQuestions = at.questions.filter((q) => byId.get(q.questionId)?.type === "write_code" && at.answers[q.questionId]);
  if (codeQuestions.length === 0) return;
  const others = await db
    .select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.assessmentId, at.assessmentId), ne(assessmentAttempts.id, at.id), ne(assessmentAttempts.status, "in_progress")));
  const touched = new Map<string, number>([[at.id, at.maxSimilarity / 100]]);
  for (const { questionId } of codeQuestions) {
    const mine = at.answers[questionId]!.response;
    if (mine.kind !== "code") continue;
    for (const o of others) {
      const theirs = o.answers[questionId]?.response;
      if (!theirs || theirs.kind !== "code") continue;
      const sim = codeSimilarity(mine.source, theirs.source);
      if (sim < 0.7) continue;
      const [x, y] = [at.id, o.id].sort() as [string, string];
      await db
        .insert(plagiarismPairs)
        .values({ assessmentId: at.assessmentId, questionId, attemptA: x, attemptB: y, similarityPct: Math.round(sim * 100) })
        .onConflictDoNothing();
      for (const [id, prev] of [
        [at.id, touched.get(at.id) ?? 0],
        [o.id, touched.get(o.id) ?? o.maxSimilarity / 100],
      ] as const) {
        touched.set(id, Math.max(prev, sim));
      }
    }
  }
  for (const [id, sim] of touched) {
    const [row] = await db.select().from(assessmentAttempts).where(eq(assessmentAttempts.id, id));
    if (!row) continue;
    await db
      .update(assessmentAttempts)
      .set({ maxSimilarity: Math.round(sim * 100), riskScore: riskScore(row.integrity, sim) })
      .where(eq(assessmentAttempts.id, id));
  }
}

export async function submitOwn(db: Db, ctx: StudentCtx, attemptId: string) {
  const at = await loadOwnAttempt(db, ctx, attemptId);
  if (at.status !== "in_progress") throw conflict("submitted", "This test has already been submitted");
  await submitAttempt(db, at.id, ctx.now, ctx.now.getTime() > at.deadline.getTime() + GRACE_MS ? "auto_submitted" : "submitted");
  return attemptView(db, ctx, at.id);
}

// ---------- Proctor side ----------

/** Auto-submit attempts whose time ran out. The monitor calls this on every refresh. */
export async function sweepExpired(db: Db, assessmentId: string, now: Date) {
  const expired = await db
    .select({ id: assessmentAttempts.id })
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.assessmentId, assessmentId), eq(assessmentAttempts.status, "in_progress"), sql`${assessmentAttempts.deadline} < ${new Date(now.getTime() - GRACE_MS)}`));
  for (const e of expired) await submitAttempt(db, e.id, now, "auto_submitted");
}

export async function monitor(db: Db, tenantId: string, assessmentId: string, now: Date) {
  const a = await getAssessment(db, tenantId, assessmentId);
  await sweepExpired(db, a.id, now);
  const units = await tenantUnits(db, tenantId);
  const targeted = await studentIdsInUnits(db, tenantId, descendants(units, a.orgUnitIds));
  const people = targeted.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, targeted)) : [];
  const attempts = await db.select().from(assessmentAttempts).where(eq(assessmentAttempts.assessmentId, a.id));
  const snaps = attempts.length
    ? await db
        .selectDistinctOn([attemptSnapshots.attemptId], { attemptId: attemptSnapshots.attemptId, id: attemptSnapshots.id, at: attemptSnapshots.at })
        .from(attemptSnapshots)
        .where(inArray(attemptSnapshots.attemptId, attempts.map((x) => x.id)))
        .orderBy(attemptSnapshots.attemptId, desc(attemptSnapshots.at))
    : [];
  const total = a.sections.reduce((n, s) => n + s.pick, 0);
  const rows = people.map((p) => {
    const at = attempts.find((x) => x.userId === p.id);
    const snap = at ? snaps.find((s) => s.attemptId === at.id) : undefined;
    return {
      userId: p.id,
      name: p.name,
      rollNo: p.rollNo,
      attemptId: at?.id ?? null,
      status: at ? at.status : "not_started",
      answered: at ? Object.keys(at.answers).length : 0,
      total,
      timeLeftMs: at && at.status === "in_progress" ? Math.max(0, at.deadline.getTime() - now.getTime()) : null,
      lastSeenAt: at?.lastSeenAt ?? null,
      integrity: at?.integrity ?? {},
      riskScore: at?.riskScore ?? 0,
      similarityPct: at?.maxSimilarity ?? 0,
      score: at?.score != null ? at.score / 100 : null,
      maxScore: at?.maxScore != null ? at.maxScore / 100 : null,
      latestSnapshot: snap ? { id: snap.id, at: snap.at } : null,
    };
  });
  rows.sort((x, y) => y.riskScore - x.riskScore || x.name.localeCompare(y.name));
  const counts = { not_started: 0, in_progress: 0, submitted: 0 };
  for (const r of rows) counts[r.status === "auto_submitted" ? "submitted" : (r.status as keyof typeof counts)]++;
  return {
    assessment: { id: a.id, title: a.title, proctorLevel: a.proctorLevel, openAt: a.openAt, closeAt: a.closeAt, durationMinutes: a.durationMinutes, releasePolicy: a.releasePolicy, resultsReleasedAt: a.resultsReleasedAt, sections: a.sections.map((s) => ({ title: s.title, pick: s.pick, marks: s.marks, negative: s.negative })) },
    counts,
    students: rows,
  };
}

export async function attemptDetail(db: Db, tenantId: string, attemptId: string) {
  const [at] = await db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.tenantId, tenantId)));
  if (!at) throw notFound("Attempt");
  const [user] = await db.select({ name: users.name, rollNo: users.rollNo }).from(users).where(eq(users.id, at.userId));
  const events = await db.select().from(integrityEvents).where(eq(integrityEvents.attemptId, at.id)).orderBy(asc(integrityEvents.at));
  const snaps = await db.select({ id: attemptSnapshots.id, at: attemptSnapshots.at }).from(attemptSnapshots).where(eq(attemptSnapshots.attemptId, at.id)).orderBy(asc(attemptSnapshots.at));
  const pairs = await db
    .select()
    .from(plagiarismPairs)
    .where(sql`${plagiarismPairs.attemptA} = ${at.id} or ${plagiarismPairs.attemptB} = ${at.id}`);
  return {
    id: at.id,
    assessmentId: at.assessmentId,
    student: user,
    status: at.status,
    startedAt: at.startedAt,
    deadline: at.deadline,
    submittedAt: at.submittedAt,
    extraMs: at.extraMs,
    integrity: at.integrity,
    riskScore: at.riskScore,
    similarityPct: at.maxSimilarity,
    score: at.score != null ? at.score / 100 : null,
    maxScore: at.maxScore != null ? at.maxScore / 100 : null,
    sections: at.sectionScores,
    results: at.results,
    answers: at.answers,
    events: events.map((e) => ({ type: e.type, detail: e.detail, at: e.at })),
    snapshots: snaps,
    similarTo: pairs.map((p) => ({ questionId: p.questionId, attemptId: p.attemptA === at.id ? p.attemptB : p.attemptA, similarityPct: p.similarityPct })),
  };
}

export async function extendAttempt(db: Db, tenantId: string, attemptId: string, minutes: number) {
  const [at] = await db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.tenantId, tenantId)));
  if (!at) throw notFound("Attempt");
  if (at.status !== "in_progress") throw conflict("submitted", "That attempt is already submitted");
  const ms = minutes * 60_000;
  await db
    .update(assessmentAttempts)
    .set({ deadline: new Date(at.deadline.getTime() + ms), extraMs: at.extraMs + ms })
    .where(eq(assessmentAttempts.id, at.id));
  return { ok: true };
}

export async function resetDevice(db: Db, tenantId: string, attemptId: string) {
  const res = await db
    .update(assessmentAttempts)
    .set({ deviceId: null })
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.tenantId, tenantId)))
    .returning({ id: assessmentAttempts.id });
  if (!res.length) throw notFound("Attempt");
  return { ok: true };
}

export async function resultsReport(db: Db, tenantId: string, assessmentId: string, now: Date) {
  const a = await getAssessment(db, tenantId, assessmentId);
  await sweepExpired(db, a.id, now);
  const attempts = await db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, a.id), ne(assessmentAttempts.status, "in_progress")));
  const people = attempts.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, attempts.map((x) => x.userId))) : [];
  const pairs = await db.select().from(plagiarismPairs).where(eq(plagiarismPairs.assessmentId, a.id)).orderBy(desc(plagiarismPairs.similarityPct));
  const nameOf = (attemptId: string) => people.find((p) => p.id === attempts.find((x) => x.id === attemptId)?.userId)?.name ?? "Unknown";
  const rows = attempts
    .map((at) => ({
      attemptId: at.id,
      userId: at.userId,
      name: people.find((p) => p.id === at.userId)?.name ?? "Unknown",
      rollNo: people.find((p) => p.id === at.userId)?.rollNo ?? null,
      status: at.status,
      score: (at.score ?? 0) / 100,
      maxScore: (at.maxScore ?? 0) / 100,
      sections: at.sectionScores ?? [],
      riskScore: at.riskScore,
      similarityPct: at.maxSimilarity,
    }))
    .sort((x, y) => y.score - x.score);
  const scores = rows.map((r) => r.score);
  return {
    assessment: { id: a.id, title: a.title, releasePolicy: a.releasePolicy, resultsReleasedAt: a.resultsReleasedAt, sections: a.sections.map((s) => s.title) },
    summary: {
      submitted: rows.length,
      average: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 100) / 100 : null,
      highest: scores.length ? Math.max(...scores) : null,
      maxScore: rows[0]?.maxScore ?? null,
      flagged: rows.filter((r) => r.riskScore >= 40).length,
    },
    rows: rows.map((r, i) => ({ ...r, rank: i + 1 })),
    plagiarism: pairs.map((p) => ({ questionId: p.questionId, a: { attemptId: p.attemptA, name: nameOf(p.attemptA) }, b: { attemptId: p.attemptB, name: nameOf(p.attemptB) }, similarityPct: p.similarityPct, flagged: p.similarityPct >= SIMILARITY_FLAG * 100 })),
  };
}
