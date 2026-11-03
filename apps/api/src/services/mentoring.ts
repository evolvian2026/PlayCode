import { and, desc, eq, inArray } from "drizzle-orm";
import { hasInstitutionScope, localDate, MENTOR_ROLES, menteeFlags, splitIntoBlocks, type MeetingMode } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { memberships, mentorAssignments, mentoringMeetings, paperResults, questionPapers, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { readinessFor } from "./analytics";
import { descendants, scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";
import { attendanceFor } from "./training";

// Mentor–mentee system: each student has one faculty mentor. Staff who look
// after a batch assign mentees by hand or split a section into blocks by roll
// number. A mentor sees each mentee's readiness, practice, training
// attendance and class tests with what needs attention, and keeps a record of
// meetings: notes for staff, and action points the student sees.

type Ctx = { tenantId: string; userId: string; now: Date };
const byRoll = (a: { rollNo: string | null; name: string }, b: { rollNo: string | null; name: string }) => (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true });

async function studentsInScope(db: DbOrTx, auth: AuthContext, unitId?: string) {
  const tenantId = auth.tenantId!;
  const scoped = await scopedUnitIds(db, auth);
  if (unitId && !scoped.includes(unitId)) throw forbidden("That batch or section is outside your scope");
  return studentIdsInUnits(db, tenantId, unitId ? descendants(await tenantUnits(db, tenantId), [unitId]) : scoped);
}

/** Staff who can be mentors: faculty, HODs, the placement officer and institution admins. */
async function mentorCandidates(db: DbOrTx, tenantId: string) {
  const rows = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, [...MENTOR_ROLES]), eq(users.status, "active")));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Assigning ----------

export async function assignmentSheet(db: Db, auth: AuthContext, unitId: string) {
  const ids = await studentsInScope(db, auth, unitId);
  const [people, current, mentors] = await Promise.all([
    ids.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [],
    ids.length ? db.select().from(mentorAssignments).where(and(eq(mentorAssignments.tenantId, auth.tenantId!), inArray(mentorAssignments.studentId, ids))) : [],
    mentorCandidates(db, auth.tenantId!),
  ]);
  const all = await db.select({ mentorId: mentorAssignments.mentorId }).from(mentorAssignments).where(eq(mentorAssignments.tenantId, auth.tenantId!));
  const load = new Map<string, number>();
  for (const a of all) load.set(a.mentorId, (load.get(a.mentorId) ?? 0) + 1);
  const mentorOf = new Map(current.map((a) => [a.studentId, a.mentorId]));
  return {
    mentors: mentors.map((m) => ({ ...m, mentees: load.get(m.id) ?? 0 })),
    students: people.sort(byRoll).map((p) => ({ ...p, mentorId: mentorOf.get(p.id) ?? null })),
  };
}

async function checkMentor(db: DbOrTx, tenantId: string, mentorId: string) {
  if (!(await mentorCandidates(db, tenantId)).some((m) => m.id === mentorId)) throw badRequest("Mentors must be faculty, HODs, the placement officer or an admin of this institution");
}

export async function assignMentor(db: Db, auth: AuthContext, mentorId: string, studentIds: string[], now: Date) {
  await checkMentor(db, auth.tenantId!, mentorId);
  const allowed = new Set(await studentsInScope(db, auth));
  if (studentIds.some((id) => !allowed.has(id))) throw forbidden("Some of these students aren't in your batches");
  for (const studentId of studentIds) {
    await db
      .insert(mentorAssignments)
      .values({ tenantId: auth.tenantId!, studentId, mentorId, assignedBy: auth.userId, assignedAt: now })
      .onConflictDoUpdate({ target: [mentorAssignments.tenantId, mentorAssignments.studentId], set: { mentorId, assignedBy: auth.userId, assignedAt: now } });
  }
  await audit(db, { tenantId: auth.tenantId!, actorId: auth.userId, action: "mentoring.assign", target: mentorId, data: { students: studentIds.length } });
  return { assigned: studentIds.length };
}

/** Split a section between mentors in contiguous roll-number blocks. */
export async function splitSection(db: Db, auth: AuthContext, unitId: string, mentorIds: string[], now: Date) {
  if (!mentorIds.length || new Set(mentorIds).size !== mentorIds.length) throw badRequest("Choose the mentors, each once");
  for (const m of mentorIds) await checkMentor(db, auth.tenantId!, m);
  const sheet = await assignmentSheet(db, auth, unitId);
  const blocks = splitIntoBlocks(sheet.students, mentorIds.length);
  for (const [i, block] of blocks.entries()) if (block.length) await assignMentor(db, auth, mentorIds[i]!, block.map((s) => s.id), now);
  return { blocks: blocks.map((b, i) => ({ mentorId: mentorIds[i]!, students: b.length, from: b[0]?.rollNo ?? null, to: b.at(-1)?.rollNo ?? null })) };
}

export async function unassign(db: Db, auth: AuthContext, studentIds: string[]) {
  const allowed = new Set(await studentsInScope(db, auth));
  const ids = studentIds.filter((id) => allowed.has(id));
  if (ids.length) await db.delete(mentorAssignments).where(and(eq(mentorAssignments.tenantId, auth.tenantId!), inArray(mentorAssignments.studentId, ids)));
  return { removed: ids.length };
}

// ---------- The mentor ----------

/** A mentor's mentees with what needs attention, most flags first. */
export async function myMentees(db: Db, auth: AuthContext, now: Date, mentorId = auth.userId) {
  const tenantId = auth.tenantId!;
  const tenant = await getTenant(db, tenantId);
  const today = tenantToday(tenant, now);
  let ids = (await db.select({ id: mentorAssignments.studentId }).from(mentorAssignments).where(and(eq(mentorAssignments.tenantId, tenantId), eq(mentorAssignments.mentorId, mentorId)))).map((r) => r.id);
  // Looking at someone else's mentees shows only students in your own scope.
  if (mentorId !== auth.userId) {
    const mine = new Set(await studentsInScope(db, auth));
    ids = ids.filter((id) => mine.has(id));
  }
  if (!ids.length) return { mentees: [], counts: { mentees: 0, needAttention: 0 } };
  const [people, readiness, attendance, meetings, tests] = await Promise.all([
    db.select({ id: users.id, name: users.name, rollNo: users.rollNo, lastActiveAt: users.lastActiveAt }).from(users).where(inArray(users.id, ids)),
    readinessFor(db, ids, today),
    attendanceFor(db, tenantId, ids, now),
    db.select().from(mentoringMeetings).where(and(eq(mentoringMeetings.tenantId, tenantId), inArray(mentoringMeetings.studentId, ids))).orderBy(desc(mentoringMeetings.meetingDate), desc(mentoringMeetings.createdAt)),
    db
      .select({ userId: paperResults.userId, score: paperResults.score, enteredAt: paperResults.enteredAt, marksPer: questionPapers.marksPerQuestion, questionIds: questionPapers.questionIds, title: questionPapers.title })
      .from(paperResults)
      .innerJoin(questionPapers, eq(questionPapers.id, paperResults.paperId))
      .where(inArray(paperResults.userId, ids))
      .orderBy(desc(paperResults.enteredAt)),
  ]);
  const mentees = people.sort(byRoll).map((p) => {
    const last = meetings.find((m) => m.studentId === p.id);
    const test = tests.find((t) => t.userId === p.id);
    const r = readiness.get(p.id) ?? {};
    const signals = {
      today,
      lastMeeting: last?.meetingDate ?? null,
      nextFollowUp: last?.followUpOn ?? null,
      lastActive: p.lastActiveAt ? localDate(p.lastActiveAt, tenant.timeZone) : null,
      attendancePct: attendance.get(p.id)?.pct ?? null,
      readiness: r.service ?? 0,
    };
    return {
      id: p.id,
      name: p.name,
      rollNo: p.rollNo,
      readiness: { service: r.service ?? 0, product: r.product ?? 0 },
      lastActive: signals.lastActive,
      attendancePct: signals.attendancePct,
      latestTest: test ? { title: test.title, pct: Math.round((test.score / (test.questionIds.length * test.marksPer || 1)) * 100) } : null,
      lastMeeting: signals.lastMeeting,
      nextFollowUp: signals.nextFollowUp,
      meetings: meetings.filter((m) => m.studentId === p.id).length,
      flags: menteeFlags(signals),
    };
  });
  mentees.sort((a, b) => b.flags.length - a.flags.length);
  return { mentees, counts: { mentees: mentees.length, needAttention: mentees.filter((m) => m.flags.length).length } };
}

async function canSee(db: DbOrTx, auth: AuthContext, studentId: string) {
  const [a] = await db.select().from(mentorAssignments).where(and(eq(mentorAssignments.tenantId, auth.tenantId!), eq(mentorAssignments.studentId, studentId)));
  if (a?.mentorId === auth.userId) return { assignment: a, isMentor: true };
  if (hasInstitutionScope(auth.roles) || (await studentsInScope(db, auth)).includes(studentId)) return { assignment: a ?? null, isMentor: false };
  throw notFound("Mentee");
}

export async function menteeRecord(db: Db, auth: AuthContext, studentId: string) {
  const { assignment, isMentor } = await canSee(db, auth, studentId);
  const [student] = await db.select({ id: users.id, name: users.name, rollNo: users.rollNo, email: users.email }).from(users).where(eq(users.id, studentId));
  const [mentor] = assignment ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, assignment.mentorId)) : [];
  const meetings = await db.select().from(mentoringMeetings).where(and(eq(mentoringMeetings.tenantId, auth.tenantId!), eq(mentoringMeetings.studentId, studentId))).orderBy(desc(mentoringMeetings.meetingDate), desc(mentoringMeetings.createdAt));
  const names = new Map((meetings.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(meetings.map((m) => m.mentorId))])) : []).map((u) => [u.id, u.name]));
  return {
    student,
    mentor: mentor ?? null,
    canLog: isMentor,
    meetings: meetings.map((m) => ({ id: m.id, meetingDate: m.meetingDate, mode: m.mode, notes: m.notes, actionPoints: m.actionPoints, followUpOn: m.followUpOn, by: names.get(m.mentorId) ?? null })),
  };
}

export interface MeetingInput {
  meetingDate: string;
  mode: MeetingMode;
  notes: string;
  actionPoints: string;
  followUpOn: string | null;
}

export async function logMeeting(db: Db, auth: AuthContext, studentId: string, input: MeetingInput, now: Date) {
  const { isMentor } = await canSee(db, auth, studentId);
  if (!isMentor) throw forbidden("Only the student's mentor records meetings");
  const today = tenantToday(await getTenant(db, auth.tenantId!), now);
  if (input.meetingDate > today) throw badRequest("Record meetings that have happened");
  if (input.followUpOn && input.followUpOn <= input.meetingDate) throw badRequest("The follow-up should be after the meeting");
  if (!input.notes.trim() && !input.actionPoints.trim()) throw badRequest("Write a note or an action point");
  await db.insert(mentoringMeetings).values({ tenantId: auth.tenantId!, mentorId: auth.userId, studentId, ...input, notes: input.notes.trim(), actionPoints: input.actionPoints.trim(), createdAt: now });
  return menteeRecord(db, auth, studentId);
}

// ---------- The student ----------

export async function myMentor(db: Db, ctx: Ctx) {
  const [a] = await db.select().from(mentorAssignments).where(and(eq(mentorAssignments.tenantId, ctx.tenantId), eq(mentorAssignments.studentId, ctx.userId)));
  const [mentor] = a ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, a.mentorId)) : [];
  // The student sees when they met and what they agreed to do, not the mentor's notes.
  const meetings = await db
    .select({ meetingDate: mentoringMeetings.meetingDate, mode: mentoringMeetings.mode, actionPoints: mentoringMeetings.actionPoints, followUpOn: mentoringMeetings.followUpOn })
    .from(mentoringMeetings)
    .where(and(eq(mentoringMeetings.tenantId, ctx.tenantId), eq(mentoringMeetings.studentId, ctx.userId)))
    .orderBy(desc(mentoringMeetings.meetingDate));
  return { mentor: mentor ?? null, meetings };
}

/** For the accreditation report: mentors, mentees covered and meetings in a period, for given students. */
export async function mentoringStats(db: DbOrTx, tenantId: string, studentIds: string[], from: string, to: string) {
  if (!studentIds.length) return { mentors: 0, mentees: 0, coveragePct: 0, ratio: null as number | null, meetings: 0, studentsMet: 0 };
  const assigned = await db.select().from(mentorAssignments).where(and(eq(mentorAssignments.tenantId, tenantId), inArray(mentorAssignments.studentId, studentIds)));
  const meetings = (await db.select({ studentId: mentoringMeetings.studentId, date: mentoringMeetings.meetingDate }).from(mentoringMeetings).where(and(eq(mentoringMeetings.tenantId, tenantId), inArray(mentoringMeetings.studentId, studentIds)))).filter((m) => m.date >= from && m.date <= to);
  const mentors = new Set(assigned.map((a) => a.mentorId)).size;
  return {
    mentors,
    mentees: assigned.length,
    coveragePct: Math.round((assigned.length / studentIds.length) * 100),
    /** Mentees per mentor, the figure NAAC asks for. */
    ratio: mentors ? Math.round((assigned.length / mentors) * 10) / 10 : null,
    meetings: meetings.length,
    studentsMet: new Set(meetings.map((m) => m.studentId)).size,
  };
}
