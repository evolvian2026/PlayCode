import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { DRIVE_AUDIENCES, deskOpen, inAudience, MAX_COORDINATORS, offerDetailsError, type DriveAudience, type OfferDetails } from "@playcode/core";
import type { Db } from "../db/client";
import { driveCheckIns, driveCoordinators, driveSchedules, driveSlots, driveUpdates, memberships, placementApplications, placementDrives, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { markSlot } from "./drive-schedules";
import { appLink, enqueue, processOutbox } from "./notifications";
import { getTenant, tenantToday } from "./tenant";

// Drive days. The placement cell sends updates to some of a drive's
// applicants (the venue changed, the shortlist is out, bring two copies of
// your resume) and they collect on the drive card. Students it trusts help at
// the reporting desk: from their phones they check in each student who turns
// up, so staff know who is there, and whoever didn't report can be marked
// absent in one step. And each drive can say what its offer is made of.

type Auth = { tenantId: string; userId: string };
type Ctx = { tenantId: string; userId: string; now: Date };

async function loadDrive(db: Db, tenantId: string, id: string) {
  const [d] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, id), eq(placementDrives.tenantId, tenantId)));
  if (!d) throw notFound("Placement drive");
  return d;
}

// ---------- Updates ----------

export async function postUpdate(db: Db, auth: Auth, driveId: string, input: { audience: DriveAudience; round: number | null; body: string }, now: Date) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  if (input.audience === "round" && (input.round === null || !drive.rounds[input.round])) throw badRequest("Choose the round");
  const apps = await db.select({ userId: placementApplications.userId, status: placementApplications.status, roundsCleared: placementApplications.roundsCleared }).from(placementApplications).where(eq(placementApplications.driveId, drive.id));
  const recipients = apps.filter((a) => inAudience(a, input.audience, input.round)).map((a) => a.userId);
  if (!recipients.length) throw badRequest("Nobody is in that group yet");
  const body = input.body.trim();
  const [u] = await db.insert(driveUpdates).values({ driveId: drive.id, tenantId: auth.tenantId, audience: input.audience, round: input.audience === "round" ? input.round : null, body, recipients, createdBy: auth.userId, createdAt: now }).returning();
  await enqueue(
    db,
    recipients.map((userId) => ({
      tenantId: auth.tenantId,
      userId,
      template: "placement" as const,
      title: `${drive.company}: update from the placement cell`,
      body: body.length > 160 ? `${body.slice(0, 157)}...` : body,
      link: appLink("/play/placements"),
      dedupeKey: `drive-update:${u!.id}:${userId}`,
      sentBy: auth.userId,
    })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.drive_update", target: drive.id, data: { audience: input.audience, round: input.round, recipients: recipients.length } });
  return listUpdates(db, auth.tenantId, drive.id);
}

export async function listUpdates(db: Db, tenantId: string, driveId: string) {
  const drive = await loadDrive(db, tenantId, driveId);
  const rows = await db
    .select({ u: driveUpdates, by: users.name })
    .from(driveUpdates)
    .leftJoin(users, eq(users.id, driveUpdates.createdBy))
    .where(eq(driveUpdates.driveId, drive.id))
    .orderBy(desc(driveUpdates.createdAt));
  return {
    updates: rows.map(({ u, by }) => ({
      id: u.id,
      audience: u.audience,
      audienceLabel: u.audience === "round" ? `Waiting for ${drive.rounds[u.round!] ?? "a round"}` : DRIVE_AUDIENCES[u.audience],
      body: u.body,
      recipients: u.recipients.length,
      by,
      createdAt: u.createdAt,
    })),
  };
}

/** The updates each of a student's drives sent them, newest first. */
export async function updatesFor(db: Db, tenantId: string, userId: string) {
  const rows = await db
    .select({ driveId: driveUpdates.driveId, body: driveUpdates.body, at: driveUpdates.createdAt })
    .from(driveUpdates)
    .where(and(eq(driveUpdates.tenantId, tenantId), sql`${driveUpdates.recipients} @> ${JSON.stringify([userId])}::jsonb`))
    .orderBy(desc(driveUpdates.createdAt));
  const out = new Map<string, { body: string; at: Date }[]>();
  for (const r of rows) (out.get(r.driveId) ?? out.set(r.driveId, []).get(r.driveId)!).push({ body: r.body, at: r.at });
  return out;
}

// ---------- Coordinators ----------

export async function coordinators(db: Db, tenantId: string, driveId: string) {
  const drive = await loadDrive(db, tenantId, driveId);
  const rows = await db
    .select({ userId: driveCoordinators.userId, name: users.name, rollNo: users.rollNo })
    .from(driveCoordinators)
    .innerJoin(users, eq(users.id, driveCoordinators.userId))
    .where(eq(driveCoordinators.driveId, drive.id))
    .orderBy(asc(users.name));
  return { coordinators: rows };
}

/** Appoint (or replace) a drive's student coordinators. Candidates in the drive can't coordinate it. */
export async function setCoordinators(db: Db, auth: Auth, driveId: string, userIds: string[], now: Date) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  const ids = [...new Set(userIds)];
  if (ids.length > MAX_COORDINATORS) throw badRequest(`Up to ${MAX_COORDINATORS} coordinators per drive`);
  if (ids.length) {
    const students = await db.selectDistinct({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, auth.tenantId), eq(memberships.role, "student"), inArray(memberships.userId, ids)));
    if (students.length !== ids.length) throw badRequest("Coordinators are students of this institution");
    const candidates = await db
      .select({ userId: placementApplications.userId })
      .from(placementApplications)
      .where(and(eq(placementApplications.driveId, drive.id), inArray(placementApplications.userId, ids), sql`${placementApplications.status} <> 'withdrawn'`));
    if (candidates.length) throw badRequest("Students registered for this drive can't coordinate it");
  }
  const before = new Set((await db.select({ userId: driveCoordinators.userId }).from(driveCoordinators).where(eq(driveCoordinators.driveId, drive.id))).map((r) => r.userId));
  await db.transaction(async (tx) => {
    await tx.delete(driveCoordinators).where(eq(driveCoordinators.driveId, drive.id));
    if (ids.length) await tx.insert(driveCoordinators).values(ids.map((userId) => ({ driveId: drive.id, userId, tenantId: auth.tenantId, addedBy: auth.userId, createdAt: now })));
  });
  const tenant = await getTenant(db, auth.tenantId);
  const day = new Date(`${drive.driveDate}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  await enqueue(
    db,
    ids
      .filter((id) => !before.has(id))
      .map((userId) => ({
        tenantId: tenant.id,
        userId,
        template: "placement" as const,
        title: `You're a coordinator for the ${drive.company} drive`,
        body: `On ${day}, check students in at the reporting desk from the Placements page. Thank you for helping!`,
        link: appLink(`/play/desk?drive=${drive.id}`),
        dedupeKey: `drive-coordinator:${drive.id}:${userId}`,
        sentBy: auth.userId,
      })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.coordinators", target: drive.id, data: { coordinators: ids.length } });
  return coordinators(db, auth.tenantId, drive.id);
}

/** Drives a student coordinates, with whether the desk is open today. */
export async function myDesks(db: Db, ctx: Ctx) {
  const today = tenantToday(await getTenant(db, ctx.tenantId), ctx.now);
  const rows = await db
    .select({ id: placementDrives.id, company: placementDrives.company, driveDate: placementDrives.driveDate, location: placementDrives.location })
    .from(driveCoordinators)
    .innerJoin(placementDrives, eq(placementDrives.id, driveCoordinators.driveId))
    .where(and(eq(driveCoordinators.tenantId, ctx.tenantId), eq(driveCoordinators.userId, ctx.userId)))
    .orderBy(asc(placementDrives.driveDate));
  return { desks: rows.filter((r) => r.driveDate >= addDays(today, -1)).map((r) => ({ ...r, open: deskOpen(r.driveDate, today) })) };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------- Reporting desk ----------

/** Who is expected on the drive day (everyone still in the selection), with their interview slots and whether they reported. */
async function deskList(db: Db, tenantId: string, driveId: string) {
  const drive = await loadDrive(db, tenantId, driveId);
  const [apps, checkIns, slots] = await Promise.all([
    db
      .select({ userId: placementApplications.userId, name: users.name, rollNo: users.rollNo, roundsCleared: placementApplications.roundsCleared })
      .from(placementApplications)
      .innerJoin(users, eq(users.id, placementApplications.userId))
      .where(and(eq(placementApplications.driveId, drive.id), inArray(placementApplications.status, ["registered", "shortlisted"]))),
    db.select().from(driveCheckIns).where(eq(driveCheckIns.driveId, drive.id)),
    db
      .select({ userId: driveSlots.userId, startsAt: driveSlots.startsAt, round: driveSchedules.round })
      .from(driveSlots)
      .innerJoin(driveSchedules, eq(driveSchedules.id, driveSlots.scheduleId))
      .where(eq(driveSchedules.driveId, drive.id)),
  ]);
  const reported = new Map(checkIns.map((c) => [c.userId, c.reportedAt]));
  const students = apps
    .map((a) => {
      const mine = slots.filter((s) => s.userId === a.userId).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
      return { userId: a.userId, name: a.name, rollNo: a.rollNo, round: drive.rounds[a.roundsCleared] ?? "", slot: mine.at(-1) ? { round: drive.rounds[mine.at(-1)!.round] ?? "", startsAt: mine.at(-1)!.startsAt } : null, reportedAt: reported.get(a.userId) ?? null };
    })
    .sort((x, y) => (x.rollNo ?? x.name).localeCompare(y.rollNo ?? y.name, "en", { numeric: true }));
  return { drive: { id: drive.id, company: drive.company, roleTitle: drive.roleTitle, driveDate: drive.driveDate, location: drive.location }, expected: students.length, reported: students.filter((s) => s.reportedAt).length, students };
}

async function assertCoordinator(db: Db, ctx: Ctx, driveId: string) {
  const drive = await loadDrive(db, ctx.tenantId, driveId);
  const [c] = await db.select().from(driveCoordinators).where(and(eq(driveCoordinators.driveId, drive.id), eq(driveCoordinators.userId, ctx.userId)));
  if (!c) throw notFound("Reporting desk");
  if (!deskOpen(drive.driveDate, tenantToday(await getTenant(db, ctx.tenantId), ctx.now))) throw forbidden("The reporting desk opens the day before the drive");
  return drive;
}

/** The desk as a coordinator sees it: names, roll numbers and slot times only. */
export async function coordinatorDesk(db: Db, ctx: Ctx, driveId: string) {
  await assertCoordinator(db, ctx, driveId);
  return deskList(db, ctx.tenantId, driveId);
}

async function setReported(db: Db, tenantId: string, byId: string, driveId: string, userId: string, reported: boolean, now: Date) {
  const [app] = await db
    .select({ status: placementApplications.status })
    .from(placementApplications)
    .where(and(eq(placementApplications.driveId, driveId), eq(placementApplications.userId, userId)));
  if (!app || (app.status !== "registered" && app.status !== "shortlisted")) throw notFound("Student");
  if (reported) await db.insert(driveCheckIns).values({ driveId, userId, tenantId, reportedAt: now, byId }).onConflictDoNothing();
  else await db.delete(driveCheckIns).where(and(eq(driveCheckIns.driveId, driveId), eq(driveCheckIns.userId, userId)));
}

export async function coordinatorCheckIn(db: Db, ctx: Ctx, driveId: string, userId: string, reported: boolean) {
  await assertCoordinator(db, ctx, driveId);
  await setReported(db, ctx.tenantId, ctx.userId, driveId, userId, reported, ctx.now);
  return deskList(db, ctx.tenantId, driveId);
}

/** The desk for staff, with the coordinators. */
export async function staffDesk(db: Db, tenantId: string, driveId: string) {
  return { ...(await deskList(db, tenantId, driveId)), ...(await coordinators(db, tenantId, driveId)) };
}

export async function staffCheckIn(db: Db, auth: Auth, driveId: string, userId: string, reported: boolean, now: Date) {
  await loadDrive(db, auth.tenantId, driveId);
  await setReported(db, auth.tenantId, auth.userId, driveId, userId, reported, now);
  return staffDesk(db, auth.tenantId, driveId);
}

/** Everyone with a slot in this schedule who hasn't reported is marked absent (and told, as with any absence). */
export async function markUnreportedAbsent(db: Db, auth: Auth, driveId: string, scheduleId: string) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  const [s] = await db.select().from(driveSchedules).where(and(eq(driveSchedules.id, scheduleId), eq(driveSchedules.driveId, drive.id)));
  if (!s) throw notFound("Schedule");
  const reported = new Set((await db.select({ userId: driveCheckIns.userId }).from(driveCheckIns).where(eq(driveCheckIns.driveId, drive.id))).map((r) => r.userId));
  const slots = await db.select().from(driveSlots).where(and(eq(driveSlots.scheduleId, s.id), eq(driveSlots.status, "scheduled")));
  const absent = slots.filter((x) => !reported.has(x.userId));
  for (const x of absent) await markSlot(db, auth, drive.id, s.id, x.userId, "no_show");
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.unreported_absent", target: drive.id, data: { round: s.round, absent: absent.length } });
  return { absent: absent.length };
}

// ---------- Offer details ----------

export async function setOfferDetails(db: Db, auth: Auth, driveId: string, details: OfferDetails) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  const err = offerDetailsError(details, drive.ctcRupees);
  if (err) throw badRequest(err);
  const empty = Object.values(details).every((v) => v === null || v === undefined || v === "");
  await db.update(placementDrives).set({ offerDetails: empty ? null : details }).where(eq(placementDrives.id, drive.id));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.offer_details", target: drive.id });
  return { offerDetails: empty ? null : details };
}

/** For the data export and erasure. */
export async function driveDayForExport(db: Db, userId: string) {
  const [updates, reported, coordinating] = await Promise.all([
    db
      .select({ company: placementDrives.company, body: driveUpdates.body, at: driveUpdates.createdAt })
      .from(driveUpdates)
      .innerJoin(placementDrives, eq(placementDrives.id, driveUpdates.driveId))
      .where(sql`${driveUpdates.recipients} @> ${JSON.stringify([userId])}::jsonb`),
    db.select({ company: placementDrives.company, reportedAt: driveCheckIns.reportedAt }).from(driveCheckIns).innerJoin(placementDrives, eq(placementDrives.id, driveCheckIns.driveId)).where(eq(driveCheckIns.userId, userId)),
    db.select({ company: placementDrives.company, driveDate: placementDrives.driveDate }).from(driveCoordinators).innerJoin(placementDrives, eq(placementDrives.id, driveCoordinators.driveId)).where(eq(driveCoordinators.userId, userId)),
  ]);
  return { updates, reported, coordinating };
}
