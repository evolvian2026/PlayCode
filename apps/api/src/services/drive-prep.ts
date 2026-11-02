import { and, eq, inArray, isNull } from "drizzle-orm";
import { DRIVE_PREP_ORDER, DRIVE_PREP_STEPS, drivePrepProgress, isWeekday, type DrivePrep } from "@playcode/core";
import type { Db } from "../db/client";
import { certificates, interviewExperiences, interviews, onDutyRequests, packs, placementApplications, placementDrives, users } from "../db/schema";
import { notFound } from "../lib/errors";
import { officialAptitude } from "./adaptive";
import { checklistFor } from "./checklist";
import { appLink, enqueue, processOutbox } from "./notifications";
import { getTenant, tenantToday } from "./tenant";

// Getting ready for one drive. Students see their plan for each drive they
// registered for, every step checked from what PlayCode already records; the
// placement cell sees the registrants against the same steps and can remind
// those behind, each with what they're missing.

type Drive = typeof placementDrives.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };
const DAY = 86_400_000;
const active = ["registered", "shortlisted"] as const;

/** Each student's steps for a drive. */
export async function prepFor(db: Db, tenantId: string, drive: Drive, userIds: string[], now: Date): Promise<Map<string, DrivePrep>> {
  const out = new Map<string, DrivePrep>();
  if (!userIds.length) return out;
  const minAptitude = drive.criteria.minAptitude ?? null;
  const weekday = isWeekday(drive.driveDate);
  const [lists, passed, interviewed, aptitude, onDuty] = await Promise.all([
    checklistFor(db, tenantId, userIds, now),
    drive.packId
      ? db.select({ userId: certificates.userId }).from(certificates).where(and(inArray(certificates.userId, userIds), eq(certificates.kind, "mission"), eq(certificates.refId, drive.packId), isNull(certificates.revokedAt)))
      : [],
    db.selectDistinct({ userId: interviews.userId }).from(interviews).where(and(eq(interviews.driveId, drive.id), eq(interviews.status, "finished"), inArray(interviews.userId, userIds))),
    minAptitude !== null ? officialAptitude(db, tenantId, userIds, now) : new Map<string, { score: number }>(),
    weekday
      ? db.select({ userId: onDutyRequests.userId }).from(onDutyRequests).where(and(eq(onDutyRequests.tenantId, tenantId), eq(onDutyRequests.date, drive.driveDate), inArray(onDutyRequests.userId, userIds), inArray(onDutyRequests.status, ["pending", "approved"])))
      : [],
  ]);
  const has = (rows: { userId: string }[]) => new Set(rows.map((r) => r.userId));
  const [p, i, o] = [has(passed), has(interviewed), has(onDuty)];
  for (const id of userIds) {
    const c = lists.get(id)!;
    out.set(id, {
      mission: drive.packId ? p.has(id) : null,
      interview: i.has(id),
      aptitude: minAptitude === null ? null : (aptitude.get(id)?.score ?? -1) >= minAptitude,
      profile: c.profile,
      documents: c.documents,
      on_duty: weekday ? o.has(id) : null,
    });
  }
  return out;
}

async function loadDrive(db: Db, tenantId: string, id: string) {
  const [drive] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, id), eq(placementDrives.tenantId, tenantId)));
  if (!drive) throw notFound("Drive");
  return drive;
}

async function registrants(db: Db, drive: Drive) {
  return db
    .select({ id: users.id, name: users.name, rollNo: users.rollNo })
    .from(placementApplications)
    .innerJoin(users, eq(users.id, placementApplications.userId))
    .where(and(eq(placementApplications.driveId, drive.id), inArray(placementApplications.status, [...active])));
}

/** A student's plan for a drive they registered for. */
export async function myDrivePrep(db: Db, ctx: Ctx, driveId: string) {
  const drive = await loadDrive(db, ctx.tenantId, driveId);
  const [app] = await db.select().from(placementApplications).where(and(eq(placementApplications.driveId, drive.id), eq(placementApplications.userId, ctx.userId)));
  if (!app || !(active as readonly string[]).includes(app.status)) throw notFound("Drive you're registered for");
  const [prep, pack, experiences, official] = await Promise.all([
    prepFor(db, ctx.tenantId, drive, [ctx.userId], ctx.now).then((m) => m.get(ctx.userId)!),
    drive.packId ? db.select({ title: packs.title }).from(packs).where(eq(packs.id, drive.packId)).then((r) => r[0]?.title ?? null) : null,
    db.select({ id: interviewExperiences.id }).from(interviewExperiences).innerJoin(placementDrives, eq(placementDrives.id, interviewExperiences.driveId)).where(and(eq(interviewExperiences.tenantId, ctx.tenantId), eq(interviewExperiences.status, "published"), eq(placementDrives.company, drive.company))),
    drive.criteria.minAptitude != null ? officialAptitude(db, ctx.tenantId, [ctx.userId], ctx.now).then((m) => m.get(ctx.userId)?.score ?? null) : null,
  ]);
  const today = tenantToday(await getTenant(db, ctx.tenantId), ctx.now);
  const progress = drivePrepProgress(prep);
  return {
    drive: { id: drive.id, company: drive.company, roleTitle: drive.roleTitle, companyType: drive.companyType, driveDate: drive.driveDate, rounds: drive.rounds, packId: drive.packId, packTitle: pack, minAptitude: drive.criteria.minAptitude ?? null },
    daysLeft: Math.round((Date.parse(`${drive.driveDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY),
    steps: DRIVE_PREP_ORDER.filter((k) => prep[k] !== null).map((k) => ({ key: k, ...DRIVE_PREP_STEPS[k], done: prep[k]! })),
    done: progress.done,
    total: progress.total,
    aptitude: official,
    experiences: experiences.length,
  };
}

/** The registrants against the drive's steps, those furthest behind first, with how many have done each. */
export async function drivePrep(db: Db, tenantId: string, driveId: string, now: Date) {
  const drive = await loadDrive(db, tenantId, driveId);
  const people = await registrants(db, drive);
  const preps = await prepFor(db, tenantId, drive, people.map((p) => p.id), now);
  const students = people
    .map((p) => {
      const prep = preps.get(p.id)!;
      const progress = drivePrepProgress(prep);
      return { ...p, steps: prep, done: progress.done, total: progress.total, missing: progress.missing };
    })
    .sort((a, b) => a.done / (a.total || 1) - b.done / (b.total || 1) || (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));
  // The steps that apply to someone here: no mission column for a drive without one, no documents column when nothing was asked.
  const steps = DRIVE_PREP_ORDER.filter((k) => students.some((st) => st.steps[k] !== null));
  return {
    steps: steps.map((k) => ({ key: k, label: DRIVE_PREP_STEPS[k].label, done: students.filter((s) => s.steps[k] === true).length, applies: students.filter((s) => s.steps[k] !== null).length })),
    students,
    ready: students.filter((s) => s.missing.length === 0).length,
  };
}

/** Remind every registrant who is behind, each with their own missing steps; once a day per drive. */
export async function remindDrivePrep(db: Db, tenantId: string, driveId: string, actorId: string, now: Date) {
  const drive = await loadDrive(db, tenantId, driveId);
  const { students } = await drivePrep(db, tenantId, driveId, now);
  const today = tenantToday(await getTenant(db, tenantId), now);
  const sent = await enqueue(
    db,
    students
      .filter((s) => s.missing.length)
      .map((s) => ({
        tenantId,
        userId: s.id,
        template: "placement" as const,
        title: s.missing.length === 1 ? `One step left before ${drive.company}: ${DRIVE_PREP_STEPS[s.missing[0]!].label.toLowerCase()}` : `${s.missing.length} steps left before the ${drive.company} drive`,
        body: s.missing.map((k) => DRIVE_PREP_STEPS[k].label).join(", "),
        link: appLink(`/play/placements/${drive.id}/prep`),
        dedupeKey: `drive-prep:${drive.id}:${s.id}:${today}`,
        sentBy: actorId,
      })),
  );
  void processOutbox(db, now).catch(() => {});
  return { sent };
}
