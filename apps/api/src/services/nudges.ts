import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { addDays, dueForReview, isoWeekKey, localDate, masteryFromRating } from "@playcode/core";
import type { Db } from "../db/client";
import { assessmentAttempts, assessments, assignments, playerProfiles, questions, sessions, skillRatings, tenants, users } from "../db/schema";
import { readinessFor } from "./analytics";
import { appLink, enqueue, type NewNotification } from "./notifications";
import { quickVisibleTo } from "./practice";
import { descendants, studentIdsInUnits, tenantUnits } from "./scope";

/** Local hour in a time zone, 0-23. */
function localHour(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Students with at least this many skills due for review get a weekly reminder. */
export const REVIEW_NUDGE_MIN_SKILLS = 3;

/**
 * Automatic nudges, meant to run hourly: streaks at risk (evenings only),
 * skills fading (late afternoon, at most weekly), assignments due within a
 * day, and open tests not yet started. Each nudge is sent once thanks to its
 * dedupe key.
 */
export async function runNudges(db: Db, now: Date, opts: { tenantId?: string; ignoreQuietHours?: boolean } = {}) {
  const tenantRows = await db.select().from(tenants).where(opts.tenantId ? eq(tenants.id, opts.tenantId) : undefined);
  const summary = { streak: 0, review: 0, assignment: 0, test: 0 };
  for (const tenant of tenantRows) {
    if (tenant.settings.nudges === false) continue;
    const today = localDate(now, tenant.timeZone);
    const items: NewNotification[] = [];

    // Streaks: between 6 pm and 9 pm, remind students who practised yesterday but not today.
    const hour = localHour(now, tenant.timeZone);
    if (opts.ignoreQuietHours || (hour >= 18 && hour < 21)) {
      const atRisk = await db
        .select({ userId: playerProfiles.userId, days: playerProfiles.streakCurrent })
        .from(playerProfiles)
        .where(and(eq(playerProfiles.tenantId, tenant.id), gt(playerProfiles.streakCurrent, 0), eq(playerProfiles.streakLastDate, addDays(today, -1))));
      for (const p of atRisk) {
        items.push({
          tenantId: tenant.id,
          userId: p.userId,
          template: "streak_at_risk",
          title: `Keep your ${p.days}-day streak`,
          body: "One question today keeps it alive. The daily challenge takes two minutes.",
          link: appLink("/play"),
          dedupeKey: `streak:${p.userId}:${today}`,
        });
      }
    }
    summary.streak += items.length;

    // Fading skills: once a week, between 4 pm and 6 pm, for students with several skills due.
    if (opts.ignoreQuietHours || (hour >= 16 && hour < 18)) {
      const rows = await db
        .select({ userId: skillRatings.userId, skillId: skillRatings.skillId, rating: skillRatings.rating, step: skillRatings.reviewStep, dueOn: skillRatings.reviewDueOn })
        .from(skillRatings)
        .innerJoin(users, eq(users.id, skillRatings.userId))
        .where(and(eq(users.tenantId, tenant.id), eq(users.status, "active"), isNotNull(skillRatings.reviewDueOn), lte(skillRatings.reviewDueOn, today)));
      // As on the home screen: only skills a quick review can cover.
      const quick = new Set((await db.selectDistinct({ skillId: questions.skillId }).from(questions).where(quickVisibleTo(tenant.id))).map((q) => q.skillId));
      const byUser = new Map<string, typeof rows>();
      for (const r of rows.filter((r) => quick.has(r.skillId))) (byUser.get(r.userId) ?? byUser.set(r.userId, []).get(r.userId)!).push(r);
      for (const [userId, list] of byUser) {
        const due = dueForReview(list.map((r) => ({ ...r, mastery: masteryFromRating(r.rating) })), today);
        if (due.length < REVIEW_NUDGE_MIN_SKILLS) continue;
        items.push({
          tenantId: tenant.id,
          userId,
          template: "review_due",
          title: `${due.length} skills are fading`,
          body: "A five-minute review keeps them ready for placement tests.",
          link: appLink("/play"),
          dedupeKey: `review:${userId}:${isoWeekKey(today)}`,
        });
        summary.review++;
      }
    }

    const units = await tenantUnits(db, tenant.id);
    // Assignments closing within 24 hours, for students who have not finished.
    const due = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.tenantId, tenant.id), lte(assignments.openAt, now), gt(assignments.closeAt, now), lte(assignments.closeAt, new Date(now.getTime() + 86_400_000))));
    for (const a of due) {
      const targeted = await studentIdsInUnits(db, tenant.id, descendants(units, a.orgUnitIds));
      const done = new Set(
        (await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.assignmentId, a.id), isNotNull(sessions.finishedAt)))).map((s) => s.userId),
      );
      for (const userId of targeted.filter((u) => !done.has(u))) {
        items.push({ tenantId: tenant.id, userId, template: "assignment_due", title: `Due soon: ${a.title}`, body: "This assignment closes within 24 hours.", link: appLink("/play"), dedupeKey: `assignment:${a.id}:${userId}` });
        summary.assignment++;
      }
    }

    // Open tests not yet started.
    const open = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenant.id), lte(assessments.openAt, now), gt(assessments.closeAt, now)));
    for (const a of open) {
      const targeted = await studentIdsInUnits(db, tenant.id, descendants(units, a.orgUnitIds));
      const started = new Set((await db.select({ userId: assessmentAttempts.userId }).from(assessmentAttempts).where(eq(assessmentAttempts.assessmentId, a.id))).map((s) => s.userId));
      for (const userId of targeted.filter((u) => !started.has(u))) {
        items.push({ tenantId: tenant.id, userId, template: "test_open", title: `Test open: ${a.title}`, body: `${a.durationMinutes} minutes. Start before it closes.`, link: appLink(`/play/tests/${a.id}`), dedupeKey: `test:${a.id}:${userId}` });
        summary.test++;
      }
    }
    await enqueue(db, items);
  }
  return summary;
}

export type Audience = "all" | "inactive_7d" | "at_risk" | "assignment_pending";

/** Students in the given units who match an audience filter. */
export async function audienceIds(db: Db, args: { tenantId: string; unitIds: string[]; audience: Audience; assignmentId?: string; now: Date; today: string }) {
  const units = await tenantUnits(db, args.tenantId);
  const ids = await studentIdsInUnits(db, args.tenantId, descendants(units, args.unitIds));
  if (ids.length === 0 || args.audience === "all") return ids;
  if (args.audience === "inactive_7d") {
    const since = new Date(args.now.getTime() - 7 * 86_400_000);
    const active = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), isNotNull(users.lastActiveAt), sql`${users.lastActiveAt} >= ${since}`));
    const activeSet = new Set(active.map((a) => a.id));
    return ids.filter((id) => !activeSet.has(id));
  }
  if (args.audience === "at_risk") {
    const scores = await readinessFor(db, ids, args.today);
    return ids.filter((id) => (scores.get(id)?.service ?? 0) < 30);
  }
  if (!args.assignmentId) return [];
  const done = new Set(
    (await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.assignmentId, args.assignmentId), isNotNull(sessions.finishedAt)))).map((s) => s.userId),
  );
  return ids.filter((id) => !done.has(id));
}

export async function sendAnnouncement(db: Db, args: { tenantId: string; actorId: string; userIds: string[]; title: string; message: string }) {
  const batch = randomUUID();
  return enqueue(
    db,
    args.userIds.map((userId) => ({
      tenantId: args.tenantId,
      userId,
      template: "announcement" as const,
      title: args.title,
      body: args.message,
      link: appLink("/play"),
      dedupeKey: `announce:${batch}:${userId}`,
      sentBy: args.actorId,
    })),
  );
}
