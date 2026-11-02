import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { AI_PRACTICE_KINDS, at, msg, PRACTICE_TASK_KINDS, practiceTaskPath, practiceTaskSubject, validPracticeRef, type PracticeTaskKind } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { jamAttempts, practiceTasks, speakingDrills, tenants, users, writingAttempts } from "../db/schema";
import { aiProvider } from "../lib/ai";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { appLink, enqueue, type NewNotification } from "./notifications";
import { aiAllowed } from "./plan";
import { assertUnitsInScope, descendants, scopedUnitIds, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits, type AuthContext } from "./scope";
import { getTenant } from "./tenant";

// Communication tasks: speaking or writing practice set for batches with a due
// date. Doing it is the student's own attempt at that practice (a JAM talk on
// the topic, the writing task, or a drill sitting of the kind) between the task
// opening and its due date, so the practice pages stay as they are and nothing
// is handed in twice. Staff see who has done it and how they scored.

type Task = typeof practiceTasks.$inferSelect;
export type Done = { at: Date; score: number; outOf: 5 | 100; attemptId: string };

const DAY = 86_400_000;

/** Each student's best attempt at the task in its window. */
export async function completion(db: DbOrTx, task: Task, userIds: string[]): Promise<Map<string, Done>> {
  const out = new Map<string, Done>();
  if (userIds.length === 0) return out;
  const keep = (userId: string, d: Done) => {
    const prev = out.get(userId);
    if (!prev || d.score > prev.score) out.set(userId, d);
  };
  const window = (col: Parameters<typeof gte>[0]) => and(gte(col, task.openAt), lte(col, task.closeAt));
  if (task.kind === "jam") {
    const rows = await db.select().from(jamAttempts).where(and(inArray(jamAttempts.userId, userIds), eq(jamAttempts.topicId, task.ref!), window(jamAttempts.createdAt)));
    for (const r of rows) keep(r.userId, { at: r.createdAt, score: r.feedback.overall, outOf: 5, attemptId: r.id });
  } else if (task.kind === "writing") {
    const rows = await db.select().from(writingAttempts).where(and(inArray(writingAttempts.userId, userIds), eq(writingAttempts.taskId, task.ref!), window(writingAttempts.createdAt)));
    for (const r of rows) keep(r.userId, { at: r.createdAt, score: r.feedback.overall, outOf: 5, attemptId: r.id });
  } else {
    const rows = await db.select().from(speakingDrills).where(and(inArray(speakingDrills.userId, userIds), eq(speakingDrills.kind, task.kind), window(speakingDrills.createdAt)));
    for (const r of rows) keep(r.userId, { at: r.createdAt, score: r.accuracy, outOf: 100, attemptId: r.id });
  }
  return out;
}

async function targeted(db: DbOrTx, task: Pick<Task, "tenantId" | "orgUnitIds">) {
  const units = await tenantUnits(db, task.tenantId);
  return studentIdsInUnits(db, task.tenantId, descendants(units, task.orgUnitIds));
}

const dueLine = (task: Task, timeZone: string) => msg("{kind}. Do it by {date}.", { kind: msg(PRACTICE_TASK_KINDS[task.kind]), date: at(task.closeAt, timeZone, { time: true, weekday: true }) });

export async function createPracticeTask(
  db: Db,
  auth: AuthContext,
  input: { kind: PracticeTaskKind; ref: string | null; note: string | null; unitIds: string[]; openAt: Date; closeAt: Date },
  now: Date,
) {
  const tenantId = auth.tenantId!;
  if (!validPracticeRef(input.kind, input.ref)) throw badRequest(input.kind === "jam" ? "Choose a JAM topic" : input.kind === "writing" ? "Choose a writing task" : "Drills don't take a topic");
  if (input.closeAt <= input.openAt) throw badRequest("The due date must be after the start");
  if (input.closeAt <= now) throw badRequest("The due date has already passed");
  await assertUnitsInScope(db, auth, input.unitIds);
  const tenant = await getTenant(db, tenantId);
  if (AI_PRACTICE_KINDS.includes(input.kind)) {
    // Students couldn't get these marked, so they couldn't do the task.
    if (!aiProvider() || tenant.settings.aiHints === false) throw badRequest("AI feedback is switched off, so students can't do JAM or writing tasks. Set a drill instead.");
    const allowed = await aiAllowed(db, tenantId, "ai_coach", now);
    if (!allowed.ok) throw badRequest(allowed.reason);
  }
  const [task] = await db
    .insert(practiceTasks)
    .values({ tenantId, kind: input.kind, ref: input.ref, note: input.note, orgUnitIds: input.unitIds, openAt: input.openAt, closeAt: input.closeAt, createdBy: auth.userId })
    .returning();
  const students = await targeted(db, task!);
  await enqueue(
    db,
    students.map(
      (userId): NewNotification => ({
        tenantId,
        userId,
        template: "practice_task",
        title: msg("From your trainer: {what}", { what: practiceTaskSubject(task!.kind, task!.ref) ?? msg(PRACTICE_TASK_KINDS[task!.kind]) }),
        body: dueLine(task!, tenant.timeZone),
        link: appLink(practiceTaskPath(task!.kind, task!.ref)),
        dedupeKey: `practice:${task!.id}:${userId}`,
      }),
    ),
  );
  await audit(db, { tenantId, actorId: auth.userId, action: "practice_task.create", target: task!.id, data: { kind: task!.kind, ref: task!.ref, students: students.length } });
  return { task: task!, students: students.length };
}

export async function deletePracticeTask(db: Db, auth: AuthContext, id: string) {
  const [task] = await db.select().from(practiceTasks).where(and(eq(practiceTasks.id, id), eq(practiceTasks.tenantId, auth.tenantId!)));
  if (!task) throw notFound("Task");
  await assertUnitsInScope(db, auth, task.orgUnitIds);
  await db.delete(practiceTasks).where(eq(practiceTasks.id, id));
  await audit(db, { tenantId: auth.tenantId!, actorId: auth.userId, action: "practice_task.delete", target: id });
  return { ok: true };
}

/** Tasks for batches in the staff member's scope, newest first, with how many have done each. */
export async function practiceTasksForStaff(db: Db, auth: AuthContext) {
  const tenantId = auth.tenantId!;
  const scoped = new Set(await scopedUnitIds(db, auth));
  const units = await tenantUnits(db, tenantId);
  const name = new Map(units.map((u) => [u.id, u.name]));
  const rows = (await db.select().from(practiceTasks).where(eq(practiceTasks.tenantId, tenantId)).orderBy(desc(practiceTasks.closeAt)).limit(100)).filter((t) => t.orgUnitIds.some((id) => scoped.has(id)));
  const out = [];
  for (const t of rows) {
    const students = await targeted(db, t);
    const done = await completion(db, t, students);
    const scores = [...done.values()].map((d) => d.score);
    out.push({
      id: t.id,
      kind: t.kind,
      ref: t.ref,
      subject: practiceTaskSubject(t.kind, t.ref),
      note: t.note,
      units: t.orgUnitIds.map((id) => ({ id, name: name.get(id) ?? "Unknown" })),
      openAt: t.openAt,
      closeAt: t.closeAt,
      targeted: students.length,
      done: done.size,
      average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      outOf: t.kind === "jam" || t.kind === "writing" ? 5 : 100,
    });
  }
  return { tasks: out };
}

/** One task: every targeted student, whether they've done it, and their best score. */
export async function practiceTaskForStaff(db: Db, auth: AuthContext, id: string) {
  const [task] = await db.select().from(practiceTasks).where(and(eq(practiceTasks.id, id), eq(practiceTasks.tenantId, auth.tenantId!)));
  if (!task) throw notFound("Task");
  await assertUnitsInScope(db, auth, task.orgUnitIds);
  const ids = await targeted(db, task);
  const people = ids.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [];
  const done = await completion(db, task, ids);
  return {
    task: { id: task.id, kind: task.kind, ref: task.ref, subject: practiceTaskSubject(task.kind, task.ref), note: task.note, openAt: task.openAt, closeAt: task.closeAt },
    students: people
      .map((p) => ({ ...p, done: done.get(p.id) ?? null }))
      .sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || a.name.localeCompare(b.name)),
  };
}

/** The student's tasks: open now, and those due in the last week, with whether they've done each. */
export async function myPracticeTasks(db: Db, ctx: { tenantId: string; userId: string; now: Date }) {
  const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  if (myUnits.size === 0) return { tasks: [] };
  const rows = (
    await db
      .select()
      .from(practiceTasks)
      .where(and(eq(practiceTasks.tenantId, ctx.tenantId), lte(practiceTasks.openAt, ctx.now), gte(practiceTasks.closeAt, new Date(ctx.now.getTime() - 7 * DAY))))
      .orderBy(practiceTasks.closeAt)
  ).filter((t) => t.orgUnitIds.some((id) => myUnits.has(id)));
  const tasks = [];
  for (const t of rows) {
    const done = (await completion(db, t, [ctx.userId])).get(ctx.userId) ?? null;
    tasks.push({ id: t.id, kind: t.kind, ref: t.ref, subject: practiceTaskSubject(t.kind, t.ref), note: t.note, closeAt: t.closeAt, open: t.closeAt > ctx.now, path: practiceTaskPath(t.kind, t.ref), done });
  }
  return { tasks };
}

/** Hourly: remind students who haven't done a task due within a day. */
export async function practiceTaskReminders(db: Db, now: Date) {
  const rows = await db
    .select({ t: practiceTasks, timeZone: tenants.timeZone })
    .from(practiceTasks)
    .innerJoin(tenants, eq(tenants.id, practiceTasks.tenantId))
    .where(and(lte(practiceTasks.openAt, now), gte(practiceTasks.closeAt, now), lte(practiceTasks.closeAt, new Date(now.getTime() + DAY))));
  let queued = 0;
  for (const { t, timeZone } of rows) {
    const students = await targeted(db, t);
    const done = await completion(db, t, students);
    queued += await enqueue(
      db,
      students
        .filter((id) => !done.has(id))
        .map((userId) => ({
          tenantId: t.tenantId,
          userId,
          template: "practice_task" as const,
          title: msg("Due soon: {title}", { title: practiceTaskSubject(t.kind, t.ref) ?? msg(PRACTICE_TASK_KINDS[t.kind]) }),
          body: dueLine(t, timeZone),
          link: appLink(practiceTaskPath(t.kind, t.ref)),
          dedupeKey: `practice-due:${t.id}:${userId}`,
        })),
    );
  }
  return queued;
}
