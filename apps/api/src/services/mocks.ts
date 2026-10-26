import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  describeAnswer,
  grade,
  mockFocus,
  mockMinutes,
  mockPattern,
  MOCK_PATTERNS,
  needsExecution,
  percentile,
  scoreAttempt,
  sectionClock,
  shuffle,
  toStudentView,
  type MockPattern,
  type StudentResponse,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { mockAttempts, questions, skills, type AttemptQuestion, type AttemptResult } from "../db/schema";
import { checkRunRate, evaluate, tryRun } from "../execution";
import { badRequest, conflict, notFound } from "../lib/errors";
import { toCoreQuestion, type StudentCtx } from "./practice";

// Self-serve mock tests on company patterns (see packages/core mock-test.ts).
// Questions come from PlayCode's own bank only, so scores are comparable
// across colleges; a student's earlier mocks are drawn from last.

type Attempt = typeof mockAttempts.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;

/** Answers saved this soon after a section closes still count (network lag). */
const GRACE_MS = 15_000;
const PER_DAY = 5;

function patternOf(at: Attempt): MockPattern {
  return mockPattern(at.pattern)!;
}

async function loadOwn(db: Db, ctx: StudentCtx, id: string): Promise<Attempt> {
  const [at] = await db.select().from(mockAttempts).where(and(eq(mockAttempts.id, id), eq(mockAttempts.userId, ctx.userId)));
  if (!at) throw notFound("Mock test");
  return at;
}

/** Draw a fresh paper: per section, the questions this student has seen least in earlier mocks, at random among equals. */
async function drawPaper(db: Db, userId: string, pattern: MockPattern): Promise<AttemptQuestion[]> {
  const earlier = await db.select({ questions: mockAttempts.questions }).from(mockAttempts).where(eq(mockAttempts.userId, userId));
  const seen = new Map<string, number>();
  for (const a of earlier) for (const q of a.questions) seen.set(q.questionId, (seen.get(q.questionId) ?? 0) + 1);
  const paper: AttemptQuestion[] = [];
  for (const [section, spec] of pattern.sections.entries()) {
    const pool = await db
      .select({ id: questions.id })
      .from(questions)
      .where(
        and(
          eq(questions.status, "live"),
          isNull(questions.tenantId),
          inArray(sql`split_part(${questions.skillId}, '.', 1)`, spec.topics),
          spec.kind === "coding" ? eq(questions.type, "write_code") : sql`${questions.type} not in ('write_code', 'sql_query')`,
          spec.maxDifficulty ? lte(questions.difficulty, spec.maxDifficulty) : undefined,
        ),
      );
    const picked = shuffle(pool.map((p) => p.id), Math.floor(Math.random() * 2 ** 31))
      .sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0))
      .slice(0, spec.count);
    if (picked.length === 0) throw badRequest(`There are no questions for the ${spec.title} section yet`);
    for (const questionId of picked) paper.push({ questionId, section });
  }
  return paper;
}

/** Close sections whose time ran out (and the test, after the last one). */
async function sync(db: Db, at: Attempt, now: Date): Promise<Attempt> {
  if (at.status !== "in_progress") return at;
  const clock = sectionClock(patternOf(at).sections, at.section, at.sectionDeadline, now);
  if (clock.finished) return finalize(db, at, now);
  if (clock.section === at.section) return at;
  const [row] = await db
    .update(mockAttempts)
    .set({ section: clock.section, sectionDeadline: clock.deadline })
    .where(and(eq(mockAttempts.id, at.id), eq(mockAttempts.section, at.section), eq(mockAttempts.status, "in_progress")))
    .returning();
  return row ?? (await db.select().from(mockAttempts).where(eq(mockAttempts.id, at.id)))[0]!;
}

/** Mark the paper. Code runs on every test, as in practice; a malformed answer scores zero. */
async function finalize(db: Db, at: Attempt, now: Date): Promise<Attempt> {
  const pattern = patternOf(at);
  const rows = await db.select().from(questions).where(inArray(questions.id, at.questions.map((q) => q.questionId)));
  const byId = new Map(rows.map((q) => [q.id, q]));
  const results: AttemptResult[] = [];
  for (const { questionId, section } of at.questions) {
    const saved = at.answers[questionId];
    const q = byId.get(questionId)!;
    if (!saved) {
      results.push({ questionId, section, answered: false, score: 0, correct: false });
    } else if (needsExecution(q.answer)) {
      try {
        const e = await evaluate(toCoreQuestion(q), saved.response, "practice");
        const detail = e.kind === "code" ? { passed: e.passed, total: e.total, compileError: Boolean(e.compileError) } : { ok: e.result.ok };
        results.push({ questionId, section, answered: true, score: e.score, correct: e.correct, detail });
      } catch {
        results.push({ questionId, section, answered: true, score: 0, correct: false });
      }
    } else {
      const correct = grade(q.answer, saved.response);
      results.push({ questionId, section, answered: true, score: correct ? 1 : 0, correct });
    }
  }
  const scored = scoreAttempt(
    pattern.sections.map((s) => ({ title: s.title, marks: s.marks, negative: 0 })),
    results,
  );
  const [row] = await db
    .update(mockAttempts)
    .set({ status: "submitted", submittedAt: now, section: pattern.sections.length, results, score: Math.round(scored.score * 100), maxScore: Math.round(scored.max * 100), sectionScores: scored.sections })
    .where(and(eq(mockAttempts.id, at.id), eq(mockAttempts.status, "in_progress")))
    .returning();
  return row ?? (await db.select().from(mockAttempts).where(eq(mockAttempts.id, at.id)))[0]!;
}

const pctOf = (at: Pick<Attempt, "score" | "maxScore">) => (at.maxScore ? Math.round(((at.score ?? 0) / at.maxScore) * 100) : 0);

export async function studentMocks(db: Db, ctx: StudentCtx) {
  const rows = await db.select().from(mockAttempts).where(eq(mockAttempts.userId, ctx.userId)).orderBy(desc(mockAttempts.startedAt)).limit(30);
  const attempts = [];
  for (const r of rows) {
    const at = await sync(db, r, ctx.now);
    attempts.push({
      id: at.id,
      pattern: at.pattern,
      startedAt: at.startedAt,
      status: at.status,
      pct: at.status === "submitted" ? pctOf(at) : null,
      sections: at.sectionScores?.map((s) => ({ title: s.title, pct: s.max ? Math.round((Math.max(0, s.score) / s.max) * 100) : 0 })) ?? null,
    });
  }
  return {
    patterns: MOCK_PATTERNS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      minutes: mockMinutes(p),
      sections: p.sections.map((s) => ({ title: s.title, minutes: s.minutes, count: s.count, kind: s.kind })),
    })),
    attempts,
  };
}

export async function startMock(db: Db, ctx: StudentCtx, patternId: string) {
  const pattern = mockPattern(patternId);
  if (!pattern) throw badRequest("Unknown mock test pattern");
  const [open] = await db.select().from(mockAttempts).where(and(eq(mockAttempts.userId, ctx.userId), eq(mockAttempts.status, "in_progress")));
  if (open && (await sync(db, open, ctx.now)).status === "in_progress") {
    throw conflict("mock_in_progress", "Finish the mock test you've started first", { id: open.id });
  }
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mockAttempts)
    .where(and(eq(mockAttempts.userId, ctx.userId), gte(mockAttempts.startedAt, new Date(ctx.now.getTime() - 86_400_000))));
  if (n >= PER_DAY) throw conflict("mock_limit", `You can take ${PER_DAY} mock tests a day. Practise your weak sections, then try again tomorrow.`);
  const paper = await drawPaper(db, ctx.userId, pattern);
  const [at] = await db
    .insert(mockAttempts)
    .values({ userId: ctx.userId, tenantId: ctx.tenantId, pattern: pattern.id, questions: paper, startedAt: ctx.now, sectionDeadline: new Date(ctx.now.getTime() + pattern.sections[0]!.minutes * 60_000) })
    .returning();
  return mockView(db, ctx, at!.id);
}

function describeResponse(q: QuestionRow, r: StudentResponse): string {
  switch (r.kind) {
    case "option":
      return q.body.options?.find((o) => o.id === r.optionId)?.text ?? r.optionId;
    case "text":
      return r.value;
    case "lines":
      return `Line ${r.lines.join(", ")}`;
    case "order": {
      const text = new Map(q.body.lines?.map((l) => [l.id, l.text]));
      return r.ids.map((id) => text.get(id) ?? id).join("\n");
    }
    case "code":
      return r.source;
    case "sql":
      return r.query;
  }
}

/** The student's own report: sections against their targets, a percentile once enough students have taken the pattern, what to practise next, and every answer. */
async function report(db: Db, at: Attempt) {
  const pattern = patternOf(at);
  const rows = await db.select().from(questions).where(inArray(questions.id, at.questions.map((q) => q.questionId)));
  const byId = new Map(rows.map((q) => [q.id, q]));
  const skillRows = await db.select().from(skills).where(inArray(skills.id, [...new Set(rows.map((r) => r.skillId))]));
  // Compare with each student's latest finished mock on this pattern.
  const latest = await db
    .selectDistinctOn([mockAttempts.userId], { score: mockAttempts.score, maxScore: mockAttempts.maxScore })
    .from(mockAttempts)
    .where(and(eq(mockAttempts.pattern, at.pattern), eq(mockAttempts.status, "submitted"), ne(mockAttempts.userId, at.userId)))
    .orderBy(mockAttempts.userId, desc(mockAttempts.submittedAt));
  const mine = pctOf(at);
  const sections = at.sectionScores ?? [];
  const results = at.results ?? [];
  const focus = mockFocus(pattern, sections).map((f) => {
    // The skill with the most missed questions in that section is the one to practise.
    const missed = new Map<string, number>();
    for (const r of results) if (r.section === f.section && !r.correct) {
      const skillId = byId.get(r.questionId)!.skillId;
      missed.set(skillId, (missed.get(skillId) ?? 0) + 1 - r.score);
    }
    const skillId = [...missed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { ...f, skillId, skillName: skillRows.find((s) => s.id === skillId)?.name ?? null };
  });
  return {
    score: (at.score ?? 0) / 100,
    maxScore: (at.maxScore ?? 0) / 100,
    pct: mine,
    percentile: percentile([...latest.map(pctOf), mine], mine),
    compared: latest.length + 1,
    sections: sections.map((s, i) => ({ ...s, pct: s.max ? Math.round((Math.max(0, s.score) / s.max) * 100) : 0, target: pattern.sections[i]?.target ?? 0 })),
    focus,
    review: results.map((r) => {
      const q = byId.get(r.questionId)!;
      const saved = at.answers[r.questionId]?.response;
      return {
        section: r.section,
        questionId: q.id,
        stem: q.body.stem,
        code: q.body.code ?? null,
        yourAnswer: saved ? describeResponse(q, saved) : null,
        correctAnswer: describeAnswer(q),
        explanation: q.explanation,
        correct: r.correct,
        score: r.score,
        detail: r.detail ?? null,
      };
    }),
  };
}

export async function mockView(db: Db, ctx: StudentCtx, id: string) {
  const at = await sync(db, await loadOwn(db, ctx, id), ctx.now);
  const pattern = patternOf(at);
  const inProgress = at.status === "in_progress";
  const current = inProgress ? at.questions.filter((q) => q.section === at.section) : [];
  const rows = current.length ? await db.select().from(questions).where(inArray(questions.id, current.map((q) => q.questionId))) : [];
  const byId = new Map(rows.map((q) => [q.id, q]));
  return {
    id: at.id,
    pattern: { id: pattern.id, name: pattern.name, minutes: mockMinutes(pattern) },
    status: at.status,
    startedAt: at.startedAt,
    section: inProgress ? at.section : null,
    timeLeftMs: inProgress ? Math.max(0, at.sectionDeadline.getTime() - ctx.now.getTime()) : 0,
    sections: pattern.sections.map((s, i) => ({
      title: s.title,
      minutes: s.minutes,
      kind: s.kind,
      marks: s.marks,
      count: at.questions.filter((q) => q.section === i).length,
      answered: at.questions.filter((q) => q.section === i && at.answers[q.questionId]).length,
      state: !inProgress || i < at.section ? "closed" : i === at.section ? "open" : "upcoming",
    })),
    questions: current.map((q) => ({ question: toStudentView(toCoreQuestion(byId.get(q.questionId)!), at.id), saved: at.answers[q.questionId]?.response ?? null })),
    result: inProgress ? null : await report(db, at),
  };
}

/** The open section's questions, allowing a few seconds after it closes. */
async function openFor(db: Db, ctx: StudentCtx, id: string, questionId: string) {
  const at = await loadOwn(db, ctx, id);
  if (at.status !== "in_progress") throw conflict("submitted", "This mock test is over");
  const clock = sectionClock(patternOf(at).sections, at.section, at.sectionDeadline, new Date(ctx.now.getTime() - GRACE_MS));
  const q = at.questions.find((x) => x.questionId === questionId);
  if (!q) throw badRequest("That question is not in your mock test");
  if (clock.finished || q.section !== clock.section) throw conflict("section_closed", "That section is closed");
  return at;
}

export async function saveMockAnswer(db: Db, ctx: StudentCtx, id: string, input: { questionId: string; response: StudentResponse | null }) {
  const at = await openFor(db, ctx, id, input.questionId);
  const value = input.response ? { response: input.response, savedAt: ctx.now.toISOString() } : null;
  await db
    .update(mockAttempts)
    .set({
      answers: value
        ? sql`jsonb_set(${mockAttempts.answers}, ${`{${input.questionId}}`}::text[], ${JSON.stringify(value)}::jsonb, true)`
        : sql`${mockAttempts.answers} - ${input.questionId}`,
    })
    .where(and(eq(mockAttempts.id, at.id), eq(mockAttempts.status, "in_progress")));
  return { savedAt: ctx.now };
}

export async function runInMock(db: Db, ctx: StudentCtx, id: string, input: { questionId: string; response: StudentResponse }) {
  await openFor(db, ctx, id, input.questionId);
  const [q] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  await checkRunRate(ctx.userId, ctx.now);
  return tryRun(toCoreQuestion(q!), input.response);
}

/** Close the open section early and start the next one's timer now. `from` makes a double click harmless. */
export async function nextMockSection(db: Db, ctx: StudentCtx, id: string, from: number) {
  const at = await sync(db, await loadOwn(db, ctx, id), ctx.now);
  if (at.status === "in_progress" && at.section === from) {
    const sections = patternOf(at).sections;
    const next = from + 1;
    if (next >= sections.length) await finalize(db, at, ctx.now);
    else {
      await db
        .update(mockAttempts)
        .set({ section: next, sectionDeadline: new Date(ctx.now.getTime() + sections[next]!.minutes * 60_000) })
        .where(and(eq(mockAttempts.id, at.id), eq(mockAttempts.section, from), eq(mockAttempts.status, "in_progress")));
    }
  }
  return mockView(db, ctx, id);
}

/** End the whole test now; sections not yet reached score zero. */
export async function finishMock(db: Db, ctx: StudentCtx, id: string) {
  const at = await sync(db, await loadOwn(db, ctx, id), ctx.now);
  if (at.status === "in_progress") await finalize(db, at, ctx.now);
  return mockView(db, ctx, id);
}

/** Hourly: mark mocks whose time ran out while nobody was looking, so they count in percentiles and staff views. */
export async function finalizeExpiredMocks(db: Db, now: Date) {
  const due = await db.select().from(mockAttempts).where(and(eq(mockAttempts.status, "in_progress"), lte(mockAttempts.sectionDeadline, now))).limit(500);
  let finalized = 0;
  for (const at of due) if ((await sync(db, at, now)).status === "submitted") finalized++;
  return { finalized };
}

/** A student's mocks for staff: pattern, date and section scores, not the answers. */
export async function mockSummary(db: DbOrTx, userId: string) {
  const rows = await db
    .select()
    .from(mockAttempts)
    .where(and(eq(mockAttempts.userId, userId), eq(mockAttempts.status, "submitted")))
    .orderBy(desc(mockAttempts.submittedAt))
    .limit(10);
  return rows.map((at) => ({
    id: at.id,
    pattern: mockPattern(at.pattern)!.name,
    submittedAt: at.submittedAt,
    pct: pctOf(at),
    sections: (at.sectionScores ?? []).map((s) => ({ title: s.title, pct: s.max ? Math.round((Math.max(0, s.score) / s.max) * 100) : 0 })),
  }));
}
