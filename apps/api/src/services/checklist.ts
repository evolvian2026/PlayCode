import { and, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { CHECKLIST_ATTENDANCE, CHECKLIST_ITEMS, CHECKLIST_READINESS, checklistProgress, SITTING_OUT_MIN_DRIVES, type ChecklistItem } from "@playcode/core";
import type { Db } from "../db/client";
import { academicRecords, documentRequests, documentSubmissions, interviews, memberships, placementApplications, placementDrives, studentProfiles, users } from "../db/schema";
import { badRequest, forbidden } from "../lib/errors";
import { readinessFor } from "./analytics";
import { appLink, enqueue, processOutbox } from "./notifications";
import { studentsEligible } from "./placements";
import { descendants, scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";
import { attendanceFor } from "./training";

// Ready for placements: what the placement cell needs from every student
// before drives start (a complete record, a resume, the documents it asked
// for) and what shows they have prepared (a mock interview, practice,
// training). Students see their own checklist; the placement cell sees who is
// missing what, and who is sitting the season out, and can nudge them.

type Items = Record<ChecklistItem, boolean | null>;
const DAY = 86_400_000;

/** The checklist for many students at once. */
export async function checklistFor(db: Db, tenantId: string, userIds: string[], now: Date): Promise<Map<string, Items>> {
  const out = new Map<string, Items>();
  if (!userIds.length) return out;
  const tenant = await getTenant(db, tenantId);
  const [records, profiles, requests, units, member, finished, readiness, attendance] = await Promise.all([
    db.select().from(academicRecords).where(inArray(academicRecords.userId, userIds)),
    db.select({ userId: studentProfiles.userId, headline: studentProfiles.headline, about: studentProfiles.about }).from(studentProfiles).where(inArray(studentProfiles.userId, userIds)),
    db.select().from(documentRequests).where(and(eq(documentRequests.tenantId, tenantId), isNull(documentRequests.closedAt))),
    tenantUnits(db, tenantId),
    db.select({ userId: memberships.userId, unitId: memberships.orgUnitId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, userIds))),
    db.selectDistinct({ userId: interviews.userId }).from(interviews).where(and(eq(interviews.tenantId, tenantId), eq(interviews.status, "finished"), inArray(interviews.userId, userIds))),
    readinessFor(db, userIds, tenantToday(tenant, now)),
    attendanceFor(db, tenantId, userIds, now),
  ]);
  const submissions = requests.length
    ? await db
        .select({ requestId: documentSubmissions.requestId, userId: documentSubmissions.userId })
        .from(documentSubmissions)
        .where(and(inArray(documentSubmissions.requestId, requests.map((r) => r.id)), inArray(documentSubmissions.userId, userIds), ne(documentSubmissions.status, "rejected")))
    : [];
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const unitsOf = new Map<string, Set<string>>();
  for (const m of member) {
    const set = unitsOf.get(m.userId) ?? unitsOf.set(m.userId, new Set()).get(m.userId)!;
    for (let id: string | null | undefined = m.unitId; id && !set.has(id); id = parent.get(id)) set.add(id);
  }
  const done = new Set(finished.map((f) => f.userId));
  for (const id of userIds) {
    const r = records.find((x) => x.userId === id);
    const p = profiles.find((x) => x.userId === id);
    const mine = unitsOf.get(id) ?? new Set<string>();
    const asked = requests.filter((q) => q.unitIds.length === 0 || q.unitIds.some((u) => mine.has(u)));
    const best = Math.max(0, ...Object.values(readiness.get(id) ?? {}));
    const pct = attendance.get(id)?.pct ?? null;
    out.set(id, {
      record: Boolean(r && r.cgpa !== null && r.backlogs !== null && r.tenthPct !== null && r.twelfthPct !== null && r.graduationYear !== null),
      profile: Boolean(p && p.headline.trim() && p.about.trim().length >= 20),
      documents: asked.length ? asked.every((q) => submissions.some((s) => s.requestId === q.id && s.userId === id)) : null,
      mock_interview: done.has(id),
      practice: best >= CHECKLIST_READINESS,
      training: pct === null ? null : pct >= CHECKLIST_ATTENDANCE,
    });
  }
  return out;
}

const describe = (items: Items) => {
  const progress = checklistProgress(items);
  return {
    items: (Object.keys(CHECKLIST_ITEMS) as ChecklistItem[]).map((k) => ({ key: k, ...CHECKLIST_ITEMS[k], status: items[k] === null ? ("n/a" as const) : items[k] ? ("done" as const) : ("missing" as const) })),
    done: progress.done,
    total: progress.total,
    missing: progress.missing,
  };
};

export async function myChecklist(db: Db, ctx: { tenantId: string; userId: string; now: Date }) {
  const items = (await checklistFor(db, ctx.tenantId, [ctx.userId], ctx.now)).get(ctx.userId)!;
  return describe(items);
}

/**
 * Drives in the last year open to each student, and how many they registered
 * for. A drive they registered for was open to them; for the rest, eligibility
 * is checked as things stand (an offer since then can close drives that were
 * open, which only undercounts students who are already placed).
 */
async function participation(db: Db, tenantId: string, userIds: string[], now: Date) {
  const drives = await db.select().from(placementDrives).where(and(eq(placementDrives.tenantId, tenantId), gte(placementDrives.createdAt, new Date(now.getTime() - 365 * DAY))));
  const apps = userIds.length && drives.length
    ? await db
        .select({ userId: placementApplications.userId, driveId: placementApplications.driveId })
        .from(placementApplications)
        .where(and(inArray(placementApplications.driveId, drives.map((d) => d.id)), inArray(placementApplications.userId, userIds), ne(placementApplications.status, "withdrawn")))
    : [];
  const open = new Map(userIds.map((id) => [id, new Set(apps.filter((a) => a.userId === id).map((a) => a.driveId))]));
  for (const d of drives) for (const id of await studentsEligible(db, tenantId, d.criteria, { driveId: d.id, ctcRupees: d.ctcRupees, now })) open.get(id)?.add(d.id);
  return new Map(userIds.map((id) => [id, { eligible: open.get(id)!.size, registered: apps.filter((a) => a.userId === id).length }]));
}

/** Students in scope (or in one batch or section) with their checklist and drive participation. */
export async function batchChecklist(db: Db, auth: AuthContext, unitId: string | null, now: Date) {
  const tenantId = auth.tenantId!;
  const scoped = await scopedUnitIds(db, auth);
  if (unitId && !scoped.includes(unitId)) throw forbidden("That batch or section is outside your scope");
  const units = await tenantUnits(db, tenantId);
  const ids = await studentIdsInUnits(db, tenantId, unitId ? descendants(units, [unitId]) : scoped);
  const [people, lists, drives, unitRows] = await Promise.all([
    ids.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(and(inArray(users.id, ids), eq(users.status, "active"))) : [],
    checklistFor(db, tenantId, ids, now),
    participation(db, tenantId, ids, now),
    ids.length ? db.select({ userId: memberships.userId, unitId: memberships.orgUnitId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, ids))) : [],
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const students = people
    .map((p) => {
      const c = describe(lists.get(p.id)!);
      const d = drives.get(p.id)!;
      const unit = unitRows.find((u) => u.userId === p.id)?.unitId;
      return { id: p.id, name: p.name, rollNo: p.rollNo, unit: unit ? (unitName.get(unit) ?? null) : null, done: c.done, total: c.total, missing: c.missing, drives: d, sittingOut: d.eligible >= SITTING_OUT_MIN_DRIVES && d.registered === 0 };
    })
    .sort((a, b) => a.done / (a.total || 1) - b.done / (b.total || 1) || (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));
  const missing = Object.fromEntries((Object.keys(CHECKLIST_ITEMS) as ChecklistItem[]).map((k) => [k, students.filter((s) => s.missing.includes(k)).length])) as Record<ChecklistItem, number>;
  return {
    students,
    summary: { students: students.length, ready: students.filter((s) => s.missing.length === 0).length, missing, sittingOut: students.filter((s) => s.sittingOut).length },
  };
}

/** Remind students of what's missing on their checklist, or that drives they're eligible for are passing them by. */
export async function nudge(db: Db, auth: AuthContext, input: { userIds: string[]; about: "checklist" | "drives" }, now: Date) {
  const tenantId = auth.tenantId!;
  const scope = new Set(await studentIdsInUnits(db, tenantId, await scopedUnitIds(db, auth)));
  if (input.userIds.some((id) => !scope.has(id))) throw badRequest("Some students are outside your scope");
  const today = tenantToday(await getTenant(db, tenantId), now);
  const notes: Parameters<typeof enqueue>[1] = [];
  if (input.about === "checklist") {
    const lists = await checklistFor(db, tenantId, input.userIds, now);
    for (const id of input.userIds) {
      const { missing } = checklistProgress(lists.get(id)!);
      if (!missing.length) continue;
      notes.push({
        tenantId,
        userId: id,
        template: "placement",
        title: missing.length === 1 ? `One thing left before placements: ${CHECKLIST_ITEMS[missing[0]!].label.toLowerCase()}` : `${missing.length} things left before placements`,
        body: missing.map((k) => CHECKLIST_ITEMS[k].label).join(", "),
        link: appLink("/play/placements"),
        dedupeKey: `checklist:${id}:${today}`,
        sentBy: auth.userId,
      });
    }
  } else {
    for (const id of input.userIds)
      notes.push({
        tenantId,
        userId: id,
        template: "placement",
        title: "Drives you're eligible for are going by",
        body: "You haven't registered for any drive yet. Have a look at what's open, or tell your placement cell if something is stopping you.",
        link: appLink("/play/placements"),
        dedupeKey: `sitting-out:${id}:${today}`,
        sentBy: auth.userId,
      });
  }
  const sent = await enqueue(db, notes);
  void processOutbox(db, now).catch(() => {});
  return { sent };
}
