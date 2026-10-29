import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { companyList, companyPage } from "../services/companies";
import { createSchedule, driveScheduleList, markSlot } from "../services/drive-schedules";
import { batchCsv, batchReport, deleteOutcome, graduationYears, myOutcomes, outcomeQueue, reportOutcome, reviewOutcome, updateOutcome } from "../services/graduate-outcomes";
import { experienceCounts, experienceOptions, pendingCount, readExperiences, reviewExperience, reviewQueue, submitExperience } from "../services/experiences";
import {
  createDrive,
  decideOffer,
  driveCsv,
  driveDetail,
  importRecords,
  listDrives,
  outcomes,
  outcomesCsv,
  parseRecordCsv,
  placementPolicy,
  register,
  setPlacementPolicy,
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

  // ---------- Graduate outcomes (off-campus offers, higher studies, exams, startups) ----------
  const outcomeBody = z.object({
    kind: z.enum(["job", "higher_studies", "exam", "startup"]),
    organisation: z.string().trim().min(2, "Name the company, institute or exam").max(160),
    detail: z.string().max(300).default(""),
    ctcRupees: z.number().int().min(10_000).max(100_000_000).nullable().default(null),
    outcomeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-12"),
  });
  const staffAuth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });
  const reporting = [requireAny("placements.manage", "analytics.institution", "analytics.department"), requireFeature("placements")];
  app.get("/student/outcomes", { preHandler: play }, async (req) => myOutcomes(db, studentCtx(req)));
  app.post("/student/outcomes", { preHandler: play }, async (req) => reportOutcome(db, studentCtx(req), parse(outcomeBody, req.body)));
  app.put("/student/outcomes/:id", { preHandler: play }, async (req) => updateOutcome(db, studentCtx(req), parse(idParam, req.params).id, parse(outcomeBody, req.body)));
  app.delete("/student/outcomes/:id", { preHandler: play }, async (req) => deleteOutcome(db, studentCtx(req), parse(idParam, req.params).id));
  app.get("/console/outcomes", { preHandler: manage }, async (req) => outcomeQueue(db, staffAuth(req), parse(z.object({ status: z.enum(["pending", "verified", "rejected"]).default("pending") }), req.query).status));
  app.post("/console/outcomes/:id/review", { preHandler: manage }, async (req) => {
    const decision = parse(z.object({ verify: z.boolean(), note: z.string().max(1000).nullable().default(null) }), req.body);
    return reviewOutcome(db, staffAuth(req), parse(idParam, req.params).id, decision, app.now());
  });
  const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
  app.get("/console/outcomes/batch", { preHandler: reporting }, async (req) => {
    const years = await graduationYears(db, tenantOf(req));
    const year = parse(yearQuery, req.query).year ?? years[0];
    return { years, report: year ? await batchReport(db, staffAuth(req), year) : null };
  });
  app.get("/console/outcomes/batch/export", { preHandler: [requirePermission("reports.export"), ...reporting] }, async (req, reply) => {
    const year = parse(yearQuery, req.query).year ?? (await graduationYears(db, tenantOf(req)))[0];
    if (!year) throw badRequest("No graduating year is on record yet");
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="graduate-outcomes-${year}.csv"`);
    return batchCsv(await batchReport(db, staffAuth(req), year));
  });

  // ---------- Company pages ----------
  app.get("/student/companies", { preHandler: play }, async (req) => companyList(db, studentCtx(req)));
  app.get("/student/companies/:name", { preHandler: play }, async (req) => companyPage(db, studentCtx(req), parse(z.object({ name: z.string().min(1).max(120) }), req.params).name));

  app.get("/student/placements", { preHandler: requirePermission("practice.play") }, async (req) => studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() }));

  app.post("/student/placements/:id/register", { preHandler: [requirePermission("practice.play"), requireFeature("placements")] }, async (req) => {
    await register(db, { tenantId: tenantOf(req), userId: req.auth.userId, driveId: parse(idParam, req.params).id, now: app.now() });
    return studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  });

  app.post("/student/placements/:id/withdraw", { preHandler: requirePermission("practice.play") }, async (req) => {
    await withdraw(db, { tenantId: tenantOf(req), userId: req.auth.userId, driveId: parse(idParam, req.params).id, now: app.now() });
    return studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  });
  app.post("/student/placements/:id/decision", { preHandler: requirePermission("practice.play") }, async (req) => {
    const { accept } = parse(z.object({ accept: z.boolean() }), req.body);
    await decideOffer(db, { tenantId: tenantOf(req), userId: req.auth.userId, driveId: parse(idParam, req.params).id, accept, now: app.now() });
    return studentPlacements(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  });

  // ---------- Interview schedules ----------
  app.get("/console/placements/:id/schedules", { preHandler: manage }, async (req) => driveScheduleList(db, tenantOf(req), parse(idParam, req.params).id));
  app.post("/console/placements/:id/schedules", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        round: z.number().int().min(0).max(7),
        startsAt: z.coerce.date(),
        slotMinutes: z.number().int().min(5).max(180),
        panels: z.array(z.object({ name: z.string().trim().min(1, "Name each panel").max(60), room: z.string().trim().max(60).default(""), interviewer: z.string().trim().max(120).default("") })).min(1).max(20),
      }),
      req.body,
    );
    return createSchedule(db, { tenantId: tenantOf(req), userId: req.auth.userId }, parse(idParam, req.params).id, input, app.now());
  });
  app.post("/console/placements/:id/schedules/:scheduleId/slots/:userId", { preHandler: manage }, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), scheduleId: z.string().uuid(), userId: z.string().uuid() }), req.params);
    const { status } = parse(z.object({ status: z.enum(["scheduled", "done", "no_show", "excused"]) }), req.body);
    return markSlot(db, { tenantId: tenantOf(req), userId: req.auth.userId }, p.id, p.scheduleId, p.userId, status);
  });

  app.get("/console/placements/policy", { preHandler: manage }, async (req) => placementPolicy(db, tenantOf(req)));
  app.put("/console/placements/policy", { preHandler: manage }, async (req) => {
    const policy = parse(
      z.object({
        tiers: z.boolean(),
        dreamFromRupees: z.number().int().min(100_000).max(100_000_000),
        superDreamFromRupees: z.number().int().min(100_000).max(100_000_000),
        maxOffers: z.number().int().min(1).max(5),
        decisionDays: z.number().int().min(1).max(14),
        maxNoShows: z.number().int().min(1).max(10).nullable().default(null),
      }),
      req.body,
    );
    return setPlacementPolicy(db, { tenantId: tenantOf(req), actorId: req.auth.userId, policy });
  });
}
