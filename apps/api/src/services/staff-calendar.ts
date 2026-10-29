import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { can, localDate, type StaffCalendarEvent } from "@playcode/core";
import type { Db } from "../db/client";
import { circulars, documentRequests, driveSchedules, driveSlots, placementApplications, placementDrives, trainingSessions } from "../db/schema";
import { visible } from "./circulars";
import { appLink } from "./notifications";
import type { AuthContext } from "./scope";
import { getTenant } from "./tenant";
import { listSessions } from "./training";

// The console calendar: everything with a date that the placement cell or a
// faculty member has to plan around, from their own features. Drives,
// interview days and offer deadlines are for the placement cell; training
// sessions, circulars and document requests show to whoever can see them.

const DAY = 86_400_000;

export async function staffCalendar(db: Db, auth: AuthContext, from: Date, to: Date, now: Date): Promise<StaffCalendarEvent[]> {
  const tenant = await getTenant(db, auth.tenantId!);
  const tz = tenant.timeZone;
  const [fromDay, toDay] = [localDate(from, tz), localDate(to, tz)];
  const inRange = (t: Date) => t >= from && t <= to;
  const dayInRange = (d: string) => d >= fromDay && d <= toDay;
  const events: StaffCalendarEvent[] = [];
  const base = { end: null, location: null, detail: null };

  if (can(auth.roles, "placements.manage")) {
    const drives = await db.select().from(placementDrives).where(eq(placementDrives.tenantId, tenant.id));
    for (const d of drives) {
      const url = appLink(`/console/placements/${d.id}`);
      if (dayInRange(d.driveDate)) events.push({ ...base, uid: `drive-${d.id}`, kind: "drive", title: `${d.company} drive`, start: d.driveDate, allDay: true, location: d.location || null, detail: d.roleTitle, url });
      if (d.status === "open" && inRange(d.registerBy)) events.push({ ...base, uid: `drive-deadline-${d.id}`, kind: "drive_deadline", title: `${d.company}: registration closes`, start: d.registerBy.toISOString(), allDay: false, url });
    }
    const byDrive = new Map(drives.map((d) => [d.id, d]));
    const schedules = await db
      .select({ s: driveSchedules, students: sql<number>`count(${driveSlots.userId})::int`, last: sql<Date>`max(${driveSlots.startsAt})` })
      .from(driveSchedules)
      .leftJoin(driveSlots, eq(driveSlots.scheduleId, driveSchedules.id))
      .where(and(eq(driveSchedules.tenantId, tenant.id), gte(driveSchedules.startsAt, new Date(from.getTime() - DAY)), lte(driveSchedules.startsAt, to)))
      .groupBy(driveSchedules.id);
    for (const { s, students, last } of schedules) {
      const d = byDrive.get(s.driveId);
      if (!d || !inRange(s.startsAt)) continue;
      const end = new Date(new Date(last ?? s.startsAt).getTime() + s.slotMinutes * 60_000);
      events.push({
        ...base,
        uid: `schedule-${s.id}`,
        kind: "interview_day",
        title: `${d.company}: ${d.rounds[s.round] ?? "Interviews"}`,
        start: s.startsAt.toISOString(),
        end: end.toISOString(),
        allDay: false,
        location: s.panels.map((p) => p.room).filter(Boolean).join(", ") || null,
        detail: `${students} student${students === 1 ? "" : "s"}, ${s.panels.length} panel${s.panels.length === 1 ? "" : "s"}`,
        url: appLink(`/console/placements/${d.id}`),
      });
    }
    // Offers waiting for an answer, one entry per day they fall due.
    const waiting = await db
      .select({ decideBy: placementApplications.decideBy })
      .from(placementApplications)
      .where(and(eq(placementApplications.tenantId, tenant.id), eq(placementApplications.status, "offered"), isNull(placementApplications.decision), gte(placementApplications.decideBy, from), lte(placementApplications.decideBy, to)));
    const perDay = new Map<string, number>();
    for (const w of waiting) perDay.set(localDate(w.decideBy!, tz), (perDay.get(localDate(w.decideBy!, tz)) ?? 0) + 1);
    for (const [day, n] of perDay) events.push({ ...base, uid: `offers-${day}`, kind: "offers_due", title: `${n} offer${n === 1 ? "" : "s"} due for an answer`, start: day, allDay: true, url: appLink("/console/placements") });
  }

  // Training sessions this person can see (listSessions covers four months back).
  const { upcoming, past } = await listSessions(db, auth, now);
  for (const s of [...past, ...upcoming]) {
    const start = new Date(s.startsAt);
    if (s.status !== "scheduled" || !inRange(start)) continue;
    events.push({ ...base, uid: `training-${s.id}`, kind: "training", title: s.title, start: start.toISOString(), end: new Date(start.getTime() + s.durationMinutes * 60_000).toISOString(), allDay: false, location: s.location, detail: s.trainer, url: appLink(`/console/training?id=${s.id}`) });
  }

  const [notices, requests] = await Promise.all([
    db.select().from(circulars).where(and(eq(circulars.tenantId, tenant.id), eq(circulars.requireAck, true), isNull(circulars.withdrawnAt), gte(circulars.ackBy, fromDay), lte(circulars.ackBy, toDay))),
    db.select().from(documentRequests).where(and(eq(documentRequests.tenantId, tenant.id), isNull(documentRequests.closedAt), gte(documentRequests.dueOn, fromDay), lte(documentRequests.dueOn, toDay))),
  ]);
  for (const c of notices) if (await visible(db, auth, c)) events.push({ ...base, uid: `circular-${c.id}`, kind: "circular_due", title: `Acknowledge: ${c.title}`, start: c.ackBy!, allDay: true, url: appLink(`/console/circulars?id=${c.id}`) });
  for (const r of requests) if (await visible(db, auth, r)) events.push({ ...base, uid: `documents-${r.id}`, kind: "document_due", title: `Upload: ${r.title}`, start: r.dueOn, allDay: true, url: appLink(`/console/documents?id=${r.id}`) });

  // All-day items first within a day, then by time.
  const dayOf = (e: StaffCalendarEvent) => (e.allDay ? e.start : localDate(new Date(e.start), tz));
  return events.sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
}
