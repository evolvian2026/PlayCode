import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { experienceCounts, experienceOptions, pendingCount, readExperiences, reviewExperience, reviewQueue, submitExperience } from "../services/experiences";
import {
  createDrive,
  driveCsv,
  driveDetail,
  importRecords,
  listDrives,
  outcomes,
  outcomesCsv,
  parseRecordCsv,
  register,
  setDriveStatus,
  studentPlacements,
  updateApplications,
  withdraw,
} from "../services/placements";
import { badRequest } from "../lib/errors";
import { publicLinks } from "../services/resume";

const idParam = z.object({ id: z.string().uuid() });
const percent = z.number().min(0).max(100).nullable().optional();

/** Campus placements: drives and results in the console, registration in the student app. */
export async function placementRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];

  app.get("/console/placements", { preHandler: manage }, async (req) => ({ drives: await listDrives(db, tenantOf(req)) }));

  app.post("/console/placements", { preHandler: manage }, async (req) => {
    const body = parse(
      z.object({
        company: z.string().trim().min(1).max(120),
        companyType: z.enum(["service", "product", "other"]),
        roleTitle: z.string().trim().min(1).max(120),
        description: z.string().max(4000).default(""),
        ctcRupees: z.number().int().min(10_000).max(100_000_000),
        location: z.string().max(120).default(""),
        driveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        registerBy: z.coerce.date(),
        criteria: z.object({
          unitIds: z.array(z.string().uuid()).max(100).default([]),
          minCgpa: z.number().min(0).max(10).nullable().optional(),
          maxBacklogs: z.number().int().min(0).max(60).nullable().optional(),
          min10th: percent,
          min12th: percent,
          graduationYears: z.array(z.number().int().min(2000).max(2100)).max(5).nullable().optional(),
          minAttendancePct: percent,
          allowPlaced: z.boolean().optional(),
        }),
        rounds: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
        packId: z.string().max(80).nullable().default(null),
      }),
      req.body,
    );
    return createDrive(db, { ...body, tenantId: tenantOf(req), actorId: req.auth.userId, now: app.now() });
  });

  app.get("/console/placements/outcomes", { preHandler: [requireAny("placements.manage", "analytics.institution"), requireFeature("placements")] }, async (req) => {
    const { unitId } = parse(z.object({ unitId: z.string().uuid().optional() }), req.query);
    return outcomes(db, tenantOf(req), unitId ? [unitId] : null);
  });

  app.get("/console/placements/outcomes/export", { preHandler: [requirePermission("reports.export"), requireAny("placements.manage", "analytics.institution"), requireFeature("placements")] }, async (req, reply) => {
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="placement-outcomes.csv"`);
    return outcomesCsv(db, tenantOf(req));
  });

  app.post("/console/placements/records", { preHandler: manage }, async (req) => {
    const { csv } = parse(z.object({ csv: z.string().min(1).max(500_000) }), req.body);
    const { rows, errors } = parseRecordCsv(csv);
    if (errors.length) throw badRequest("Some rows could not be read", errors.slice(0, 20).map((message) => ({ path: "csv", message })));
    return importRecords(db, { tenantId: tenantOf(req), actorId: req.auth.userId, rows, now: app.now() });
  });

  app.get("/console/placements/:id", { preHandler: manage }, async (req) => driveDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now()));

  app.get("/console/placements/:id/export", { preHandler: [...manage, requirePermission("reports.export")] }, async (req, reply) => {
    const detail = await driveDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now());
    const name = detail.drive.company.replace(/[^\w-]+/g, "-").toLowerCase();
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name}-registrations.csv"`);
    return driveCsv(detail, await publicLinks(db, detail.applicants.map((a) => a.userId)));
  });

  app.post("/console/placements/:id/status", { preHandler: manage }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["open", "closed", "completed"]) }), req.body);
    await setDriveStatus(db, { tenantId: tenantOf(req), actorId: req.auth.userId, id: parse(idParam, req.params).id, status });
    return { ok: true };
  });

  app.post("/console/placements/:id/applications", { preHandler: manage }, async (req) => {
    const body = parse(
      z.object({ userIds: z.array(z.string().uuid()).min(1).max(1000), action: z.enum(["advance", "reject", "offer", "reset"]), ctcRupees: z.number().int().min(10_000).max(100_000_000).optional() }),
      req.body,
    );
    return updateApplications(db, { ...body, tenantId: tenantOf(req), actorId: req.auth.userId, driveId: parse(idParam, req.params).id, now: app.now() });
  });

  // Students: drives open to them and their own results. Data from a drive stays visible after a plan change.
  // ---------- Interview experiences ----------
  const play = requirePermission("practice.play");
  const studentCtx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const experienceBody = z.object({
    result: z.enum(["selected", "not_selected", "awaiting"]),
    difficulty: z.number().int().min(1).max(5),
    rounds: z.array(z.object({ name: z.string().max(80), description: z.string().trim().max(4000) })).min(1).max(8),
    tips: z.string().max(3000).default(""),
    anonymous: z.boolean().default(false),
  });
  app.get("/student/experiences", { preHandler: play }, async (req) => readExperiences(db, tenantOf(req), parse(z.object({ company: z.string().max(120).optional() }), req.query).company));
  app.get("/student/experiences/counts", { preHandler: play }, async (req) => experienceCounts(db, tenantOf(req)));
  app.get("/student/experiences/mine", { preHandler: play }, async (req) => experienceOptions(db, studentCtx(req)));
  app.put("/student/placements/:id/experience", { preHandler: play }, async (req) => submitExperience(db, studentCtx(req), parse(idParam, req.params).id, parse(experienceBody, req.body)));
  app.get("/console/experiences", { preHandler: manage }, async (req) => reviewQueue(db, tenantOf(req), parse(z.object({ status: z.enum(["pending", "published", "rejected"]).default("pending") }), req.query).status));
  app.get("/console/experiences/count", { preHandler: manage }, async (req) => pendingCount(db, tenantOf(req)));
  app.post("/console/experiences/:id/review", { preHandler: manage }, async (req) => {
    const decision = parse(z.object({ publish: z.boolean(), note: z.string().max(1000).nullable().default(null) }), req.body);
    return reviewExperience(db, { tenantId: tenantOf(req), userId: req.auth.userId }, parse(idParam, req.params).id, decision, app.now());
  });

  app.get("/student/placements", { preHandler: requirePermission("practice.play") }, async (req) => studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() }));

  app.post("/student/placements/:id/register", { preHandler: [requirePermission("practice.play"), requireFeature("placements")] }, async (req) => {
    await register(db, { tenantId: tenantOf(req), userId: req.auth.userId, driveId: parse(idParam, req.params).id, now: app.now() });
    return studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  });

  app.post("/student/placements/:id/withdraw", { preHandler: requirePermission("practice.play") }, async (req) => {
    await withdraw(db, { tenantId: tenantOf(req), userId: req.auth.userId, driveId: parse(idParam, req.params).id, now: app.now() });
    return studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  });
}
