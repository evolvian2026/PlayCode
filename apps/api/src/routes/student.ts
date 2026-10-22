import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isoWeekKey, masteryFromRating, QUESTION_TYPES } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { assignments, mistakes, packs, questions, sessions, skillRatings, skills } from "../db/schema";
import { notFound } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { studentDetail } from "../services/analytics";
import { leagueStandings } from "../services/leagues";
import { answerQuestion, getSession, sessionScore, startSession, takeHint, visibleTo, type StudentCtx } from "../services/practice";
import { getOrCreateProfile, profileSummary } from "../services/profile";
import { studentUnitIdsWithAncestors } from "../services/scope";
import { getTenant, streakRules, tenantToday } from "../services/tenant";

const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("option"), optionId: z.string().max(20) }),
  z.object({ kind: z.literal("text"), value: z.string().max(500) }),
  z.object({ kind: z.literal("lines"), lines: z.array(z.number().int().min(1)).max(50) }),
  z.object({ kind: z.literal("order"), ids: z.array(z.string().max(20)).max(50) }),
]);

const startSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skill"), skillId: z.string() }),
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("pack"), packId: z.string() }),
  z.object({ kind: z.literal("assignment"), assignmentId: z.string().uuid() }),
  z.object({ kind: z.literal("mistakes") }),
]);

async function studentAssignments(ctx: StudentCtx) {
  const myUnits = await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId);
  if (myUnits.length === 0) return [];
  const recent = new Date(ctx.now.getTime() - 14 * 86_400_000);
  const unitSet = new Set(myUnits);
  const rows = (
    await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.tenantId, ctx.tenantId), lte(assignments.openAt, ctx.now), gte(assignments.closeAt, recent)))
      .orderBy(assignments.closeAt)
  ).filter((a) => a.orgUnitIds.some((id) => unitSet.has(id)));
  const mine = rows.length
    ? await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, ctx.userId), inArray(sessions.assignmentId, rows.map((r) => r.id))))
    : [];
  const byAssignment = new Map(mine.map((s) => [s.assignmentId, s]));
  return rows.map((a) => {
    const s = byAssignment.get(a.id);
    return {
      id: a.id,
      title: a.title,
      questionCount: a.questionIds.length,
      openAt: a.openAt,
      closeAt: a.closeAt,
      open: ctx.now <= a.closeAt,
      status: !s ? "not_started" : s.finishedAt ? "completed" : "in_progress",
      score: s?.finishedAt ? sessionScore(s) : null,
    };
  });
}

export async function studentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));

  const ctxOf = (req: { auth: { userId: string } } & Parameters<typeof tenantOf>[0]): StudentCtx => ({
    userId: req.auth.userId,
    tenantId: tenantOf(req),
    now: app.now(),
  });

  app.get("/home", async (req) => {
    const ctx = ctxOf(req);
    const tenant = await getTenant(db, ctx.tenantId);
    const today = tenantToday(tenant, ctx.now);
    const rules = streakRules(tenant);
    const profile = await getOrCreateProfile(db, ctx.userId, ctx.tenantId);
    const [daily] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, ctx.userId), eq(sessions.kind, "daily"), eq(sessions.day, today)));
    const league = await leagueStandings(db, { tenantId: ctx.tenantId, userId: ctx.userId, weekKey: isoWeekKey(today), division: profile.division });
    const me = league.members.find((m) => m.isMe);
    const [{ count: openMistakes } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mistakes)
      .where(and(eq(mistakes.userId, ctx.userId), isNull(mistakes.resolvedAt)));
    // Suggest the weakest skill the student has started, else the first untouched one.
    const [skillRows, ratings] = await Promise.all([
      db.select().from(skills).orderBy(skills.position),
      db.select().from(skillRatings).where(eq(skillRatings.userId, ctx.userId)),
    ]);
    const rated = new Map(ratings.map((r) => [r.skillId, r]));
    const untouched = skillRows.find((s) => !rated.has(s.id));
    const weakest = [...ratings].sort((a, b) => a.rating - b.rating)[0];
    const suggestedId = weakest && masteryFromRating(weakest.rating) < 50 ? weakest.skillId : (untouched?.id ?? weakest?.skillId);
    const suggested = skillRows.find((s) => s.id === suggestedId) ?? null;
    return {
      tenant: { name: tenant.name },
      today,
      profile: profileSummary(profile, today, ctx.now, rules),
      daily: daily
        ? { started: true, sessionId: daily.id, finished: Boolean(daily.finishedAt), correctCount: daily.correctCount, total: daily.questionIds.length }
        : { started: false, sessionId: null, finished: false, correctCount: 0, total: 5 },
      assignments: (await studentAssignments(ctx)).filter((a) => a.open && a.status !== "completed"),
      league: { division: league.division, rank: me?.rank ?? null, groupSize: league.members.length, weeklyXp: me?.weeklyXp ?? 0, zone: me?.zone ?? null },
      openMistakes,
      suggestedSkill: suggested ? { id: suggested.id, name: suggested.name, topicName: suggested.topicName } : null,
    };
  });

  app.get("/map", async (req) => {
    const ctx = ctxOf(req);
    const [skillRows, ratings, counts] = await Promise.all([
      db.select().from(skills).orderBy(skills.position),
      db.select().from(skillRatings).where(eq(skillRatings.userId, ctx.userId)),
      db
        .select({ skillId: questions.skillId, count: sql<number>`count(*)::int` })
        .from(questions)
        .where(visibleTo(ctx.tenantId))
        .groupBy(questions.skillId),
    ]);
    const rated = new Map(ratings.map((r) => [r.skillId, r]));
    const countBySkill = new Map(counts.map((c) => [c.skillId, c.count]));
    const topics: { topic: string; name: string; mastery: number; skills: unknown[] }[] = [];
    for (const s of skillRows) {
      let topic = topics.find((t) => t.topic === s.topic);
      if (!topic) topics.push((topic = { topic: s.topic, name: s.topicName, mastery: 0, skills: [] }));
      const r = rated.get(s.id);
      topic.skills.push({
        id: s.id,
        name: s.name,
        mastery: r ? masteryFromRating(r.rating) : 0,
        attempts: r?.attempts ?? 0,
        questionCount: countBySkill.get(s.id) ?? 0,
      });
    }
    for (const t of topics) {
      const ms = t.skills as { mastery: number }[];
      t.mastery = Math.round(ms.reduce((a, s) => a + s.mastery, 0) / ms.length);
    }
    return { topics, questionTypes: QUESTION_TYPES };
  });

  app.post("/sessions", async (req) => startSession(db, ctxOf(req), parse(startSchema, req.body)));

  app.get("/sessions/:id", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return getSession(db, ctxOf(req), id);
  });

  app.post("/sessions/:id/answer", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ questionId: z.string(), response: responseSchema, timeMs: z.number().min(0).max(3_600_000) }), req.body);
    return answerQuestion(db, ctxOf(req), id, body);
  });

  app.post("/sessions/:id/hint", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ questionId: z.string() }), req.body);
    return takeHint(db, ctxOf(req), id, body.questionId);
  });

  app.get("/mistakes", async (req) => {
    const ctx = ctxOf(req);
    const rows = await db
      .select({ questionId: mistakes.questionId, wrongCount: mistakes.wrongCount, lastWrongAt: mistakes.lastWrongAt, q: questions })
      .from(mistakes)
      .innerJoin(questions, eq(questions.id, mistakes.questionId))
      .where(and(eq(mistakes.userId, ctx.userId), isNull(mistakes.resolvedAt)))
      .orderBy(desc(mistakes.lastWrongAt));
    return {
      mistakes: rows.map((r) => ({
        questionId: r.questionId,
        wrongCount: r.wrongCount,
        lastWrongAt: r.lastWrongAt,
        stem: r.q.body.stem,
        type: r.q.type,
        skillId: r.q.skillId,
        language: r.q.language,
      })),
    };
  });

  app.get("/league", async (req) => {
    const ctx = ctxOf(req);
    const tenant = await getTenant(db, ctx.tenantId);
    const profile = await getOrCreateProfile(db, ctx.userId, ctx.tenantId);
    return leagueStandings(db, { tenantId: ctx.tenantId, userId: ctx.userId, weekKey: isoWeekKey(tenantToday(tenant, ctx.now)), division: profile.division });
  });

  app.get("/missions", async (req) => {
    const ctx = ctxOf(req);
    const rows = await db
      .select()
      .from(packs)
      .where(and(eq(packs.kind, "mission"), or(isNull(packs.tenantId), eq(packs.tenantId, ctx.tenantId))))
      .orderBy(packs.position);
    const attempts = rows.length
      ? await db
          .select()
          .from(sessions)
          .where(and(eq(sessions.userId, ctx.userId), eq(sessions.kind, "pack"), inArray(sessions.packId, rows.map((r) => r.id))))
      : [];
    return {
      missions: rows.map((p) => {
        const mine = attempts.filter((s) => s.packId === p.id);
        const finished = mine.filter((s) => s.finishedAt);
        const best = finished.length ? Math.max(...finished.map(sessionScore)) : null;
        const inProgress = mine.find((s) => !s.finishedAt);
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          questionCount: p.questionIds.length,
          passMark: p.passMark,
          profile: p.profile,
          bestScore: best,
          passed: best !== null && best >= p.passMark,
          attempts: finished.length,
          inProgressSessionId: inProgress?.id ?? null,
        };
      }),
    };
  });

  app.get("/assignments", async (req) => ({ assignments: await studentAssignments(ctxOf(req)) }));

  app.get("/profile", async (req) => {
    const ctx = ctxOf(req);
    const tenant = await getTenant(db, ctx.tenantId);
    const detail = await studentDetail(db, { userId: ctx.userId, today: tenantToday(tenant, ctx.now), rules: streakRules(tenant) });
    if (!detail) throw notFound("Profile");
    return detail;
  });
}
