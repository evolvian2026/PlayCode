import { and, count, eq, gt, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { addDays, isoWeekKey, localDate, masteryFromRating, msg, weekday } from "@playcode/core";
import type { Db } from "../db/client";
import { assignments, memberships, placementApplications, placementDrives, playerProfiles, responses, sessions, skillRatings, tenants, users } from "../db/schema";
import { forStudents } from "./assignments";
import { appLink, enqueue, type NewNotification } from "./notifications";
import { descendants, studentIdsInUnits, tenantUnits } from "./scope";

// "Your week": on Sunday evening, each student who has practised in the last
// four weeks gets one short note: answers this week, their streak, skills
// mastered, and how many assignments and drives fall in the coming week.
// Students who stopped practising a month ago aren't sent a weekly reminder
// of it; the streak and review nudges are for bringing people back.

const DAY = 86_400_000;
/** Mastery and attempts at which a skill counts as mastered, as on the resume. */
const MASTERED = 60;
const MIN_ATTEMPTS = 5;

const localHour = (now: Date, timeZone: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));

export async function weeklySummaries(db: Db, now: Date, opts: { tenantId?: string; anyTime?: boolean } = {}) {
  const tenantRows = await db.select().from(tenants).where(opts.tenantId ? eq(tenants.id, opts.tenantId) : undefined);
  let queued = 0;
  for (const tenant of tenantRows) {
    if (tenant.settings.nudges === false) continue;
    const today = localDate(now, tenant.timeZone);
    // Sunday, 6 pm to 9 pm: after the weekend, before quiet hours.
    if (!opts.anyTime) {
      const hour = localHour(now, tenant.timeZone);
      if (weekday(today) !== 0 || hour < 18 || hour >= 21) continue;
    }

    const active = (
      await db
        .selectDistinct({ userId: responses.userId })
        .from(responses)
        .innerJoin(users, eq(users.id, responses.userId))
        // Students only (staff trying a question don't get a practice summary), and not graduated.
        .innerJoin(memberships, and(eq(memberships.userId, responses.userId), eq(memberships.tenantId, tenant.id), eq(memberships.role, "student"), isNull(memberships.graduatedAt)))
        .where(and(eq(responses.tenantId, tenant.id), eq(users.status, "active"), gte(responses.createdAt, new Date(now.getTime() - 28 * DAY))))
    ).map((r) => r.userId);
    if (active.length === 0) continue;

    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const nextWeek = new Date(now.getTime() + 7 * DAY);
    const [answers, profiles, ratings, drives, open] = await Promise.all([
      db
        .select({ userId: responses.userId, n: count() })
        .from(responses)
        .where(and(eq(responses.tenantId, tenant.id), inArray(responses.userId, active), gte(responses.createdAt, weekAgo)))
        .groupBy(responses.userId),
      db.select({ userId: playerProfiles.userId, streak: playerProfiles.streakCurrent, last: playerProfiles.streakLastDate }).from(playerProfiles).where(inArray(playerProfiles.userId, active)),
      db.select({ userId: skillRatings.userId, rating: skillRatings.rating, attempts: skillRatings.attempts }).from(skillRatings).where(inArray(skillRatings.userId, active)),
      db
        .select({ userId: placementApplications.userId, n: count() })
        .from(placementApplications)
        .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
        .where(
          and(
            eq(placementApplications.tenantId, tenant.id),
            inArray(placementApplications.userId, active),
            ne(placementApplications.status, "withdrawn"),
            gte(placementDrives.driveDate, today),
            lte(placementDrives.driveDate, addDays(today, 7)),
          ),
        )
        .groupBy(placementApplications.userId),
      // Assignments closing in the coming week, whether open now or opening soon.
      db.select().from(assignments).where(and(eq(assignments.tenantId, tenant.id), gt(assignments.closeAt, now), lte(assignments.closeAt, nextWeek))),
    ]);

    const due = new Map<string, number>();
    for (const d of drives) due.set(d.userId, d.n);
    if (open.length > 0) {
      const units = await tenantUnits(db, tenant.id);
      const finished = await db
        .select({ assignmentId: sessions.assignmentId, userId: sessions.userId })
        .from(sessions)
        .where(and(inArray(sessions.assignmentId, open.map((a) => a.id)), isNotNull(sessions.finishedAt)));
      const done = new Set(finished.map((f) => `${f.assignmentId}:${f.userId}`));
      const activeSet = new Set(active);
      for (const a of open) {
        for (const userId of forStudents(a, await studentIdsInUnits(db, tenant.id, descendants(units, a.orgUnitIds)))) {
          if (activeSet.has(userId) && !done.has(`${a.id}:${userId}`)) due.set(userId, (due.get(userId) ?? 0) + 1);
        }
      }
    }

    const answered = new Map(answers.map((a) => [a.userId, a.n]));
    const mastered = new Map<string, number>();
    for (const r of ratings) if (r.attempts >= MIN_ATTEMPTS && masteryFromRating(r.rating) >= MASTERED) mastered.set(r.userId, (mastered.get(r.userId) ?? 0) + 1);
    // A streak only counts while it's alive: practised today or yesterday.
    const streak = new Map(profiles.map((p) => [p.userId, p.last && p.last >= addDays(today, -1) ? p.streak : 0]));

    const week = isoWeekKey(today);
    const items: NewNotification[] = active.map((userId) => {
      const n = answered.get(userId) ?? 0;
      return {
        tenantId: tenant.id,
        userId,
        template: "weekly_summary" as const,
        title: n > 0 ? msg("Your week: {n} answers", { n }) : msg("Your week: no practice this week"),
        body: msg("{streak}-day streak · {mastered} skills mastered · {due} due in the next 7 days", {
          streak: streak.get(userId) ?? 0,
          mastered: mastered.get(userId) ?? 0,
          due: due.get(userId) ?? 0,
        }),
        link: appLink("/play"),
        dedupeKey: `weekly:${userId}:${week}`,
      };
    });
    queued += await enqueue(db, items);
  }
  return queued;
}
