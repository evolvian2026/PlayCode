import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { confirmGuardian, guardianLink, guardianStats, myGuardian, removeGuardian, resendConfirmation, setGuardian, setGuardianReports, stopGuardian } from "../services/guardians";

/** A student's monthly progress email to a parent. */
export async function guardianStudentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/guardian", async (req) => myGuardian(db, ctx(req)));
  app.put("/student/guardian", async (req) => {
    const input = parse(
      z.object({
        name: z.string().trim().min(2, "Enter your parent's name").max(120),
        relation: z.enum(["father", "mother", "guardian"]),
        email: z.string().trim().email("Enter a valid email address").max(200),
        consent: z.boolean(),
      }),
      req.body,
    );
    return setGuardian(db, ctx(req), input);
  });
  app.post("/student/guardian/resend", async (req) => resendConfirmation(db, ctx(req)));
  app.delete("/student/guardian", async (req) => removeGuardian(db, ctx(req)));
}

/** The parent's link: no sign-in, the token is the key. */
export async function guardianPublicRoutes(app: FastifyInstance) {
  const token = z.object({ token: z.string().min(40).max(100) });
  app.get("/public/guardian/:token", async (req) => guardianLink(db, parse(token, req.params).token));
  app.post("/public/guardian/:token/confirm", async (req) => confirmGuardian(db, parse(token, req.params).token, app.now()));
  app.post("/public/guardian/:token/stop", async (req) => stopGuardian(db, parse(token, req.params).token, app.now()));
}

/** The institution switches the emails on or off (under /console). */
export async function guardianConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("tenant.settings"));
  app.get("/guardian-reports", async (req) => guardianStats(db, tenantOf(req)));
  app.put("/guardian-reports", async (req) => setGuardianReports(db, { tenantId: tenantOf(req), actorId: req.auth.userId, enabled: parse(z.object({ enabled: z.boolean() }), req.body).enabled }));
}
