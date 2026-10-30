import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { declineAlumni, graduateBatch, graduationOverview, graduationPreview, joinAlumni, myGraduation, submitExitSurvey, undoGraduation } from "../services/graduation";

const idParam = z.object({ id: z.string().uuid() });
const rating = z.number().int().min(1).max(5);

/** Graduating a batch, and what graduates are asked: the alumni list and the exit survey. */
export async function graduationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const view = requireAny("users.manage", "placements.manage");
  const manage = requirePermission("users.manage");
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/console/graduation", { preHandler: view }, async (req) => graduationOverview(db, auth(req), app.now()));
  app.get("/console/graduation/:id/preview", { preHandler: manage }, async (req) => graduationPreview(db, auth(req), parse(idParam, req.params).id));
  app.post("/console/graduation/:id", { preHandler: manage }, async (req) => graduateBatch(db, auth(req), parse(idParam, req.params).id, app.now()));
  app.post("/console/graduation/records/:id/undo", { preHandler: manage }, async (req) => undoGraduation(db, auth(req), parse(idParam, req.params).id, app.now()));

  app.get("/student/graduation", { preHandler: play }, async (req) => myGraduation(db, ctx(req)));
  app.post("/student/graduation/alumni", { preHandler: play }, async (req) => {
    const input = parse(
      z.object({
        email: z.string().trim().email("Give an email you'll keep using"),
        company: z.string().max(120),
        role: z.string().max(120).default(""),
        city: z.string().max(80).default(""),
        openToReferrals: z.boolean(),
        openToAdvice: z.boolean(),
      }),
      req.body,
    );
    return joinAlumni(db, ctx(req), input);
  });
  app.post("/student/graduation/alumni/decline", { preHandler: play }, async (req) => declineAlumni(db, ctx(req)));
  app.post("/student/graduation/survey", { preHandler: play }, async (req) => {
    const input = parse(
      z.object({
        ratings: z.object({ training: rating, practice: rating, information: rating, support: rating, overall: rating }, { message: "Rate each one" }),
        recommend: z.boolean({ message: "Say whether you'd recommend it" }),
        comment: z.string().max(1000).default(""),
      }),
      req.body,
    );
    return submitExitSurvey(db, ctx(req), input);
  });
}
