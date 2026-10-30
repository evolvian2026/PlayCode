import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { requireFeature } from "../services/plan";
import { batchChecklist, myChecklist, nudge } from "../services/checklist";
import { createFeedbackLink, driveFeedback, feedbackForm, feedbackSummary, submitFeedback } from "../services/recruiter-feedback";

const idParam = z.object({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

/** The placement readiness checklist, and recruiter feedback (with its public form). */
export async function readinessRoutes(app: FastifyInstance) {
  // The company's form needs no account: the link is the key.
  app.get("/public/feedback/:token", async (req) => {
    await rateLimit(`feedback:${req.ip}`, 60, 60_000);
    return feedbackForm(db, parse(tokenParam, req.params).token, app.now());
  });
  app.post("/public/feedback/:token", async (req) => {
    await rateLimit(`feedback:${req.ip}`, 60, 60_000);
    const rating = z.number().int().min(1).max(5);
    const input = parse(
      z.object({
        ratings: z.object({ aptitude: rating, technical: rating, communication: rating, preparedness: rating }),
        wentWell: z.string().max(2000).default(""),
        gaps: z.string().max(2000).default(""),
        returnNextYear: z.enum(["yes", "maybe", "no"]),
        plannedHires: z.number().int().min(0).max(5000).nullable().default(null),
        respondentName: z.string().max(120).default(""),
        respondentRole: z.string().max(120).default(""),
      }),
      req.body,
    );
    return submitFeedback(db, parse(tokenParam, req.params).token, input, app.now());
  });

  app.register(async (inner) => {
    inner.addHook("preHandler", authenticate);
    const play = requirePermission("practice.play");
    const manage = [requirePermission("placements.manage"), requireFeature("placements")];
    const reporting = [requireAny("placements.manage", "analytics.institution", "analytics.department", "analytics.own_units"), requireFeature("placements")];
    const staffAuth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

    inner.get("/student/checklist", { preHandler: play }, async (req) => myChecklist(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() }));
    inner.get("/console/readiness", { preHandler: reporting }, async (req) => {
      const { unitId } = parse(z.object({ unitId: z.string().uuid().optional() }), req.query);
      return batchChecklist(db, staffAuth(req), unitId ?? null, app.now());
    });
    inner.post("/console/readiness/nudge", { preHandler: manage }, async (req) => {
      const input = parse(z.object({ userIds: z.array(z.string().uuid()).min(1).max(500), about: z.enum(["checklist", "drives"]) }), req.body);
      return nudge(db, staffAuth(req), input, app.now());
    });

    inner.get("/console/placements/:id/feedback", { preHandler: manage }, async (req) => driveFeedback(db, tenantOf(req), parse(idParam, req.params).id));
    inner.post("/console/placements/:id/feedback", { preHandler: manage }, async (req) => {
      const { email } = parse(z.object({ email: z.string().trim().email("Enter a valid email").nullable().default(null) }), req.body);
      return createFeedbackLink(db, { tenantId: tenantOf(req), userId: req.auth.userId }, parse(idParam, req.params).id, email, app.now());
    });
    inner.get("/console/recruiter-feedback", { preHandler: reporting }, async (req) => feedbackSummary(db, tenantOf(req), app.now()));
  });
}
