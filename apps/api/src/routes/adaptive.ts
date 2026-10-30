import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { adaptiveView, answerAdaptive, aptitudeScores, checkDrill, closeSitting, createSitting, drillQuestion, listSittings, myAdaptive, sittingCsv, sittingResults, startAdaptive } from "../services/adaptive";
import { requireFeature } from "../services/plan";
import { answerHomework, createHomework, homeworkResults, listHomework, myHomework, openHomework, topicAccuracy } from "../services/aptitude-homework";

const idParam = z.object({ id: z.string().uuid() });
const level = z.coerce.number().int().min(1).max(5);

/** The adaptive aptitude test, aptitude drills, and the scores for staff. */
export async function adaptiveRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const staff = requireAny("placements.manage", "assignments.manage");
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/aptitude", { preHandler: play }, async (req) => myAdaptive(db, ctx(req)));
  app.post("/student/aptitude/tests", { preHandler: play }, async (req) => startAdaptive(db, ctx(req), parse(z.object({ sittingId: z.string().uuid().nullable().default(null) }), req.body ?? {}).sittingId));
  app.get("/student/aptitude/tests/:id", { preHandler: play }, async (req) => adaptiveView(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/aptitude/tests/:id/answer", { preHandler: play }, async (req) =>
    answerAdaptive(db, ctx(req), parse(idParam, req.params).id, parse(z.object({ number: z.number().int().min(1), chosen: z.number().int().min(0) }), req.body)),
  );
  app.get("/student/aptitude/drill", { preHandler: play }, async (req) => {
    const q = parse(z.object({ template: z.string().max(40), level: level.default(2) }), req.query);
    return drillQuestion(q.template, q.level);
  });
  app.post("/student/aptitude/drill/check", { preHandler: play }, async (req) =>
    checkDrill(parse(z.object({ template: z.string().max(40), level, seed: z.number().int().min(0).max(2 ** 31), chosen: z.number().int().min(0).max(3) }), req.body)),
  );

  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });
  app.get("/console/aptitude", { preHandler: staff }, async (req) => aptitudeScores(db, auth(req)));

  // Official sittings: the placement cell opens them; staff in scope see the results.
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  app.get("/console/aptitude/sittings", { preHandler: staff }, async (req) => listSittings(db, auth(req), app.now()));
  app.post("/console/aptitude/sittings", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(3, "Give it a title").max(120),
        unitIds: z.array(z.string().uuid()).max(50).default([]),
        opensAt: z.coerce.date(),
        closesAt: z.coerce.date(),
      }),
      req.body,
    );
    return createSitting(db, auth(req), input, app.now());
  });
  app.get("/console/aptitude/sittings/:id", { preHandler: staff }, async (req) => sittingResults(db, auth(req), parse(idParam, req.params).id));
  app.get("/console/aptitude/sittings/:id/csv", { preHandler: staff }, async (req, reply) => {
    const r = await sittingResults(db, auth(req), parse(idParam, req.params).id);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="aptitude-${r.sitting.title.replace(/[^\w]+/g, "-").toLowerCase()}.csv"`);
    return sittingCsv(r);
  });
  // Homework: teachers set it for their sections; students each get their own numbers.
  const teach = requirePermission("assignments.manage");
  app.get("/console/aptitude/topics", { preHandler: staff }, async (req) => topicAccuracy(db, auth(req), app.now()));
  app.get("/console/aptitude/homework", { preHandler: staff }, async (req) => listHomework(db, auth(req), app.now()));
  app.post("/console/aptitude/homework", { preHandler: teach }, async (req) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(3, "Give it a title").max(120),
        unitIds: z.array(z.string().uuid()).max(50),
        parts: z.array(z.object({ template: z.string().max(40), level: z.number().int().min(1).max(5), count: z.number().int().min(1).max(20) })).min(1).max(12),
        dueAt: z.coerce.date(),
      }),
      req.body,
    );
    return createHomework(db, auth(req), input, app.now());
  });
  app.get("/console/aptitude/homework/:id", { preHandler: staff }, async (req) => homeworkResults(db, auth(req), parse(idParam, req.params).id));
  app.get("/student/aptitude/homework", { preHandler: play }, async (req) => myHomework(db, ctx(req)));
  app.get("/student/aptitude/homework/:id", { preHandler: play }, async (req) => openHomework(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/aptitude/homework/:id/answer", { preHandler: play }, async (req) =>
    answerHomework(db, ctx(req), parse(idParam, req.params).id, parse(z.object({ index: z.number().int().min(0), chosen: z.number().int().min(0) }), req.body)),
  );

  app.post("/console/aptitude/sittings/:id/close", { preHandler: manage }, async (req) => closeSitting(db, auth(req), parse(idParam, req.params).id, app.now()));
}
