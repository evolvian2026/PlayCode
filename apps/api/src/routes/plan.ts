import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { createStudyPlan, deleteStudyPlan, getStudyPlan } from "../services/study-plan";

/** A student's study plan to a placement drive or a date. */
export async function planRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: Parameters<typeof tenantOf>[0] & { auth: { userId: string } }) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/plan", async (req) => getStudyPlan(db, ctx(req)));
  app.post("/student/plan", async (req) => {
    const body = parse(
      z.union([
        z.object({ driveId: z.string().uuid() }),
        z.object({ targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-01"), profile: z.enum(["service", "product"]) }),
      ]),
      req.body,
    );
    return createStudyPlan(db, ctx(req), body);
  });
  app.delete("/student/plan", async (req) => deleteStudyPlan(db, ctx(req)));
}
