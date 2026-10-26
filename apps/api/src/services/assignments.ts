import { and, eq, inArray } from "drizzle-orm";
import { hashString, masteryFromRating, shuffle } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { assignments, packs, questions, skillRatings, skills, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { visibleTo } from "./practice";
import { descendants, studentIdsInUnits, tenantUnits } from "./scope";

type Assignment = typeof assignments.$inferSelect;

/** Of the students in an assignment's units, those it is for (a remedial assignment names them). */
export const forStudents = (a: Pick<Assignment, "studentIds">, unitStudentIds: string[]) =>
  a.studentIds ? unitStudentIds.filter((id) => a.studentIds!.includes(id)) : unitStudentIds;

/** Whether an assignment is for this student, given the units they belong to (with ancestors). */
export const isAssignedTo = (a: Pick<Assignment, "orgUnitIds" | "studentIds">, myUnits: Set<string>, userId: string) =>
  a.orgUnitIds.some((id) => myUnits.has(id)) && (!a.studentIds || a.studentIds.includes(userId));

export interface NewAssignment {
  title: string;
  packId?: string;
  skillIds?: string[];
  count: number;
  unitIds: string[];
  openAt: Date;
  closeAt: Date;
  studentIds?: string[] | null;
  remedial?: Assignment["remedial"];
}

/** Create an assignment from a mission pack or from skills (everyone gets the same questions). */
export async function createAssignment(db: Db, args: NewAssignment & { tenantId: string; actorId: string }) {
  let questionIds: string[];
  if (args.packId) {
    const [pack] = await db.select().from(packs).where(eq(packs.id, args.packId));
    if (!pack || (pack.tenantId && pack.tenantId !== args.tenantId)) throw notFound("Pack");
    questionIds = pack.questionIds;
  } else {
    const pool = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(visibleTo(args.tenantId), inArray(questions.skillId, args.skillIds ?? [])))
      .orderBy(questions.difficulty, questions.id);
    if (pool.length === 0) throw badRequest("Those skills have no questions yet");
    questionIds = shuffle(pool.map((p) => p.id), hashString(`${args.title}:${args.openAt.toISOString()}`)).slice(0, args.count);
  }
  const [created] = await db
    .insert(assignments)
    .values({
      tenantId: args.tenantId,
      title: args.title,
      packId: args.packId ?? null,
      questionIds,
      orgUnitIds: args.unitIds,
      studentIds: args.studentIds ?? null,
      remedial: args.remedial ?? null,
      openAt: args.openAt,
      closeAt: args.closeAt,
      createdBy: args.actorId,
    })
    .returning();
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "assignment.create", target: created!.id, data: { title: args.title, questions: questionIds.length, ...(args.studentIds ? { students: args.studentIds.length } : {}) } });
  return created!;
}

/** Each student's average mastery over the skills (skills never practised count as 0), and how many questions they've answered on them. */
export async function masteryOver(db: DbOrTx, studentIds: string[], skillIds: string[]) {
  const ratings = studentIds.length && skillIds.length
    ? await db.select().from(skillRatings).where(and(inArray(skillRatings.userId, studentIds), inArray(skillRatings.skillId, skillIds)))
    : [];
  return new Map(
    studentIds.map((id) => {
      const mine = ratings.filter((r) => r.userId === id);
      const sum = mine.reduce((n, r) => n + masteryFromRating(r.rating), 0);
      return [id, { mastery: Math.round(sum / skillIds.length), attempts: mine.reduce((n, r) => n + r.attempts, 0) }] as const;
    }),
  );
}

/**
 * Students in the units (and the units below them) whose mastery of the skills
 * is under `below`, weakest first. Students who never tried the skills are a
 * different problem (getting started), so they're left out unless asked for.
 */
export async function weakStudents(db: Db, args: { tenantId: string; unitIds: string[]; skillIds: string[]; below: number; includeUnpractised: boolean }) {
  const known = await db.select({ id: skills.id, name: skills.name }).from(skills).where(inArray(skills.id, args.skillIds));
  if (known.length !== new Set(args.skillIds).size) throw badRequest("Choose skills from the syllabus");
  const ids = await studentIdsInUnits(db, args.tenantId, descendants(await tenantUnits(db, args.tenantId), args.unitIds));
  const mastery = await masteryOver(db, ids, args.skillIds);
  const weak = ids.filter((id) => {
    const m = mastery.get(id)!;
    return m.mastery < args.below && (args.includeUnpractised || m.attempts > 0);
  });
  const people = weak.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(and(inArray(users.id, weak), eq(users.status, "active"))) : [];
  return people.map((p) => ({ ...p, ...mastery.get(p.id)! })).sort((a, b) => a.mastery - b.mastery || a.name.localeCompare(b.name));
}

/** A skills assignment for only the students who are weak in those skills, remembering where each started. */
export async function createRemedialAssignment(
  db: Db,
  args: Omit<NewAssignment, "packId" | "studentIds" | "remedial"> & { tenantId: string; actorId: string; skillIds: string[]; below: number; includeUnpractised: boolean; studentIds?: string[] },
) {
  const candidates = await weakStudents(db, args);
  // Staff may untick some of the students the preview found; they can't add others.
  const chosen = args.studentIds ? candidates.filter((c) => args.studentIds!.includes(c.id)) : candidates;
  if (chosen.length === 0) throw badRequest(`No students in those batches are below ${args.below}% on those skills`);
  return createAssignment(db, {
    ...args,
    studentIds: chosen.map((c) => c.id),
    remedial: { skillIds: args.skillIds, below: args.below, baseline: Object.fromEntries(chosen.map((c) => [c.id, c.mastery])) },
  });
}

/** How a remedial assignment's students have moved on its skills since it was set. */
export async function remedialProgress(db: DbOrTx, a: Assignment) {
  if (!a.remedial || !a.studentIds) return null;
  const now = await masteryOver(db, a.studentIds, a.remedial.skillIds);
  const names = await db.select({ id: skills.id, name: skills.name }).from(skills).where(inArray(skills.id, a.remedial.skillIds));
  const students = a.studentIds.map((id) => ({ id, before: a.remedial!.baseline[id] ?? 0, now: now.get(id)?.mastery ?? 0 }));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((n, x) => n + x, 0) / xs.length) : 0);
  return {
    skills: names,
    below: a.remedial.below,
    avgBefore: avg(students.map((s) => s.before)),
    avgNow: avg(students.map((s) => s.now)),
    improved: students.filter((s) => s.now > s.before).length,
    reachedTarget: students.filter((s) => s.now >= a.remedial!.below).length,
    students,
  };
}
