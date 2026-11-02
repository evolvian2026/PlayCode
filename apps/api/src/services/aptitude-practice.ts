import { and, eq, gte, inArray } from "drizzle-orm";
import { APTITUDE_TEMPLATES, generateQuestion, medianSeconds, paceTarget, paceVerdict, suggestedDrillLevel, type DataTable } from "@playcode/core";
import type { Db } from "../db/client";
import { adaptiveAttempts, aptitudeDrillAnswers, aptitudeHomeworkWork, aptitudeMistakeFixes } from "../db/schema";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";

// How students do on aptitude, topic by topic: share right and pace, for a
// student's own view and for staff ("where the batch struggles"); and a
// student's wrong answers, to retry with a similar question.

type Ctx = { tenantId: string; userId: string; now: Date };
const DAY = 86_400_000;
const WINDOW_DAYS = 90;
/** An answer slower than this was left open, not worked on: it says nothing about pace. */
const MAX_SECONDS = 600;
const label = (template: string) => APTITUDE_TEMPLATES.find((t) => t.id === template)?.label ?? template;

interface Answer {
  template: string;
  level: number;
  correct: boolean;
  /** Seconds taken, where known: adaptive tests and drills; homework is done in sittings that can span a day. */
  seconds: number | null;
}

/**
 * Answers from the last 90 days, topic by topic: adaptive tests and
 * homework, and for a student looking at their own, drills too. Pace is the
 * middle answer time against what a test allows for one question.
 */
async function byTopic(db: Db, tenantId: string, ids: string[], now: Date, drills: boolean) {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const [tests, work, drilled] = await Promise.all([
    db.select({ sections: adaptiveAttempts.sections }).from(adaptiveAttempts).where(and(eq(adaptiveAttempts.tenantId, tenantId), inArray(adaptiveAttempts.userId, ids), gte(adaptiveAttempts.startedAt, since))),
    db.select({ questions: aptitudeHomeworkWork.questions }).from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.tenantId, tenantId), inArray(aptitudeHomeworkWork.userId, ids), gte(aptitudeHomeworkWork.startedAt, since))),
    drills
      ? db
          .select({ template: aptitudeDrillAnswers.template, level: aptitudeDrillAnswers.level, correct: aptitudeDrillAnswers.correct, seconds: aptitudeDrillAnswers.seconds })
          .from(aptitudeDrillAnswers)
          .where(and(eq(aptitudeDrillAnswers.tenantId, tenantId), inArray(aptitudeDrillAnswers.userId, ids), gte(aptitudeDrillAnswers.answeredAt, since)))
      : [],
  ]);
  const answers: Answer[] = [
    ...tests.flatMap((t) =>
      t.sections.flatMap((s) =>
        s.items
          .filter((i) => i.correct !== null)
          .map((i) => ({ template: i.template, level: i.level, correct: i.correct!, seconds: i.answeredAt ? Math.round((Date.parse(i.answeredAt) - Date.parse(i.askedAt)) / 1000) : null })),
      ),
    ),
    ...work.flatMap((w) => w.questions.filter((q) => q.correct !== null).map((q) => ({ template: q.template, level: q.level, correct: q.correct!, seconds: null }))),
    ...drilled,
  ];
  return APTITUDE_TEMPLATES.map((t) => {
    const qs = answers.filter((a) => a.template === t.id);
    const target = paceTarget(t.topic);
    const median = medianSeconds(qs.map((a) => a.seconds).filter((x): x is number => x !== null && x > 0 && x <= MAX_SECONDS));
    return {
      template: t.id,
      label: t.label,
      topic: t.topic,
      answered: qs.length,
      correct: qs.filter((a) => a.correct).length,
      accuracyPct: qs.length ? Math.round((qs.filter((a) => a.correct).length / qs.length) * 100) : null,
      averageLevel: qs.length ? Math.round((qs.reduce((n, a) => n + a.level, 0) / qs.length) * 10) / 10 : null,
      medianSeconds: median,
      targetSeconds: target,
      pace: median === null ? null : paceVerdict(median, target),
    };
  })
    .filter((t) => t.answered > 0)
    .sort((a, b) => a.accuracyPct! - b.accuracyPct! || b.answered - a.answered);
}

/** Where the batch struggles: accuracy and pace by topic for the students in scope, from tests and homework. */
export async function topicAccuracy(db: Db, auth: AuthContext, now: Date) {
  const tenantId = auth.tenantId!;
  const ids = await studentIdsInUnits(db, tenantId, await scopedUnitIds(db, auth));
  if (!ids.length) return { topics: [] };
  return { topics: await byTopic(db, tenantId, ids, now, false) };
}

/** A student's own accuracy and pace by topic, weakest first, each with the level to drill it at; and the topics they haven't tried. */
export async function myTopics(db: Db, ctx: Ctx) {
  const topics = (await byTopic(db, ctx.tenantId, [ctx.userId], ctx.now, true)).map((t) => ({ ...t, drillLevel: suggestedDrillLevel(t.accuracyPct!, t.averageLevel!) }));
  const tried = new Set(topics.map((t) => t.template));
  return { topics, untried: APTITUDE_TEMPLATES.filter((t) => !tried.has(t.id)), mistakes: (await mistakes(db, ctx)).length };
}

// ---------- Mistakes to retry ----------

interface Mistake {
  template: string;
  level: number;
  seed: number;
  from: "test" | "homework" | "drill";
  at: Date;
  chosen: number | null;
  /** What the student saw, for test questions: kept with the attempt, so later wording changes don't move the answer. */
  shown?: { prompt: string; options: string[]; answer: number; explanation: string; table?: DataTable };
}

const key = (m: { template: string; level: number; seed: number }) => `${m.template}:${m.level}:${m.seed}`;

/** Wrong answers in the last 90 days not yet put right, newest first. Tests count once finished, so a test's answers never show while it's open. */
async function mistakes(db: Db, ctx: Ctx): Promise<Mistake[]> {
  const since = new Date(ctx.now.getTime() - WINDOW_DAYS * DAY);
  const [tests, work, drilled, fixed] = await Promise.all([
    db.select({ sections: adaptiveAttempts.sections, finishedAt: adaptiveAttempts.finishedAt }).from(adaptiveAttempts).where(and(eq(adaptiveAttempts.userId, ctx.userId), eq(adaptiveAttempts.tenantId, ctx.tenantId), eq(adaptiveAttempts.status, "finished"), gte(adaptiveAttempts.startedAt, since))),
    db.select({ questions: aptitudeHomeworkWork.questions }).from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.userId, ctx.userId), eq(aptitudeHomeworkWork.tenantId, ctx.tenantId), gte(aptitudeHomeworkWork.startedAt, since))),
    db.select().from(aptitudeDrillAnswers).where(and(eq(aptitudeDrillAnswers.userId, ctx.userId), eq(aptitudeDrillAnswers.tenantId, ctx.tenantId), eq(aptitudeDrillAnswers.correct, false), gte(aptitudeDrillAnswers.answeredAt, since))),
    db.select().from(aptitudeMistakeFixes).where(and(eq(aptitudeMistakeFixes.userId, ctx.userId), eq(aptitudeMistakeFixes.tenantId, ctx.tenantId))),
  ]);
  const all: Mistake[] = [
    ...tests.flatMap((t) =>
      t.sections.flatMap((s) =>
        s.items
          .filter((i) => i.correct === false)
          .map((i) => ({ template: i.template, level: i.level, seed: i.seed, from: "test" as const, at: t.finishedAt!, chosen: i.chosen, shown: { prompt: i.prompt, options: i.options, answer: i.answer, explanation: i.explanation, table: i.table } })),
      ),
    ),
    ...work.flatMap((w) => w.questions.filter((q) => q.correct === false).map((q) => ({ template: q.template, level: q.level, seed: q.seed, from: "homework" as const, at: new Date(q.answeredAt!), chosen: q.chosen }))),
    ...drilled.map((d) => ({ template: d.template, level: d.level, seed: d.seed, from: "drill" as const, at: d.answeredAt, chosen: d.chosen })),
  ];
  const done = new Set(fixed.map(key));
  const seen = new Set<string>();
  return all
    .filter((m) => APTITUDE_TEMPLATES.some((t) => t.id === m.template))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .filter((m) => {
      const k = key(m);
      if (done.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** The student's aptitude mistakes to retry, with the question as they saw it, their answer and the working. */
export async function myMistakes(db: Db, ctx: Ctx) {
  const list = await mistakes(db, ctx);
  return {
    total: list.length,
    mistakes: list.slice(0, 30).map((m) => {
      const q = m.shown ?? generateQuestion(m.template, m.level, m.seed);
      return { key: key(m), template: m.template, topic: label(m.template), level: m.level, seed: m.seed, from: m.from, at: m.at, prompt: q.prompt, table: q.table ?? null, options: q.options, chosen: m.chosen, answer: q.answer, explanation: q.explanation };
    }),
  };
}

/** A mistake put right: a similar question (same topic and level) answered right. */
export async function markFixed(db: Db, ctx: Ctx, m: { template: string; level: number; seed: number }) {
  await db.insert(aptitudeMistakeFixes).values({ userId: ctx.userId, tenantId: ctx.tenantId, ...m, fixedAt: ctx.now }).onConflictDoNothing();
}
