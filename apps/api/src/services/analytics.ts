import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  computeReadiness,
  currentStreak,
  earnedBadges,
  groupSkillsByTopic,
  levelProgress,
  masteryFromRating,
  READINESS_PROFILES,
  readinessBand,
  type StreakRules,
} from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { memberships, mistakes, orgUnits, packs, playerProfiles, responses, sessions, skillRatings, skills, users } from "../db/schema";
import { sessionScore } from "./practice";
import { streakState } from "./profile";

const DAY_MS = 86_400_000;

export async function allSkills(db: DbOrTx) {
  return db.select().from(skills).orderBy(skills.position);
}

async function ratingsFor(db: DbOrTx, userIds: string[]) {
  if (userIds.length === 0) return [];
  return db.select().from(skillRatings).where(inArray(skillRatings.userId, userIds));
}

/** Readiness per student per profile (0-100). */
export async function readinessFor(db: DbOrTx, userIds: string[], today: string) {
  const [skillRows, ratings] = await Promise.all([allSkills(db), ratingsFor(db, userIds)]);
  const topics = groupSkillsByTopic(skillRows.map((s) => s.id));
  const byUser = new Map<string, typeof ratings>();
  for (const r of ratings) (byUser.get(r.userId) ?? byUser.set(r.userId, []).get(r.userId)!).push(r);
  const out = new Map<string, Record<string, number>>();
  for (const id of userIds) {
    const masteries = (byUser.get(id) ?? []).map((r) => ({ skillId: r.skillId, mastery: masteryFromRating(r.rating), lastPractisedAt: r.lastPractisedAt }));
    out.set(id, Object.fromEntries(READINESS_PROFILES.map((p) => [p.id, computeReadiness(p, masteries, topics, today).score])));
  }
  return out;
}

export async function engagement(db: DbOrTx, args: { studentIds: string[]; timeZone: string; now: Date; today: string; rules: StreakRules }) {
  const { studentIds, now } = args;
  const total = studentIds.length;
  if (total === 0) {
    return { totalStudents: 0, activeLast7Days: 0, weeklyActivePct: 0, answersLast7Days: 0, answersPerActiveStudent: 0, daily: [], streaks: [] };
  }
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since14 = new Date(now.getTime() - 14 * DAY_MS);
  const [week] = await db
    .select({ active: sql<number>`count(distinct ${responses.userId})::int`, answers: sql<number>`count(*)::int` })
    .from(responses)
    .where(and(inArray(responses.userId, studentIds), gte(responses.createdAt, since7)));
  const dayExpr = sql<string>`to_char(${responses.createdAt} at time zone ${args.timeZone}, 'YYYY-MM-DD')`;
  const daily = await db
    .select({ day: dayExpr, activeStudents: sql<number>`count(distinct ${responses.userId})::int`, answers: sql<number>`count(*)::int` })
    .from(responses)
    .where(and(inArray(responses.userId, studentIds), gte(responses.createdAt, since14)))
    // Group by position: the time zone is a bound parameter, so repeating the expression would not match.
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const profiles = await db.select().from(playerProfiles).where(inArray(playerProfiles.userId, studentIds));
  const buckets = [
    { label: "No streak", min: 0, max: 0 },
    { label: "1-2 days", min: 1, max: 2 },
    { label: "3-6 days", min: 3, max: 6 },
    { label: "7-29 days", min: 7, max: 29 },
    { label: "30+ days", min: 30, max: Infinity },
  ].map((b) => ({ ...b, students: 0 }));
  const streakDays = new Map(profiles.map((p) => [p.userId, currentStreak(streakState(p), args.today, args.rules).days]));
  for (const id of studentIds) {
    const d = streakDays.get(id) ?? 0;
    buckets.find((b) => d >= b.min && d <= b.max)!.students++;
  }
  const active = week?.active ?? 0;
  return {
    totalStudents: total,
    activeLast7Days: active,
    weeklyActivePct: Math.round((active / total) * 100),
    answersLast7Days: week?.answers ?? 0,
    answersPerActiveStudent: active ? Math.round((week!.answers / active) * 10) / 10 : 0,
    daily,
    streaks: buckets.map(({ label, students }) => ({ label, students })),
  };
}

export async function skillsReport(db: DbOrTx, studentIds: string[]) {
  const [skillRows, ratings] = await Promise.all([allSkills(db), ratingsFor(db, studentIds)]);
  const total = studentIds.length;
  const report = skillRows.map((s) => {
    const rs = ratings.filter((r) => r.skillId === s.id);
    const masteries = rs.map((r) => masteryFromRating(r.rating));
    const sum = masteries.reduce((a, b) => a + b, 0);
    return {
      skillId: s.id,
      name: s.name,
      topic: s.topic,
      topicName: s.topicName,
      attemptedPct: total ? Math.round((rs.length / total) * 100) : 0,
      // Students who never practised a skill count as 0 mastery.
      avgMastery: total ? Math.round(sum / total) : 0,
      avgMasteryOfAttempted: rs.length ? Math.round(sum / rs.length) : null,
      accuracyPct: rs.length ? Math.round((rs.reduce((a, r) => a + r.correct, 0) / Math.max(1, rs.reduce((a, r) => a + r.attempts, 0))) * 100) : null,
    };
  });
  const weakest = [...report].sort((a, b) => a.avgMastery - b.avgMastery).slice(0, 5);
  return { skills: report, weakest };
}

export async function readinessReport(db: DbOrTx, studentIds: string[], today: string) {
  const scores = await readinessFor(db, studentIds, today);
  const people = studentIds.length
    ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, studentIds))
    : [];
  const profiles = READINESS_PROFILES.map((p) => {
    const bands = { ready: 0, almost: 0, building: 0, at_risk: 0 };
    let sum = 0;
    for (const id of studentIds) {
      const score = scores.get(id)?.[p.id] ?? 0;
      bands[readinessBand(score)]++;
      sum += score;
    }
    return { id: p.id, name: p.name, average: studentIds.length ? Math.round(sum / studentIds.length) : 0, bands };
  });
  const atRisk = people
    .map((u) => ({ ...u, service: scores.get(u.id)?.service ?? 0, product: scores.get(u.id)?.product ?? 0 }))
    .filter((u) => readinessBand(u.service) === "at_risk")
    .sort((a, b) => a.service - b.service)
    .slice(0, 25);
  return { profiles, atRisk };
}

export async function studentList(db: DbOrTx, args: { tenantId: string; studentIds: string[]; today: string; now: Date; rules: StreakRules }) {
  if (args.studentIds.length === 0) return [];
  const since7 = new Date(args.now.getTime() - 7 * DAY_MS);
  const [rows, units, answers7, readiness] = await Promise.all([
    db
      .select({ user: users, profile: playerProfiles })
      .from(users)
      .leftJoin(playerProfiles, eq(playerProfiles.userId, users.id))
      .where(inArray(users.id, args.studentIds)),
    db
      .select({ userId: memberships.userId, unitName: orgUnits.name, unitId: orgUnits.id })
      .from(memberships)
      .innerJoin(orgUnits, eq(orgUnits.id, memberships.orgUnitId))
      .where(and(inArray(memberships.userId, args.studentIds), eq(memberships.role, "student"))),
    db
      .select({ userId: responses.userId, count: sql<number>`count(*)::int` })
      .from(responses)
      .where(and(inArray(responses.userId, args.studentIds), gte(responses.createdAt, since7)))
      .groupBy(responses.userId),
    readinessFor(db, args.studentIds, args.today),
  ]);
  const unitByUser = new Map(units.map((u) => [u.userId, u]));
  const answersByUser = new Map(answers7.map((a) => [a.userId, a.count]));
  return rows
    .map(({ user, profile }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      rollNo: user.rollNo,
      unitId: unitByUser.get(user.id)?.unitId ?? null,
      unitName: unitByUser.get(user.id)?.unitName ?? null,
      xp: profile?.xp ?? 0,
      level: levelProgress(profile?.xp ?? 0).level,
      streak: profile ? currentStreak(streakState(profile), args.today, args.rules).days : 0,
      division: profile?.division ?? "bronze",
      answersLast7Days: answersByUser.get(user.id) ?? 0,
      lastActiveAt: user.lastActiveAt,
      readiness: readiness.get(user.id) ?? {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything about one student, for the student 360 view and their own profile page. */
export async function studentDetail(db: DbOrTx, args: { userId: string; today: string; rules: StreakRules }) {
  const [user] = await db.select().from(users).where(eq(users.id, args.userId));
  if (!user) return null;
  const [profile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, args.userId));
  const [skillRows, ratings, readiness, recent, openMistakes, missionSessions, perfect] = await Promise.all([
    allSkills(db),
    ratingsFor(db, [args.userId]),
    readinessFor(db, [args.userId], args.today),
    db.select().from(sessions).where(eq(sessions.userId, args.userId)).orderBy(desc(sessions.startedAt)).limit(10),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(mistakes)
      .where(and(eq(mistakes.userId, args.userId), isNull(mistakes.resolvedAt))),
    db
      .select({ s: sessions, passMark: packs.passMark })
      .from(sessions)
      .innerJoin(packs, eq(packs.id, sessions.packId))
      .where(and(eq(sessions.userId, args.userId), eq(sessions.kind, "pack"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(eq(sessions.userId, args.userId), sql`${sessions.finishedAt} is not null`, sql`${sessions.correctCount} = jsonb_array_length(${sessions.questionIds})`)),
  ]);
  const [{ correct } = { correct: 0 }] = await db
    .select({ correct: sql<number>`count(*)::int` })
    .from(responses)
    .where(and(eq(responses.userId, args.userId), eq(responses.correct, true)));
  const ratingBySkill = new Map(ratings.map((r) => [r.skillId, r]));
  const skillMastery = skillRows.map((s) => {
    const r = ratingBySkill.get(s.id);
    return {
      skillId: s.id,
      name: s.name,
      topic: s.topic,
      topicName: s.topicName,
      mastery: r ? masteryFromRating(r.rating) : 0,
      attempts: r?.attempts ?? 0,
      accuracyPct: r && r.attempts ? Math.round((r.correct / r.attempts) * 100) : null,
      lastPractisedAt: r?.lastPractisedAt ?? null,
    };
  });
  const xp = profile?.xp ?? 0;
  const missionsPassed = new Set(
    missionSessions.filter(({ s, passMark }) => s.finishedAt && sessionScore(s) >= passMark).map(({ s }) => s.packId),
  ).size;
  const badges = earnedBadges({
    correctAnswers: correct,
    longestStreak: profile?.streakLongest ?? 0,
    level: levelProgress(xp).level,
    masteredSkills: skillMastery.filter((s) => s.mastery >= 80).length,
    missionsPassed,
    perfectSessions: perfect[0]?.count ?? 0,
  }).map(({ code, name, description, kind }) => ({ code, name, description, kind }));
  return {
    user: { id: user.id, name: user.name, email: user.email, rollNo: user.rollNo, lastActiveAt: user.lastActiveAt },
    xp,
    ...levelProgress(xp),
    streak: profile ? currentStreak(streakState(profile), args.today, args.rules).days : 0,
    longestStreak: profile?.streakLongest ?? 0,
    division: profile?.division ?? "bronze",
    correctAnswers: correct,
    openMistakes: openMistakes[0]?.count ?? 0,
    readiness: READINESS_PROFILES.map((p) => ({ id: p.id, name: p.name, score: readiness.get(args.userId)?.[p.id] ?? 0 })),
    skills: skillMastery,
    badges,
    recentSessions: recent.map((s) => ({
      id: s.id,
      kind: s.kind,
      startedAt: s.startedAt,
      finished: Boolean(s.finishedAt),
      correctCount: s.correctCount,
      total: s.questionIds.length,
      xpEarned: s.xpEarned,
    })),
  };
}
