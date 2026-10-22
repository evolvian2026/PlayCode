import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { assessmentAttempts, assessments, attemptSnapshots, packs } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { getObject } from "../lib/storage";
import {
  attemptDetail,
  extendAttempt,
  getAssessment,
  monitor,
  resetDevice,
  resolveSections,
  resultsReport,
  submitAttempt,
} from "../services/assessments";
import { assertUnitsInScope, scopedUnitIds } from "../services/scope";

const sectionSchema = z
  .object({
    title: z.string().min(1).max(80),
    packId: z.string().optional(),
    skillIds: z.array(z.string()).max(20).optional(),
    questionIds: z.array(z.string()).max(200).optional(),
    pick: z.number().int().min(1).max(100),
    marks: z.number().min(0).max(100),
    negative: z.number().min(0).max(100).default(0),
  })
  .refine((s) => s.packId || s.skillIds?.length || s.questionIds?.length, { message: "Each section needs skills, a pack or questions" });

const createSchema = z
  .object({
    title: z.string().min(1).max(120),
    instructions: z.string().max(4000).default(""),
    proctorLevel: z.union([z.literal(1), z.literal(2)]).default(1),
    durationMinutes: z.number().int().min(5).max(600),
    openAt: z.coerce.date(),
    closeAt: z.coerce.date(),
    unitIds: z.array(z.string().uuid()).min(1),
    sections: z.array(sectionSchema).min(1).max(10),
    releasePolicy: z.enum(["immediate", "manual"]).default("manual"),
  })
  .refine((b) => b.closeAt > b.openAt, { message: "Close time must be after open time" });

async function scopedAssessment(req: FastifyRequest, id: string) {
  const tenantId = tenantOf(req);
  const a = await getAssessment(db, tenantId, id);
  await assertUnitsInScope(db, req.auth, a.orgUnitIds);
  return a;
}

async function scopedAttempt(req: FastifyRequest, id: string) {
  const tenantId = tenantOf(req);
  const [at] = await db.select().from(assessmentAttempts).where(and(eq(assessmentAttempts.id, id), eq(assessmentAttempts.tenantId, tenantId)));
  if (!at) throw notFound("Attempt");
  await scopedAssessment(req, at.assessmentId);
  return at;
}

const idParam = z.object({ id: z.string().uuid() });

export async function assessmentConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const proctor = requirePermission("assessments.proctor");
  const manage = requirePermission("assessments.manage");

  app.get("/assessments", { preHandler: proctor }, async (req) => {
    const tenantId = tenantOf(req);
    const scoped = new Set(await scopedUnitIds(db, req.auth));
    const rows = (await db.select().from(assessments).where(eq(assessments.tenantId, tenantId)).orderBy(desc(assessments.openAt))).filter((a) =>
      a.orgUnitIds.some((u) => scoped.has(u)),
    );
    const attempts = rows.length
      ? await db.select({ assessmentId: assessmentAttempts.assessmentId, status: assessmentAttempts.status, risk: assessmentAttempts.riskScore }).from(assessmentAttempts).where(inArray(assessmentAttempts.assessmentId, rows.map((r) => r.id)))
      : [];
    const now = app.now();
    return {
      assessments: rows.map((a) => {
        const mine = attempts.filter((x) => x.assessmentId === a.id);
        return {
          id: a.id,
          title: a.title,
          proctorLevel: a.proctorLevel,
          durationMinutes: a.durationMinutes,
          openAt: a.openAt,
          closeAt: a.closeAt,
          state: now < a.openAt ? "scheduled" : now > a.closeAt ? "closed" : "live",
          questionCount: a.sections.reduce((n, s) => n + s.pick, 0),
          started: mine.length,
          submitted: mine.filter((x) => x.status !== "in_progress").length,
          flagged: mine.filter((x) => x.risk >= 40).length,
          resultsReleased: a.releasePolicy === "immediate" || a.resultsReleasedAt !== null,
        };
      }),
    };
  });

  app.post("/assessments", { preHandler: manage }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(createSchema, req.body);
    await assertUnitsInScope(db, req.auth, body.unitIds);
    const sections = await resolveSections(db, tenantId, body.sections, async (packId) => {
      const [p] = await db.select().from(packs).where(eq(packs.id, packId));
      if (!p || (p.tenantId && p.tenantId !== tenantId)) throw badRequest("Unknown mission pack");
      return p.questionIds;
    });
    const [created] = await db
      .insert(assessments)
      .values({
        tenantId,
        title: body.title,
        instructions: body.instructions,
        proctorLevel: body.proctorLevel,
        durationMinutes: body.durationMinutes,
        openAt: body.openAt,
        closeAt: body.closeAt,
        sections,
        orgUnitIds: body.unitIds,
        releasePolicy: body.releasePolicy,
        createdBy: req.auth.userId,
      })
      .returning();
    await audit(db, { tenantId, actorId: req.auth.userId, action: "assessment.create", target: created!.id, data: { title: body.title } });
    return { assessment: created };
  });

  app.get("/assessments/:id/monitor", { preHandler: proctor }, async (req) => {
    const a = await scopedAssessment(req, parse(idParam, req.params).id);
    return monitor(db, a.tenantId, a.id, app.now());
  });

  app.get("/assessments/:id/results", { preHandler: proctor }, async (req) => {
    const a = await scopedAssessment(req, parse(idParam, req.params).id);
    return resultsReport(db, a.tenantId, a.id, app.now());
  });

  app.post("/assessments/:id/release", { preHandler: manage }, async (req) => {
    const a = await scopedAssessment(req, parse(idParam, req.params).id);
    await db.update(assessments).set({ resultsReleasedAt: app.now() }).where(eq(assessments.id, a.id));
    await audit(db, { tenantId: a.tenantId, actorId: req.auth.userId, action: "assessment.release", target: a.id });
    return { ok: true };
  });

  app.get("/attempts/:id", { preHandler: proctor }, async (req) => {
    const at = await scopedAttempt(req, parse(idParam, req.params).id);
    return attemptDetail(db, at.tenantId, at.id);
  });

  app.post("/attempts/:id/extend", { preHandler: proctor }, async (req) => {
    const at = await scopedAttempt(req, parse(idParam, req.params).id);
    const { minutes } = parse(z.object({ minutes: z.number().int().min(1).max(120) }), req.body);
    await audit(db, { tenantId: at.tenantId, actorId: req.auth.userId, action: "attempt.extend", target: at.id, data: { minutes } });
    return extendAttempt(db, at.tenantId, at.id, minutes);
  });

  app.post("/attempts/:id/force-submit", { preHandler: proctor }, async (req) => {
    const at = await scopedAttempt(req, parse(idParam, req.params).id);
    await submitAttempt(db, at.id, app.now(), "submitted");
    await audit(db, { tenantId: at.tenantId, actorId: req.auth.userId, action: "attempt.force_submit", target: at.id });
    return { ok: true };
  });

  app.post("/attempts/:id/reset-device", { preHandler: proctor }, async (req) => {
    const at = await scopedAttempt(req, parse(idParam, req.params).id);
    await audit(db, { tenantId: at.tenantId, actorId: req.auth.userId, action: "attempt.reset_device", target: at.id });
    return resetDevice(db, at.tenantId, at.id);
  });

  app.get("/attempts/:id/snapshots/:snapshotId", { preHandler: proctor }, async (req, reply) => {
    const { id, snapshotId } = parse(z.object({ id: z.string().uuid(), snapshotId: z.string().uuid() }), req.params);
    const at = await scopedAttempt(req, id);
    const [snap] = await db.select().from(attemptSnapshots).where(and(eq(attemptSnapshots.id, snapshotId), eq(attemptSnapshots.attemptId, at.id)));
    const data = snap ? await getObject(snap.storageKey) : null;
    if (!snap || !data) throw notFound("Snapshot");
    return reply.header("content-type", snap.contentType).header("cache-control", "private, max-age=300").send(data);
  });
}
