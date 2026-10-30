import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { APTITUDE_TEMPLATES, generateQuestion } from "@playcode/core";
import type { Db } from "../db/client";
import { adaptiveAttempts, aptitudeHomework, aptitudeHomeworkWork, users, type HomeworkPart, type HomeworkQuestion } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { descendants, scopedUnitIds, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits, type AuthContext } from "./scope";

// Aptitude homework. A teacher picks topics, a level and how many questions
// of each, and a due date; every student gets their own numbers from the
// generators, so copying a classmate's answers doesn't help, and each answer
// comes back with its working. Staff see who has done it and how they did,
// topic by topic.

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof aptitudeHomework.$inferSelect;
export const HOMEWORK_MAX_QUESTIONS = 40;
const DAY = 86_400_000;
const label = (template: string) => APTITUDE_TEMPLATES.find((t) => t.id === template)?.label ?? template;

async function invited(db: Db, tenantId: string, unitIds: string[]) {
  const units = await tenantUnits(db, tenantId);
  return studentIdsInUnits(db, tenantId, unitIds.length ? descendants(units, unitIds) : units.map((u) => u.id));
}

// ---------- Staff ----------

export interface HomeworkInput {
  title: string;
  unitIds: string[];
  parts: HomeworkPart[];
  dueAt: Date;
}

export async function createHomework(db: Db, auth: AuthContext, input: HomeworkInput, now: Date) {
  const tenantId = auth.tenantId!;
  if (!input.parts.length) throw badRequest("Add at least one topic");
  if (input.parts.some((p) => !APTITUDE_TEMPLATES.some((t) => t.id === p.template))) throw badRequest("Unknown topic");
  const total = input.parts.reduce((n, p) => n + p.count, 0);
  if (total > HOMEWORK_MAX_QUESTIONS) throw badRequest(`Keep it to ${HOMEWORK_MAX_QUESTIONS} questions or fewer`);
  if (input.dueAt <= now) throw badRequest("The due date has to be in the future");
  const scoped = await scopedUnitIds(db, auth);
  if (!input.unitIds.length) throw badRequest("Choose the batches or sections to set it for");
  if (input.unitIds.some((u) => !scoped.includes(u))) throw badRequest("Choose batches or sections in your scope");
  const [row] = await db.insert(aptitudeHomework).values({ tenantId, title: input.title.trim(), unitIds: input.unitIds, parts: input.parts, dueAt: input.dueAt, createdBy: auth.userId, createdAt: now }).returning();
  const students = await invited(db, tenantId, input.unitIds);
  const due = input.dueAt.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  await enqueue(
    db,
    students.map((userId) => ({
      tenantId,
      userId,
      template: "assignment_due" as const,
      title: `Aptitude homework: ${row!.title}`,
      body: `${total} questions on ${[...new Set(input.parts.map((p) => label(p.template).toLowerCase()))].join(", ")}, due ${due}. Your numbers are your own, with the working after each answer.`,
      link: appLink(`/play/aptitude/homework/${row!.id}`),
      dedupeKey: `apt-homework:${row!.id}:${userId}`,
      sentBy: auth.userId,
    })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId, actorId: auth.userId, action: "aptitude.homework.create", target: row!.id, data: { students: students.length, questions: total } });
  return { id: row!.id, invited: students.length };
}

/** Homework set for units in the staff member's scope, newest due first, with how far students have got. */
export async function listHomework(db: Db, auth: AuthContext, now: Date) {
  const tenantId = auth.tenantId!;
  const scoped = new Set(await scopedUnitIds(db, auth));
  const rows = (await db.select().from(aptitudeHomework).where(eq(aptitudeHomework.tenantId, tenantId)).orderBy(desc(aptitudeHomework.dueAt))).filter((h) => h.unitIds.some((u) => scoped.has(u)));
  const work = rows.length ? await db.select().from(aptitudeHomeworkWork).where(inArray(aptitudeHomeworkWork.homeworkId, rows.map((r) => r.id))) : [];
  const [units, people] = await Promise.all([tenantUnits(db, tenantId), db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, tenantId))]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const out = [];
  for (const h of rows) {
    const mine = work.filter((w) => w.homeworkId === h.id);
    const done = mine.filter((w) => w.finishedAt);
    const total = h.parts.reduce((n, p) => n + p.count, 0);
    out.push({
      id: h.id,
      title: h.title,
      units: h.unitIds.map((u) => unitName.get(u) ?? ""),
      parts: h.parts.map((p) => ({ ...p, label: label(p.template) })),
      questions: total,
      dueAt: h.dueAt,
      overdue: h.dueAt <= now,
      setBy: people.find((p) => p.id === h.createdBy)?.name ?? null,
      invited: (await invited(db, tenantId, h.unitIds)).length,
      started: mine.length,
      finished: done.length,
      averagePct: done.length ? Math.round((done.reduce((n, w) => n + w.correct, 0) / (done.length * total)) * 100) : null,
    });
  }
  return { homework: out };
}

/** Everyone it was set for, with their progress, and how the group did on each topic. */
export async function homeworkResults(db: Db, auth: AuthContext, id: string) {
  const [h] = await db.select().from(aptitudeHomework).where(and(eq(aptitudeHomework.id, id), eq(aptitudeHomework.tenantId, auth.tenantId!)));
  if (!h) throw notFound("Homework");
  const scoped = new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
  const ids = (await invited(db, auth.tenantId!, h.unitIds)).filter((u) => scoped.has(u));
  const [people, work] = await Promise.all([
    ids.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [],
    db.select().from(aptitudeHomeworkWork).where(eq(aptitudeHomeworkWork.homeworkId, id)),
  ]);
  const total = h.parts.reduce((n, p) => n + p.count, 0);
  const students = people
    .map((p) => {
      const w = work.find((x) => x.userId === p.id);
      const answered = w?.questions.filter((q) => q.correct !== null).length ?? 0;
      return { id: p.id, name: p.name, rollNo: p.rollNo, status: !w ? "not_started" : w.finishedAt ? "done" : "started", answered, correct: w?.correct ?? 0, late: Boolean(w?.finishedAt && w.finishedAt > h.dueAt) };
    })
    .sort((a, b) => b.correct - a.correct || (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));
  const answers = work.filter((w) => scoped.has(w.userId)).flatMap((w) => w.questions.filter((q) => q.correct !== null));
  const topics = [...new Set(h.parts.map((p) => p.template))].map((template) => {
    const qs = answers.filter((q) => q.template === template);
    return { template, label: label(template), answered: qs.length, accuracyPct: qs.length ? Math.round((qs.filter((q) => q.correct).length / qs.length) * 100) : null };
  });
  return { homework: { id: h.id, title: h.title, dueAt: h.dueAt, questions: total }, students, topics };
}

/** Hourly: a day before it's due, remind the students who haven't finished, once. */
export async function homeworkReminders(db: Db, now: Date) {
  const due = await db.select().from(aptitudeHomework).where(and(isNull(aptitudeHomework.remindedAt), gte(aptitudeHomework.dueAt, now), lte(aptitudeHomework.dueAt, new Date(now.getTime() + DAY))));
  let sent = 0;
  for (const h of due) {
    const [students, work] = await Promise.all([invited(db, h.tenantId, h.unitIds), db.select().from(aptitudeHomeworkWork).where(eq(aptitudeHomeworkWork.homeworkId, h.id))]);
    const finished = new Set(work.filter((w) => w.finishedAt).map((w) => w.userId));
    const left = students.filter((u) => !finished.has(u));
    sent += await enqueue(
      db,
      left.map((userId) => ({
        tenantId: h.tenantId,
        userId,
        template: "assignment_due" as const,
        title: `Due tomorrow: ${h.title}`,
        body: "Your aptitude homework is due within a day.",
        link: appLink(`/play/aptitude/homework/${h.id}`),
        dedupeKey: `apt-homework-reminder:${h.id}:${userId}`,
      })),
    );
    await db.update(aptitudeHomework).set({ remindedAt: now }).where(eq(aptitudeHomework.id, h.id));
  }
  return sent;
}

// ---------- Students ----------

async function setFor(db: Db, ctx: Ctx) {
  const units = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  // Homework due in the last fortnight or later, for the student's units.
  const rows = await db.select().from(aptitudeHomework).where(and(eq(aptitudeHomework.tenantId, ctx.tenantId), gte(aptitudeHomework.dueAt, new Date(ctx.now.getTime() - 14 * DAY))));
  return rows.filter((h) => h.unitIds.some((u) => units.has(u)));
}

export async function myHomework(db: Db, ctx: Ctx) {
  const rows = await setFor(db, ctx);
  const work = rows.length ? await db.select().from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.userId, ctx.userId), inArray(aptitudeHomeworkWork.homeworkId, rows.map((r) => r.id)))) : [];
  return {
    homework: rows
      .map((h) => {
        const w = work.find((x) => x.homeworkId === h.id);
        const total = h.parts.reduce((n, p) => n + p.count, 0);
        return { id: h.id, title: h.title, dueAt: h.dueAt, questions: total, answered: w?.questions.filter((q) => q.correct !== null).length ?? 0, correct: w?.correct ?? 0, done: Boolean(w?.finishedAt), topics: [...new Set(h.parts.map((p) => label(p.template)))] };
      })
      .sort((a, b) => Number(a.done) - Number(b.done) || a.dueAt.getTime() - b.dueAt.getTime()),
  };
}

const newSeed = () => randomBytes(4).readUInt32BE(0) >>> 1;

function view(h: Row, w: typeof aptitudeHomeworkWork.$inferSelect, now: Date) {
  const next = w.questions.findIndex((q) => q.correct === null);
  const rebuilt = w.questions.map((q) => generateQuestion(q.template, q.level, q.seed));
  return {
    id: h.id,
    title: h.title,
    dueAt: h.dueAt,
    overdue: h.dueAt <= now,
    total: w.questions.length,
    correct: w.correct,
    done: Boolean(w.finishedAt),
    // What's been answered, with the working; and the next question without its answer.
    answered: w.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.correct !== null)
      .map(({ q, i }) => ({ index: i, topic: label(q.template), prompt: rebuilt[i]!.prompt, options: rebuilt[i]!.options, chosen: q.chosen, answer: rebuilt[i]!.answer, correct: q.correct, explanation: rebuilt[i]!.explanation })),
    next: next < 0 ? null : { index: next, topic: label(w.questions[next]!.template), level: w.questions[next]!.level, prompt: rebuilt[next]!.prompt, options: rebuilt[next]!.options },
    topics: [...new Set(w.questions.map((q) => q.template))].map((t) => {
      const qs = w.questions.filter((q) => q.template === t && q.correct !== null);
      return { label: label(t), answered: qs.length, correct: qs.filter((q) => q.correct).length };
    }),
  };
}

async function loadMine(db: Db, ctx: Ctx, id: string) {
  const h = (await setFor(db, ctx)).find((x) => x.id === id);
  if (!h) throw notFound("Homework");
  return h;
}

/** Open a homework: the first time, this student's questions are drawn. */
export async function openHomework(db: Db, ctx: Ctx, id: string) {
  const h = await loadMine(db, ctx, id);
  let [w] = await db.select().from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.homeworkId, id), eq(aptitudeHomeworkWork.userId, ctx.userId)));
  if (!w) {
    const questions: HomeworkQuestion[] = h.parts.flatMap((p) => Array.from({ length: p.count }, () => ({ template: p.template, level: p.level, seed: newSeed(), chosen: null, correct: null, answeredAt: null })));
    [w] = await db.insert(aptitudeHomeworkWork).values({ homeworkId: id, userId: ctx.userId, tenantId: ctx.tenantId, questions, startedAt: ctx.now }).onConflictDoNothing().returning();
    // Opened twice at once: use the one that got in.
    if (!w) [w] = await db.select().from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.homeworkId, id), eq(aptitudeHomeworkWork.userId, ctx.userId)));
  }
  return view(h, w!, ctx.now);
}

export async function answerHomework(db: Db, ctx: Ctx, id: string, input: { index: number; chosen: number }) {
  const h = await loadMine(db, ctx, id);
  const result = await db.transaction(async (tx) => {
    const [w] = await tx.select().from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.homeworkId, id), eq(aptitudeHomeworkWork.userId, ctx.userId))).for("update");
    if (!w) throw notFound("Homework");
    const next = w.questions.findIndex((q) => q.correct === null);
    if (next < 0 || input.index !== next) throw conflict("answered", "That question has been answered");
    const q = w.questions[next]!;
    const built = generateQuestion(q.template, q.level, q.seed);
    if (input.chosen < 0 || input.chosen >= built.options.length) throw badRequest("Choose one of the options");
    q.chosen = input.chosen;
    q.correct = input.chosen === built.answer;
    q.answeredAt = ctx.now.toISOString();
    const correct = w.questions.filter((x) => x.correct).length;
    const finished = w.questions.every((x) => x.correct !== null);
    await tx.update(aptitudeHomeworkWork).set({ questions: w.questions, correct, finishedAt: finished ? ctx.now : null }).where(and(eq(aptitudeHomeworkWork.homeworkId, id), eq(aptitudeHomeworkWork.userId, ctx.userId)));
    return { ...w, questions: w.questions, correct, finishedAt: finished ? ctx.now : null };
  });
  return view(h, result, ctx.now);
}

// ---------- Where the batch struggles ----------

/** Accuracy by aptitude topic over the last 90 days, from adaptive tests and homework, for students in scope. */
export async function topicAccuracy(db: Db, auth: AuthContext, now: Date) {
  const tenantId = auth.tenantId!;
  const ids = await studentIdsInUnits(db, tenantId, await scopedUnitIds(db, auth));
  if (!ids.length) return { topics: [] };
  const since = new Date(now.getTime() - 90 * DAY);
  const [tests, work] = await Promise.all([
    db.select({ sections: adaptiveAttempts.sections }).from(adaptiveAttempts).where(and(eq(adaptiveAttempts.tenantId, tenantId), inArray(adaptiveAttempts.userId, ids), gte(adaptiveAttempts.startedAt, since))),
    db.select({ questions: aptitudeHomeworkWork.questions }).from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.tenantId, tenantId), inArray(aptitudeHomeworkWork.userId, ids), gte(aptitudeHomeworkWork.startedAt, since))),
  ]);
  const answers = [
    ...tests.flatMap((t) => t.sections.flatMap((s) => s.items.filter((i) => i.correct !== null).map((i) => ({ template: i.template, level: i.level, correct: i.correct! })))),
    ...work.flatMap((w) => w.questions.filter((q) => q.correct !== null).map((q) => ({ template: q.template, level: q.level, correct: q.correct! }))),
  ];
  const topics = APTITUDE_TEMPLATES.map((t) => {
    const qs = answers.filter((a) => a.template === t.id);
    return {
      template: t.id,
      label: t.label,
      topic: t.topic,
      answered: qs.length,
      accuracyPct: qs.length ? Math.round((qs.filter((a) => a.correct).length / qs.length) * 100) : null,
      averageLevel: qs.length ? Math.round((qs.reduce((n, a) => n + a.level, 0) / qs.length) * 10) / 10 : null,
    };
  })
    .filter((t) => t.answered > 0)
    .sort((a, b) => a.accuracyPct! - b.accuracyPct! || b.answered - a.answered);
  return { topics };
}
