import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import { toIcs, type CalendarEvent } from "@playcode/core";
import type { Db } from "../db/client";
import { assignments, users } from "../db/schema";
import { env } from "../env";
import { notFound } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { studentAssessments } from "./assessments";
import { isAssignedTo } from "./assignments";
import { studentContests } from "./contests";
import { studentSlots } from "./interview-slots";
import { appLink } from "./notifications";
import { studentPlacements } from "./placements";
import { studentUnitIdsWithAncestors } from "./scope";
import { myTraining } from "./training";

// One calendar for everything dated in a student's PlayCode: training
// sessions, test windows, assignment deadlines, contests, placement drives
// and booked mock interviews. Each source's own student view decides what the
// student sees, so the calendar can't show something the app wouldn't. The
// private feed link lets Google Calendar or a phone subscribe; only a hash of
// its token is stored, and resetting it stops the old link.

type Ctx = { tenantId: string; userId: string; now: Date };
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

export async function calendarEvents(db: Db, ctx: Ctx, from: Date, to: Date): Promise<CalendarEvent[]> {
  const inRange = (start: Date, end: Date | null) => start <= to && (end ?? start) >= from;
  const events: CalendarEvent[] = [];

  const training = await myTraining(db, ctx);
  for (const s of [...training.openNow, ...training.upcoming, ...training.past]) {
    const start = new Date(s.startsAt);
    const end = new Date(start.getTime() + s.durationMinutes * 60_000);
    if (s.status !== "scheduled" || !inRange(start, end)) continue;
    events.push({ uid: `training-${s.id}@playcode`, kind: "training", title: s.title, start: iso(start), end: iso(end), allDay: false, location: s.location, detail: `${s.kindLabel} with ${s.trainer}`, url: appLink("/play/training") });
  }

  for (const a of await studentAssessments(db, ctx)) {
    if (!inRange(a.openAt, a.closeAt)) continue;
    events.push({ uid: `test-${a.id}@playcode`, kind: "test", title: `Test: ${a.title}`, start: iso(a.openAt), end: iso(a.closeAt), allDay: false, location: null, detail: `${a.durationMinutes} minutes, ${a.questionCount} questions; take it any time in this window.`, url: appLink("/play/tests") });
  }

  const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  const due = (await db.select().from(assignments).where(and(eq(assignments.tenantId, ctx.tenantId), gte(assignments.closeAt, from), lte(assignments.closeAt, to)))).filter((a) => isAssignedTo(a, myUnits, ctx.userId));
  for (const a of due) {
    events.push({ uid: `assignment-${a.id}@playcode`, kind: "assignment", title: `Due: ${a.title}`, start: iso(a.closeAt), end: null, allDay: false, location: null, detail: `${a.questionIds.length} questions`, url: appLink("/play") });
  }

  for (const c of (await studentContests(db, ctx)).contests) {
    if (!inRange(c.startsAt, c.endsAt)) continue;
    events.push({ uid: `contest-${c.id}@playcode`, kind: "contest", title: `Contest: ${c.title}`, start: iso(c.startsAt), end: iso(c.endsAt), allDay: false, location: null, detail: null, url: appLink("/play/contests") });
  }

  for (const d of (await studentPlacements(db, ctx)).drives) {
    // Open drives the student can register for, and drives they're in.
    if (!d.application && !(d.open && d.eligibility.eligible)) continue;
    const driveDay = new Date(`${d.driveDate}T00:00:00Z`);
    if (inRange(driveDay, new Date(driveDay.getTime() + DAY - 1))) {
      events.push({ uid: `drive-${d.id}@playcode`, kind: "drive", title: `${d.company}: ${d.roleTitle}`, start: d.driveDate, end: null, allDay: true, location: d.location || null, detail: d.application ? "You're registered." : "Register in PlayCode before the deadline.", url: appLink("/play/placements") });
    }
    if (!d.application && inRange(d.registerBy, null)) {
      events.push({ uid: `drive-deadline-${d.id}@playcode`, kind: "drive_deadline", title: `Register by: ${d.company}`, start: iso(d.registerBy), end: null, allDay: false, location: null, detail: `${d.roleTitle}. Registration closes.`, url: appLink("/play/placements") });
    }
  }

  for (const s of (await studentSlots(db, ctx)).mine) {
    const start = new Date(s.startsAt);
    const end = new Date(start.getTime() + s.durationMinutes * 60_000);
    if (s.status !== "booked" || !inRange(start, end)) continue;
    events.push({ uid: `interview-${s.id}@playcode`, kind: "interview", title: `Mock interview with ${s.interviewerName}`, start: iso(start), end: iso(end), allDay: false, location: s.location || null, detail: null, url: appLink("/play/panel") });
  }

  const at = (e: CalendarEvent) => (e.allDay ? `${e.start}T00:00:00.000Z` : e.start);
  return events.sort((a, b) => at(a).localeCompare(at(b)) || a.title.localeCompare(b.title));
}

// ---------- The private feed ----------

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const feedUrl = (token: string) => `${env.API_PUBLIC_URL.replace(/\/$/, "")}/calendar/${token}.ics`;

export async function feedStatus(db: Db, userId: string) {
  const [u] = await db.select({ createdAt: users.calendarTokenCreatedAt }).from(users).where(eq(users.id, userId));
  return { active: Boolean(u?.createdAt), createdAt: u?.createdAt ?? null };
}

/** A new link (any old one stops working). The token is returned this once. */
export async function resetFeed(db: Db, userId: string, now: Date) {
  const token = randomBytes(24).toString("base64url");
  await db.update(users).set({ calendarTokenHash: hash(token), calendarTokenCreatedAt: now }).where(eq(users.id, userId));
  return { url: feedUrl(token), createdAt: now };
}

export async function revokeFeed(db: Db, userId: string) {
  await db.update(users).set({ calendarTokenHash: null, calendarTokenCreatedAt: null }).where(eq(users.id, userId));
}

/** The feed itself: the last month and the next three, as iCalendar. */
export async function feedIcs(db: Db, token: string, now: Date) {
  if (!/^[\w-]{20,64}$/.test(token)) throw notFound("Calendar");
  const [u] = await db.select().from(users).where(eq(users.calendarTokenHash, hash(token)));
  if (!u || u.status !== "active" || !u.tenantId) throw notFound("Calendar");
  // Calendar apps poll every few hours; this only stops a runaway client.
  await rateLimit(`calendar:${u.id}`, 120, 3_600_000, now, "Too many calendar requests");
  const events = await calendarEvents(db, { tenantId: u.tenantId, userId: u.id, now }, new Date(now.getTime() - 30 * DAY), new Date(now.getTime() + 90 * DAY));
  return toIcs(events, { name: `PlayCode: ${u.name.split(/\s+/)[0]}`, now });
}
