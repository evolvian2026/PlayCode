import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { hasInstitutionScope, QUESTION_TYPES } from "@playcode/core";
import { rateLimit } from "../lib/rate-limit";
import { z } from "zod";
import { db } from "../db/client";
import { assignments, memberships, orgUnits, packs, questions, sessions, skills, tenants, users } from "../db/schema";
import { aiProvider } from "../lib/ai";
import { audit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { institutionBenchmark } from "../services/benchmarks";
import { cachedInsights, generateInsights, scopeLabel } from "../services/insights";
import { engagement, readinessReport, skillsReport, studentDetail, studentList } from "../services/analytics";
import { createAssignment, createRemedialAssignment, forStudents, remedialProgress, weakStudents } from "../services/assignments";
import { effectiveBranding, updateBranding } from "../services/branding";
import { DEFAULT_PASS_MARK, sessionScore, visibleTo } from "../services/practice";
import { getConnection, PRESET_ISSUERS, redirectUri, saveConnection } from "../services/sso";
import { importStudents } from "../services/students";
import { DEFAULT_SNAPSHOT_DAYS, RETENTION } from "../services/retention";
import { renderResumePdf, resumeData } from "../services/resume";
import { gdForStaff, gdsFor } from "../services/gd";
import { writingFor, writingForStaff } from "../services/writing";
import { interviewForStaff, interviewsFor } from "../services/interviews";
import { assertUnitsInScope, descendants, scopedUnitIds, studentIdsInUnits, tenantUnits } from "../services/scope";
import { getTenant, streakRules, tenantToday } from "../services/tenant";
import { requireFeature } from "../services/plan";

const anyAnalytics = requireAny("analytics.institution", "analytics.department", "analytics.own_units");

/** Units (and their students) a request covers: the whole scope, or one unit and everything below it. */
async function resolveScope(req: FastifyRequest, unitId?: string) {
  const tenantId = tenantOf(req);
  const scoped = await scopedUnitIds(db, req.auth);
  let unitIds = scoped;
  if (unitId) {
    if (!scoped.includes(unitId)) throw forbidden("That batch or section is outside your scope");
    unitIds = descendants(await tenantUnits(db, tenantId), [unitId]);
  }
  const studentIds = await studentIdsInUnits(db, tenantId, unitIds);
  return { tenantId, unitIds, studentIds };
}

const unitQuery = z.object({ unitId: z.string().uuid().optional() });

/** Accepts "name,email,roll_no[,phone]" lines; a header row is skipped. */
export function parseStudentCsv(csv: string): { name: string; email: string; rollNo: string | null; phone: string | null }[] {
  const rows: { name: string; email: string; rollNo: string | null; phone: string | null }[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [name = "", email = "", rollNo = "", phone = ""] = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (/^name$/i.test(name) && /^e-?mail$/i.test(email)) continue;
    const digits = phone.replace(/[^\d+]/g, "");
    rows.push({ name, email: email.toLowerCase(), rollNo: rollNo || null, phone: digits.length >= 10 ? digits : null });
  }
  return rows;
}

export async function consoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ---------- Overview ----------
  app.get("/benchmarks", { preHandler: requirePermission("analytics.institution") }, async (req) => institutionBenchmark(db, tenantOf(req)));

  app.get("/overview", { preHandler: anyAnalytics }, async (req) => {
    const scope = await resolveScope(req);
    const tenant = await getTenant(db, scope.tenantId);
    const now = app.now();
    const today = tenantToday(tenant, now);
    const [eng, readiness, recentAssignments] = await Promise.all([
      engagement(db, { studentIds: scope.studentIds, timeZone: tenant.timeZone, now, today, rules: streakRules(tenant) }),
      readinessReport(db, scope.studentIds, today),
      db.select().from(assignments).where(eq(assignments.tenantId, scope.tenantId)).orderBy(desc(assignments.createdAt)).limit(5),
    ]);
    return {
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, seats: tenant.seats },
      units: scope.unitIds.length,
      engagement: eng,
      readiness: readiness.profiles,
      atRiskCount: readiness.atRisk.length,
      recentAssignments: recentAssignments.map((a) => ({ id: a.id, title: a.title, closeAt: a.closeAt })),
    };
  });

  // ---------- Org units ----------
  app.get("/org-units", async (req) => {
    const tenantId = tenantOf(req);
    const scoped = new Set(await scopedUnitIds(db, req.auth));
    const units = (await tenantUnits(db, tenantId)).filter((u) => scoped.has(u.id));
    const counts = units.length
      ? await db
          .select({ unitId: memberships.orgUnitId, count: sql<number>`count(*)::int` })
          .from(memberships)
          .where(and(eq(memberships.role, "student"), inArray(memberships.orgUnitId, units.map((u) => u.id))))
          .groupBy(memberships.orgUnitId)
      : [];
    const countByUnit = new Map(counts.map((c) => [c.unitId, c.count]));
    return {
      units: units
        .map((u) => ({ id: u.id, name: u.name, kind: u.kind, parentId: u.parentId, students: countByUnit.get(u.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  app.post("/org-units", { preHandler: requirePermission("users.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ name: z.string().min(1).max(100), kind: z.enum(["department", "batch", "section"]), parentId: z.string().uuid().nullable().optional() }),
      req.body,
    );
    if (body.parentId) await assertUnitsInScope(db, req.auth, [body.parentId]);
    const [unit] = await db.insert(orgUnits).values({ tenantId, name: body.name, kind: body.kind, parentId: body.parentId ?? null }).returning();
    await audit(db, { tenantId, actorId: req.auth.userId, action: "org_unit.create", target: unit!.id, data: { name: body.name } });
    return { unit };
  });

  // ---------- Students ----------
  app.get("/students", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    const scope = await resolveScope(req, unitId);
    const tenant = await getTenant(db, scope.tenantId);
    const now = app.now();
    return {
      students: await studentList(db, { tenantId: scope.tenantId, studentIds: scope.studentIds, today: tenantToday(tenant, now), now, rules: streakRules(tenant) }),
    };
  });

  app.get("/students/:id", { preHandler: anyAnalytics }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const scope = await resolveScope(req);
    if (!scope.studentIds.includes(id)) throw notFound("Student");
    const tenant = await getTenant(db, scope.tenantId);
    return studentDetail(db, { userId: id, today: tenantToday(tenant, app.now()), rules: streakRules(tenant) });
  });

  // ---------- Mock interviews ----------
  app.get("/interviews", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    return interviewsFor(db, (await resolveScope(req, unitId)).studentIds);
  });

  app.get("/interviews/:id", { preHandler: anyAnalytics }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const interview = await interviewForStaff(db, tenantOf(req), id);
    if (!(await resolveScope(req)).studentIds.includes(interview.userId)) throw notFound("Interview");
    return interview;
  });

  // ---------- Group discussions ----------
  app.get("/gd", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    return gdsFor(db, (await resolveScope(req, unitId)).studentIds);
  });

  app.get("/gd/:id", { preHandler: anyAnalytics }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const gd = await gdForStaff(db, tenantOf(req), id);
    if (!(await resolveScope(req)).studentIds.includes(gd.userId)) throw notFound("Group discussion");
    return gd;
  });

  // ---------- Written English ----------
  app.get("/writing", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    return writingFor(db, (await resolveScope(req, unitId)).studentIds);
  });

  app.get("/writing/:id", { preHandler: anyAnalytics }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const attempt = await writingForStaff(db, tenantOf(req), id);
    if (!(await resolveScope(req)).studentIds.includes(attempt.userId)) throw notFound("Answer");
    return attempt;
  });

  // A student's resume, for the placement cell sending CVs to companies.
  app.get("/students/:id/resume.pdf", { preHandler: anyAnalytics }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    if (!(await resolveScope(req)).studentIds.includes(id)) throw notFound("Student");
    return reply.header("content-type", "application/pdf").send(await renderResumePdf(await resumeData(db, id, app.now())));
  });

  app.post("/students/import", { preHandler: requirePermission("users.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ unitId: z.string().uuid(), csv: z.string().min(1).max(500_000), defaultPassword: z.string().min(8).max(100).optional() }),
      req.body,
    );
    await assertUnitsInScope(db, req.auth, [body.unitId]);
    const result = await importStudents(db, { tenantId, actorId: req.auth.userId, unitId: body.unitId, rows: parseStudentCsv(body.csv), defaultPassword: body.defaultPassword, now: app.now() });
    return { created: result.created.map(({ id: _id, ...c }) => c), skipped: result.skipped };
  });

  // ---------- Branding ----------
  app.get("/branding", async (req) => {
    const tenant = await getTenant(db, tenantOf(req));
    return { own: tenant.branding, effective: await effectiveBranding(db, tenant) };
  });

  app.put("/branding", { preHandler: [requirePermission("tenant.settings"), requireFeature("white_label")], bodyLimit: 400 * 1024 }, async (req) => {
    const tenant = await getTenant(db, tenantOf(req));
    const body = parse(
      z.object({
        appName: z.string().max(40).nullable().optional(),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
        certificateSignatory: z.string().max(80).nullable().optional(),
        logo: z.string().max(300_000).nullable().optional(),
      }),
      req.body,
    );
    const updated = await updateBranding(db, tenant, body);
    await audit(db, { tenantId: tenant.id, actorId: req.auth.userId, action: "branding.update" });
    return { own: updated.branding, effective: await effectiveBranding(db, updated) };
  });

  // ---------- AI features ----------
  app.get("/ai", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenant = await getTenant(db, tenantOf(req));
    return { configured: Boolean(aiProvider()), hints: tenant.settings.aiHints !== false, proctoring: tenant.settings.aiProctoring !== false };
  });

  app.put("/ai", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ hints: z.boolean(), proctoring: z.boolean() }), req.body);
    await db
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ aiHints: body.hints, aiProctoring: body.proctoring })}::jsonb` })
      .where(eq(tenants.id, tenantId));
    await audit(db, { tenantId, actorId: req.auth.userId, action: "settings.ai", data: body });
    return { configured: Boolean(aiProvider()), ...body };
  });

  // ---------- Data retention ----------
  app.get("/retention", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenant = await getTenant(db, tenantOf(req));
    return { snapshotRetentionDays: tenant.settings.snapshotRetentionDays ?? DEFAULT_SNAPSHOT_DAYS, fixed: RETENTION };
  });

  app.put("/retention", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenantId = tenantOf(req);
    const { snapshotRetentionDays } = parse(z.object({ snapshotRetentionDays: z.number().int().min(7).max(730) }), req.body);
    await db
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ snapshotRetentionDays })}::jsonb` })
      .where(eq(tenants.id, tenantId));
    await audit(db, { tenantId, actorId: req.auth.userId, action: "settings.retention", data: { snapshotRetentionDays } });
    return { snapshotRetentionDays, fixed: RETENTION };
  });

  // ---------- Single sign-on ----------
  app.get("/sso", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const c = await getConnection(db, tenantOf(req));
    return {
      connection: c ? { provider: c.provider, issuer: c.issuer, clientId: c.clientId, emailDomains: c.emailDomains, autoProvisionUnitId: c.autoProvisionUnitId, enabled: c.enabled, hasSecret: true } : null,
      redirectUri: redirectUri(),
      presets: PRESET_ISSUERS,
    };
  });

  app.put("/sso", { preHandler: [requirePermission("tenant.settings"), requireFeature("sso")] }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({
        provider: z.enum(["google", "microsoft", "oidc"]),
        issuer: z.string().url().max(300),
        clientId: z.string().min(1).max(300),
        clientSecret: z.string().min(1).max(500).optional(),
        emailDomains: z.array(z.string().regex(/^@?[a-z0-9.-]+\.[a-z]{2,}$/i, "Use domains like college.edu")).min(1).max(20),
        autoProvisionUnitId: z.string().uuid().nullable(),
        enabled: z.boolean(),
      }),
      req.body,
    );
    if (body.autoProvisionUnitId) await assertUnitsInScope(db, req.auth, [body.autoProvisionUnitId]);
    await saveConnection(db, tenantId, req.auth.userId, body);
    return { ok: true };
  });

  // ---------- Content ----------
  app.get("/skills", async () => ({ skills: await db.select().from(skills).orderBy(skills.position) }));

  app.get("/questions", { preHandler: requirePermission("content.view") }, async (req) => {
    const tenantId = tenantOf(req);
    const q = parse(z.object({ skillId: z.string().optional(), type: z.enum(QUESTION_TYPES).optional() }), req.query);
    const rows = await db
      .select()
      .from(questions)
      .where(and(visibleTo(tenantId), q.skillId ? eq(questions.skillId, q.skillId) : undefined, q.type ? eq(questions.type, q.type) : undefined))
      .orderBy(questions.skillId, questions.difficulty);
    return {
      questions: rows.map((r) => ({
        id: r.id,
        type: r.type,
        skillId: r.skillId,
        language: r.language,
        difficulty: r.difficulty,
        body: r.body,
        answer: r.answer,
        explanation: r.explanation,
        hints: r.hints,
        attempts: r.attempts,
        accuracyPct: r.attempts ? Math.round((r.correctCount / r.attempts) * 100) : null,
        owner: r.tenantId ? "institution" : "playcode",
      })),
    };
  });

  app.get("/packs", { preHandler: requirePermission("content.view") }, async (req) => {
    const tenantId = tenantOf(req);
    return {
      packs: await db
        .select()
        .from(packs)
        .where(or(isNull(packs.tenantId), eq(packs.tenantId, tenantId)))
        .orderBy(packs.position),
    };
  });

  // ---------- Assignments ----------
  app.get("/assignments", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const scoped = new Set(await scopedUnitIds(db, req.auth));
    const units = await tenantUnits(db, tenantId);
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    const rows = (await db.select().from(assignments).where(eq(assignments.tenantId, tenantId)).orderBy(desc(assignments.createdAt))).filter(
      (a) => a.orgUnitIds.some((id) => scoped.has(id)),
    );
    const all = rows.length ? await db.select().from(sessions).where(inArray(sessions.assignmentId, rows.map((r) => r.id))) : [];
    const out = [];
    for (const a of rows) {
      const targeted = forStudents(a, await studentIdsInUnits(db, tenantId, descendants(units, a.orgUnitIds)));
      const mine = all.filter((s) => s.assignmentId === a.id);
      const finished = mine.filter((s) => s.finishedAt);
      out.push({
        id: a.id,
        title: a.title,
        packId: a.packId,
        questionCount: a.questionIds.length,
        units: a.orgUnitIds.map((id) => ({ id, name: unitName.get(id) ?? "Unknown" })),
        openAt: a.openAt,
        closeAt: a.closeAt,
        targeted: targeted.length,
        remedial: Boolean(a.remedial),
        started: mine.length,
        completed: finished.length,
        avgScore: finished.length ? Math.round(finished.reduce((sum, s) => sum + sessionScore(s), 0) / finished.length) : null,
      });
    }
    return { assignments: out };
  });

  app.get("/assignments/:id", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [a] = await db.select().from(assignments).where(and(eq(assignments.id, id), eq(assignments.tenantId, tenantId)));
    if (!a) throw notFound("Assignment");
    await assertUnitsInScope(db, req.auth, a.orgUnitIds);
    const units = await tenantUnits(db, tenantId);
    const targeted = forStudents(a, await studentIdsInUnits(db, tenantId, descendants(units, a.orgUnitIds)));
    const people = targeted.length ? await db.select().from(users).where(inArray(users.id, targeted)) : [];
    const remedial = await remedialProgress(db, a);
    const attempts = await db.select().from(sessions).where(eq(sessions.assignmentId, a.id));
    const byUser = new Map(attempts.map((s) => [s.userId, s]));
    // Item analysis: which questions the group got wrong most.
    const items = await db.execute<{ question_id: string; answered: number; correct: number }>(sql`
      select r.question_id, count(*)::int as answered, sum(case when r.correct then 1 else 0 end)::int as correct
      from responses r join sessions s on s.id = r.session_id
      where s.assignment_id = ${a.id}
      group by r.question_id`);
    const qRows = await db.select({ id: questions.id, stem: questions.body, type: questions.type }).from(questions).where(inArray(questions.id, a.questionIds));
    const qById = new Map(qRows.map((q) => [q.id, q]));
    const itemById = new Map(items.rows.map((i) => [i.question_id, i]));
    return {
      assignment: { id: a.id, title: a.title, openAt: a.openAt, closeAt: a.closeAt, questionCount: a.questionIds.length },
      remedial: remedial && { skills: remedial.skills, below: remedial.below, avgBefore: remedial.avgBefore, avgNow: remedial.avgNow, improved: remedial.improved, reachedTarget: remedial.reachedTarget },
      students: people
        .map((p) => {
          const s = byUser.get(p.id);
          const m = remedial?.students.find((x) => x.id === p.id);
          return {
            id: p.id,
            name: p.name,
            rollNo: p.rollNo,
            status: !s ? "not_started" : s.finishedAt ? "completed" : "in_progress",
            score: s?.finishedAt ? sessionScore(s) : null,
            ...(m ? { masteryBefore: m.before, masteryNow: m.now } : {}),
          };
        })
        .sort((x, y) => x.name.localeCompare(y.name)),
      items: a.questionIds.map((qid, i) => {
        const it = itemById.get(qid);
        return {
          number: i + 1,
          questionId: qid,
          stem: qById.get(qid)?.stem.stem ?? "",
          type: qById.get(qid)?.type ?? null,
          answered: it?.answered ?? 0,
          correctPct: it?.answered ? Math.round((it.correct / it.answered) * 100) : null,
        };
      }),
    };
  });

  app.post("/assignments", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z
        .object({
          title: z.string().min(1).max(120),
          packId: z.string().optional(),
          skillIds: z.array(z.string()).max(20).optional(),
          count: z.number().int().min(1).max(50).default(10),
          unitIds: z.array(z.string().uuid()).min(1),
          openAt: z.coerce.date(),
          closeAt: z.coerce.date(),
        })
        .refine((b) => Boolean(b.packId) !== Boolean(b.skillIds?.length), { message: "Choose either a mission pack or skills" })
        .refine((b) => b.closeAt > b.openAt, { message: "Close time must be after open time" }),
      req.body,
    );
    await assertUnitsInScope(db, req.auth, body.unitIds);
    const created = await createAssignment(db, { ...body, tenantId, actorId: req.auth.userId });
    return { assignment: { ...created, passMark: DEFAULT_PASS_MARK } };
  });

  // Remedial practice: find the students who are weak in some skills, then set work for just them.
  const remedialQuery = z.object({
    skillIds: z.array(z.string().max(60)).min(1).max(5),
    unitIds: z.array(z.string().uuid()).min(1),
    below: z.number().int().min(10).max(90).default(40),
    includeUnpractised: z.boolean().default(false),
  });
  app.post("/assignments/remedial/preview", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(remedialQuery, req.body);
    await assertUnitsInScope(db, req.auth, body.unitIds);
    return { students: await weakStudents(db, { tenantId, ...body }) };
  });
  app.post("/assignments/remedial", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      remedialQuery
        .extend({
          title: z.string().min(1).max(120),
          count: z.number().int().min(1).max(50).default(10),
          openAt: z.coerce.date(),
          closeAt: z.coerce.date(),
          studentIds: z.array(z.string().uuid()).max(2000).optional(),
        })
        .refine((b) => b.closeAt > b.openAt, { message: "Close time must be after open time" }),
      req.body,
    );
    await assertUnitsInScope(db, req.auth, body.unitIds);
    const created = await createRemedialAssignment(db, { ...body, tenantId, actorId: req.auth.userId });
    return { assignment: { id: created.id, title: created.title, students: created.studentIds?.length ?? 0 } };
  });

  // ---------- Analytics ----------
  app.get("/analytics/engagement", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    const scope = await resolveScope(req, unitId);
    const tenant = await getTenant(db, scope.tenantId);
    const now = app.now();
    return engagement(db, { studentIds: scope.studentIds, timeZone: tenant.timeZone, now, today: tenantToday(tenant, now), rules: streakRules(tenant) });
  });

  /** The scope for a weekly briefing: a chosen unit, or everything the person can see. */
  const insightScope = async (req: FastifyRequest, unitId?: string) => {
    const scope = await resolveScope(req, unitId);
    const wide = hasInstitutionScope(req.auth.roles);
    return {
      tenantId: scope.tenantId,
      key: unitId ?? (wide ? "all" : `user:${req.auth.userId}`),
      label: await scopeLabel(db, scope.tenantId, unitId, wide),
      unitIds: scope.unitIds,
      studentIds: scope.studentIds,
    };
  };

  app.get("/insights", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    return cachedInsights(db, await insightScope(req, unitId), app.now());
  });

  app.post("/insights", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.body ?? {});
    await rateLimit(`insights:${req.auth.userId}`, 10, 3_600_000, app.now(), "Too many requests for insights");
    return generateInsights(db, await insightScope(req, unitId), req.auth.userId, app.now());
  });

  app.get("/analytics/skills", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    return skillsReport(db, (await resolveScope(req, unitId)).studentIds);
  });

  app.get("/analytics/readiness", { preHandler: anyAnalytics }, async (req) => {
    const { unitId } = parse(unitQuery, req.query);
    const scope = await resolveScope(req, unitId);
    const tenant = await getTenant(db, scope.tenantId);
    return readinessReport(db, scope.studentIds, tenantToday(tenant, app.now()));
  });
}
