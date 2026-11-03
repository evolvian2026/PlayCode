import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { buildStudyPlan, masteryFromRating, PLAN_DAILY_ANSWERS, planDayStatus, type PlanDay } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { packs, placementDrives, questions, responses, sessions, skillRatings, skills, studyPlans } from "../db/schema";
import { badRequest, notFound } from "../lib/errors";
import { visibleTo } from "./practice";
import { getTenant, tenantToday } from "./tenant";

// A student's study plan to a target: built from their readiness gaps for
// the kind of company they're aiming at (see buildStudyPlan in core), and
// ticked off from real practice: a skill day is done after a finished practice
// session on that skill that day (or enough answers on it), a review day after
// a finished review, a mock day after a finished mission.

type Ctx = { tenantId: string; userId: string; now: Date };
type Profile = "service" | "product";

export async function createStudyPlan(db: Db, ctx: Ctx, input: { driveId?: string | null; targetDate?: string; profile?: Profile }) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  let target: { label: string; date: string; profile: Profile; driveId: string | null };
  if (input.driveId) {
    const [drive] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, input.driveId), eq(placementDrives.tenantId, ctx.tenantId)));
    if (!drive) throw notFound("Drive");
    target = { label: `${drive.company} drive`, date: drive.driveDate, profile: drive.companyType === "product" ? "product" : "service", driveId: drive.id };
  } else {
    if (!input.targetDate || !input.profile) throw badRequest("Choose a drive, or a date and a kind of company");
    target = { label: input.profile === "product" ? "Product company tests" : "Service company tests", date: input.targetDate, profile: input.profile, driveId: null };
  }
  if (target.date <= today) throw badRequest("Pick a date after today");

  const [skillRows, ratings, counts, missions] = await Promise.all([
    db.select({ id: skills.id }).from(skills),
    db.select().from(skillRatings).where(eq(skillRatings.userId, ctx.userId)),
    db.select({ skillId: questions.skillId, n: sql<number>`count(*)::int` }).from(questions).where(visibleTo(ctx.tenantId)).groupBy(questions.skillId),
    db
      .select({ id: packs.id })
      .from(packs)
      .where(and(eq(packs.kind, "mission"), eq(packs.profile, target.profile), or(isNull(packs.tenantId), eq(packs.tenantId, ctx.tenantId))))
      .orderBy(packs.position),
  ]);
  const rated = new Map(ratings.map((r) => [r.skillId, r]));
  const days = buildStudyPlan({
    skills: skillRows.map((s) => ({ id: s.id, mastery: rated.get(s.id) ? masteryFromRating(rated.get(s.id)!.rating) : 0, practisable: (counts.find((c) => c.skillId === s.id)?.n ?? 0) > 0 })),
    profileId: target.profile,
    today,
    targetDate: target.date,
    missionPackId: missions[0]?.id ?? null,
  });
  await db
    .insert(studyPlans)
    .values({ userId: ctx.userId, tenantId: ctx.tenantId, target, days, createdAt: ctx.now })
    .onConflictDoUpdate({ target: studyPlans.userId, set: { target, days, createdAt: ctx.now } });
  return getStudyPlan(db, ctx);
}

/** Which plan days are done, from practice on each day (in the institution's time zone). */
async function doneDays(db: DbOrTx, ctx: Ctx, days: PlanDay[], timeZone: string): Promise<Set<string>> {
  if (days.length === 0) return new Set();
  const from = new Date(`${days[0]!.date}T00:00:00Z`).getTime() - 86_400_000; // a day of slack for time zones
  const localDay = (col: unknown) => sql<string>`to_char(${col} at time zone ${timeZone}, 'YYYY-MM-DD')`;
  const [answers, finished] = await Promise.all([
    db
      .select({ day: localDay(responses.createdAt), skillId: questions.skillId, n: sql<number>`count(*)::int` })
      .from(responses)
      .innerJoin(questions, eq(questions.id, responses.questionId))
      .where(and(eq(responses.userId, ctx.userId), gte(responses.createdAt, new Date(from))))
      .groupBy(sql`1`, questions.skillId),
    db
      .select({ day: localDay(sessions.finishedAt), kind: sessions.kind, packId: sessions.packId, skillId: sessions.skillId })
      .from(sessions)
      .where(and(eq(sessions.userId, ctx.userId), isNotNull(sessions.finishedAt), gte(sessions.finishedAt, new Date(from)), inArray(sessions.kind, ["skill", "review", "pack"]))),
  ]);
  const done = new Set<string>();
  for (const d of days) {
    const ok =
      d.kind === "skill"
        ? finished.some((f) => f.day === d.date && f.kind === "skill" && f.skillId === d.skillId) || (answers.find((a) => a.day === d.date && a.skillId === d.skillId)?.n ?? 0) >= PLAN_DAILY_ANSWERS
        : d.kind === "review"
          ? finished.some((f) => f.day === d.date && f.kind === "review")
          : finished.some((f) => f.day === d.date && f.kind === "pack" && (!d.packId || f.packId === d.packId));
    if (ok) done.add(d.date);
  }
  return done;
}

export async function getStudyPlan(db: Db, ctx: Ctx) {
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.userId, ctx.userId));
  if (!plan) return { plan: null };
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const done = await doneDays(db, ctx, plan.days, tenant.timeZone);
  const names = new Map((await db.select({ id: skills.id, name: skills.name, topicName: skills.topicName }).from(skills)).map((s) => [s.id, `${s.topicName}: ${s.name}`]));
  const packNames = new Map((await db.select({ id: packs.id, title: packs.title }).from(packs)).map((p) => [p.id, p.title]));
  const days = plan.days.map((d) => ({
    ...d,
    title: d.kind === "skill" ? names.get(d.skillId) ?? d.skillId : d.kind === "review" ? "Review fading skills" : d.packId ? `Mock round: ${packNames.get(d.packId) ?? d.packId}` : "Mock round",
    status: planDayStatus(d, done.has(d.date), today),
  }));
  const past = days.filter((d) => d.date <= today);
  return {
    plan: {
      target: plan.target,
      daysLeft: Math.max(0, days.filter((d) => d.date >= today).length),
      today: days.find((d) => d.date === today) ?? null,
      doneSoFar: past.filter((d) => d.status === "done").length,
      dueSoFar: past.length,
      days,
    },
  };
}

export async function deleteStudyPlan(db: Db, ctx: Ctx) {
  await db.delete(studyPlans).where(eq(studyPlans.userId, ctx.userId));
  return { plan: null };
}
