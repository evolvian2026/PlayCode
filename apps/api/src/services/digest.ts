import { and, count, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { addDays, can, isoWeekKey, localDate, planHas, ROLES, weekday, type Role } from "@playcode/core";
import type { Db } from "../db/client";
import {
  alumniIntros,
  documentSubmissions,
  helpTickets,
  interviewExperiences,
  memberships,
  placementApplications,
  placementDrives,
  recruiterInteractions,
  resumeEntries,
  resumeReviews,
  staffDigests,
  studentOutcomes,
  users,
} from "../db/schema";
import { mailer } from "../lib/mailer";
import { joiningBoard } from "./joining";
import { appLink } from "./notifications";
import { peerStats } from "./peer";
import type { AuthContext } from "./scope";
import { getTenant } from "./tenant";

// The placement cell's week: drives coming up, offers made, and every queue
// waiting on staff, in one place, and by email on Monday morning so the week
// starts with a list rather than a search.

const DAY = 86_400_000;

export async function weekSummary(db: Db, auth: AuthContext, now: Date) {
  const tenantId = auth.tenantId!;
  const tenant = await getTenant(db, tenantId);
  const today = localDate(now, tenant.timeZone);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [drives, offers, helpdesk, reviews, intros, documents, outcomes, internships, experiences, followUps, joining, peer] = await Promise.all([
    db
      .select({ id: placementDrives.id, company: placementDrives.company, roleTitle: placementDrives.roleTitle, driveDate: placementDrives.driveDate, registered: sql<number>`(select count(*)::int from placement_applications a where a.drive_id = ${placementDrives.id} and a.status <> 'withdrawn')` })
      .from(placementDrives)
      .where(and(eq(placementDrives.tenantId, tenantId), gte(placementDrives.driveDate, today), lte(placementDrives.driveDate, addDays(today, 7))))
      .orderBy(placementDrives.driveDate),
    db
      .select({ company: placementDrives.company, n: count() })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.status, "offered"), gte(placementApplications.updatedAt, weekAgo)))
      .groupBy(placementDrives.company),
    n(db.select({ n: count() }).from(helpTickets).where(and(eq(helpTickets.tenantId, tenantId), eq(helpTickets.status, "open")))),
    n(db.select({ n: count() }).from(resumeReviews).where(and(eq(resumeReviews.tenantId, tenantId), eq(resumeReviews.status, "waiting")))),
    n(db.select({ n: count() }).from(alumniIntros).where(and(eq(alumniIntros.tenantId, tenantId), eq(alumniIntros.status, "pending")))),
    n(db.select({ n: count() }).from(documentSubmissions).where(and(eq(documentSubmissions.tenantId, tenantId), eq(documentSubmissions.status, "pending")))),
    n(db.select({ n: count() }).from(studentOutcomes).where(and(eq(studentOutcomes.tenantId, tenantId), eq(studentOutcomes.status, "pending")))),
    n(db.select({ n: count() }).from(resumeEntries).where(and(eq(resumeEntries.tenantId, tenantId), eq(resumeEntries.verification, "requested")))),
    n(db.select({ n: count() }).from(interviewExperiences).where(and(eq(interviewExperiences.tenantId, tenantId), eq(interviewExperiences.status, "pending")))),
    n(db.select({ n: count() }).from(recruiterInteractions).where(and(eq(recruiterInteractions.tenantId, tenantId), eq(recruiterInteractions.followUpDone, false), lte(recruiterInteractions.followUpOn, today)))),
    joiningBoard(db, auth, now),
    peerStats(db, auth, weekAgo, now),
  ]);
  const queues = [
    { key: "helpdesk", label: "Helpdesk questions waiting for an answer", count: helpdesk, link: "/console/help" },
    { key: "documents", label: "Documents to verify", count: documents, link: "/console/documents" },
    { key: "resume_reviews", label: "Resumes waiting for a review", count: reviews, link: "/console/resume-reviews" },
    { key: "intros", label: "Alumni introductions to send", count: intros, link: "/console/alumni" },
    { key: "internships", label: "Internships to verify", count: internships, link: "/console/internships" },
    { key: "outcomes", label: "Off-campus offers and admissions to verify", count: outcomes, link: "/console/outcomes" },
    { key: "experiences", label: "Interview experiences to review", count: experiences, link: "/console/experiences" },
    { key: "follow_ups", label: "Company follow-ups due", count: followUps, link: "/console/recruiters" },
    { key: "joining", label: "Accepted offers with joining delayed", count: joining.totals.delayed, link: "/console/joining" },
  ];
  return {
    institution: tenant.name,
    weekOf: today,
    drives,
    offers: { total: offers.reduce((s, o) => s + o.n, 0), byCompany: offers.sort((a, b) => b.n - a.n) },
    queues,
    waiting: queues.reduce((s, q) => s + q.count, 0),
    peer,
  };
}

export type WeekSummary = Awaited<ReturnType<typeof weekSummary>>;

export function digestText(w: WeekSummary): string {
  const lines = [`The week at ${w.institution}`, ""];
  lines.push(w.drives.length ? "Drives in the next seven days:" : "No drives in the next seven days.");
  for (const d of w.drives) lines.push(`  ${d.driveDate}  ${d.company}, ${d.roleTitle} (${d.registered} registered)`);
  lines.push("", w.offers.total ? `Offers made last week: ${w.offers.total} (${w.offers.byCompany.map((o) => `${o.company} ${o.n}`).join(", ")})` : "No offers made last week.");
  const open = w.queues.filter((q) => q.count);
  lines.push("", open.length ? "Waiting on the placement cell:" : "Nothing is waiting on the placement cell.");
  for (const q of open) lines.push(`  ${q.count}  ${q.label}: ${appLink(q.link)}`);
  if (w.peer.sessions) lines.push("", `Students held ${w.peer.sessions} practice interviews with each other (${w.peer.students} students).`);
  lines.push("", `The full week: ${appLink("/console/week")}`, "To stop this email, switch it off on that page.");
  return lines.join("\n");
}

export async function digestSetting(db: Db, userId: string) {
  const [row] = await db.select().from(staffDigests).where(eq(staffDigests.userId, userId));
  return { enabled: row?.enabled ?? true, emailConfigured: Boolean(mailer()) };
}

export async function setDigest(db: Db, userId: string, enabled: boolean) {
  await db.insert(staffDigests).values({ userId, enabled }).onConflictDoUpdate({ target: staffDigests.userId, set: { enabled } });
  return digestSetting(db, userId);
}

const MANAGERS = ROLES.filter((r) => can([r], "placements.manage")) as Role[];

/**
 * Hourly: from 08:00 on Monday (each institution's time), email the week to
 * everyone who manages placements there, once a week, unless they switched
 * it off.
 */
export async function weeklyDigests(db: Db, now: Date) {
  const m = mailer();
  if (!m) return 0;
  let sent = 0;
  const staff = await db
    .select({ userId: users.id, email: users.email, tenantId: memberships.tenantId, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inArray(memberships.role, MANAGERS), eq(users.status, "active"), isNotNull(memberships.tenantId)));
  const prefs = await db.select().from(staffDigests);
  const done = new Set<string>();
  for (const s of staff) {
    if (!s.email || !s.tenantId || done.has(s.userId)) continue;
    done.add(s.userId);
    const tenant = await getTenant(db, s.tenantId);
    if (tenant.type !== "institution" || !planHas(tenant.plan, "placements")) continue;
    const today = localDate(now, tenant.timeZone);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
    if (weekday(today) !== 1 || hour < 8) continue;
    const week = isoWeekKey(today);
    const pref = prefs.find((p) => p.userId === s.userId);
    if (pref && (!pref.enabled || pref.lastWeek === week)) continue;
    const summary = await weekSummary(db, { userId: s.userId, tenantId: s.tenantId, roles: [s.role as Role] }, now);
    await m.send({ to: s.email, subject: `${tenant.name}: the placement week${summary.waiting ? ` (${summary.waiting} waiting on you)` : ""}`, text: digestText(summary) });
    await db.insert(staffDigests).values({ userId: s.userId, enabled: true, lastWeek: week }).onConflictDoUpdate({ target: staffDigests.userId, set: { lastWeek: week } });
    sent++;
  }
  return sent;
}

