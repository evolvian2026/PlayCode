import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { assignments, insightReports, orgUnits, responses, sessions } from "../db/schema";
import { aiProvider, AiUnavailableError, type InsightFacts } from "../lib/ai";
import { HttpError } from "../lib/errors";
import { engagement, readinessReport, skillsReport } from "./analytics";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";
import { descendants, studentIdsInUnits, tenantUnits } from "./scope";
import { getTenant, streakRules, tenantToday } from "./tenant";
import { forStudents } from "./assignments";

// Weekly insights: a short AI-written briefing for staff from the same
// aggregates the overview shows (activity, readiness bands, weakest skills,
// assignment completion). Only aggregates and skill and assignment names go
// to the model, never a student's name or record. One briefing per scope per
// day, cached, to keep AI cost predictable.

const DAY_MS = 86_400_000;

export interface InsightScope {
  tenantId: string;
  /** "all", a unit id, or "user:<id>" for someone whose scope is their own units. */
  key: string;
  label: string;
  unitIds: string[];
  studentIds: string[];
}

/** The week's aggregates for a scope. */
export async function insightFacts(db: Db, scope: InsightScope, now: Date): Promise<InsightFacts> {
  const tenant = await getTenant(db, scope.tenantId);
  const today = tenantToday(tenant, now);
  const ids = scope.studentIds;
  const [eng, readiness, skills] = await Promise.all([
    engagement(db, { studentIds: ids, timeZone: tenant.timeZone, now, today, rules: streakRules(tenant) }),
    readinessReport(db, ids, today),
    skillsReport(db, ids),
  ]);
  const [last] = ids.length
    ? await db
        .select({ active: sql<number>`count(distinct ${responses.userId})::int`, answers: sql<number>`count(*)::int` })
        .from(responses)
        .where(and(inArray(responses.userId, ids), gte(responses.createdAt, new Date(now.getTime() - 14 * DAY_MS)), lte(responses.createdAt, new Date(now.getTime() - 7 * DAY_MS))))
    : [];
  // Assignments for these units that are open now or closed in the last week.
  const units = await tenantUnits(db, scope.tenantId);
  const inScope = new Set(scope.unitIds);
  const recent = (
    await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.tenantId, scope.tenantId), lte(assignments.openAt, now), gte(assignments.closeAt, new Date(now.getTime() - 7 * DAY_MS))))
  ).filter((a) => descendants(units, a.orgUnitIds).some((u) => inScope.has(u)));
  const assignmentFacts = [];
  for (const a of recent.slice(0, 8)) {
    const targeted = new Set(forStudents(a, await studentIdsInUnits(db, scope.tenantId, descendants(units, a.orgUnitIds))));
    const mine = ids.filter((id) => targeted.has(id));
    const done = mine.length
      ? (await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.assignmentId, a.id), isNotNull(sessions.finishedAt), inArray(sessions.userId, mine)))).length
      : 0;
    assignmentFacts.push({ title: a.title, closes: a.closeAt.toISOString().slice(0, 10), completedPct: mine.length ? Math.round((done / mine.length) * 100) : 0 });
  }
  return {
    scope: scope.label,
    students: ids.length,
    activeThisWeekPct: eng.weeklyActivePct,
    activeLastWeekPct: ids.length ? Math.round(((last?.active ?? 0) / ids.length) * 100) : 0,
    answersThisWeek: eng.answersLast7Days,
    answersLastWeek: last?.answers ?? 0,
    atRisk: readiness.atRisk.length,
    readiness: readiness.profiles.map((p) => ({ profile: p.name, average: p.average, ready: p.bands.ready, almost: p.bands.almost, building: p.bands.building, atRisk: p.bands.at_risk })),
    weakestSkills: skills.weakest.slice(0, 5).map((s) => ({ name: `${s.topicName}: ${s.name}`, avgMastery: s.avgMastery, attemptedPct: s.attemptedPct })),
    assignments: assignmentFacts,
    streaks: eng.streaks,
  };
}

/** Today's briefing for a scope, if one was written. */
export async function cachedInsights(db: Db, scope: InsightScope, now: Date) {
  const tenant = await getTenant(db, scope.tenantId);
  const [row] = await db
    .select()
    .from(insightReports)
    .where(and(eq(insightReports.tenantId, scope.tenantId), eq(insightReports.scopeKey, scope.key), eq(insightReports.day, tenantToday(tenant, now))));
  const allowed = aiProvider() ? await aiAllowed(db, scope.tenantId, "ai_insights", now) : { ok: false as const, reason: "AI is not switched on." };
  return { available: allowed.ok, reason: allowed.ok ? null : allowed.reason, report: row?.report ?? null, generatedAt: row?.createdAt ?? null, scope: scope.label };
}

/** Write today's briefing (or return it if it already exists). */
export async function generateInsights(db: Db, scope: InsightScope, actorId: string, now: Date) {
  const existing = await cachedInsights(db, scope, now);
  if (existing.report) return existing;
  if (!existing.available) throw new HttpError(400, "insights_unavailable", existing.reason ?? "Weekly insights are not available");
  if (scope.studentIds.length === 0) throw new HttpError(400, "no_students", "There are no students in this scope yet");
  const facts = await insightFacts(db, scope, now);
  let res;
  try {
    res = await aiProvider()!.weeklyInsights(facts);
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(502, "insights_unavailable", err.message);
    throw new HttpError(503, "insights_unavailable", "Couldn't write the insights right now. Try again in a minute.");
  }
  await recordAiUsage(db, { tenantId: scope.tenantId, userId: actorId, feature: "weekly_insights", usage: res.usage, now });
  const report = { headline: res.value.headline, points: res.value.points.slice(0, 5), actions: res.value.actions.slice(0, 3) };
  const tenant = await getTenant(db, scope.tenantId);
  await db
    .insert(insightReports)
    .values({ tenantId: scope.tenantId, scopeKey: scope.key, day: tenantToday(tenant, now), report, createdBy: actorId, createdAt: now })
    .onConflictDoNothing();
  return cachedInsights(db, scope, now);
}

/** A readable name for a scope. */
export async function scopeLabel(db: Db, tenantId: string, unitId: string | undefined, institutionWide: boolean) {
  if (unitId) {
    const [u] = await db.select({ name: orgUnits.name }).from(orgUnits).where(and(eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId)));
    return u?.name ?? "this group";
  }
  return institutionWide ? "the whole institution" : "your batches and sections";
}
