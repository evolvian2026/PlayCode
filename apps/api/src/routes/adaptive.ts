import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { adaptiveView, answerAdaptive, aptitudeScores, checkDrill, drillQuestion, myAdaptive, startAdaptive } from "../services/adaptive";

const idParam = z.object({ id: z.string().uuid() });
const level = z.coerce.number().int().min(1).max(5);

/** The adaptive aptitude test, aptitude drills, and the scores for staff. */
export async function adaptiveRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const staff = requireAny("placements.manage", "assignments.manage");
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/aptitude", { preHandler: play }, async (req) => myAdaptive(db, ctx(req)));
  app.post("/student/aptitude/tests", { preHandler: play }, async (req) => startAdaptive(db, ctx(req)));
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

  app.get("/console/aptitude", { preHandler: staff }, async (req) => aptitudeScores(db, { ...req.auth, tenantId: tenantOf(req) }));
}
