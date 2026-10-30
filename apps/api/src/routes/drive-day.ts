import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { coordinatorCheckIn, coordinatorDesk, coordinators, listUpdates, markUnreportedAbsent, myDesks, postUpdate, setCoordinators, setOfferDetails, staffCheckIn, staffDesk } from "../services/drive-day";

const idParam = z.object({ id: z.string().uuid() });
const studentParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const rupees = z.number().int().min(0).max(100_000_000).nullable().optional();

/** Drive days: updates to applicants, the reporting desk and its coordinators, and offer details. */
export async function driveDayRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const play = requirePermission("practice.play");
  const auth = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId });
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/console/placements/:id/updates", { preHandler: manage }, async (req) => listUpdates(db, tenantOf(req), parse(idParam, req.params).id));
  app.post("/console/placements/:id/updates", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        audience: z.enum(["all", "in_selection", "round", "offered", "not_selected"]),
        round: z.number().int().min(0).max(20).nullable().default(null),
        body: z.string().trim().min(5, "Write the update").max(1000),
      }),
      req.body,
    );
    return postUpdate(db, auth(req), parse(idParam, req.params).id, input, app.now());
  });

  app.get("/console/placements/:id/coordinators", { preHandler: manage }, async (req) => coordinators(db, tenantOf(req), parse(idParam, req.params).id));
  app.put("/console/placements/:id/coordinators", { preHandler: manage }, async (req) =>
    setCoordinators(db, auth(req), parse(idParam, req.params).id, parse(z.object({ userIds: z.array(z.string().uuid()).max(20) }), req.body).userIds, app.now()),
  );
  app.get("/console/placements/:id/desk", { preHandler: manage }, async (req) => staffDesk(db, tenantOf(req), parse(idParam, req.params).id));
  app.put("/console/placements/:id/desk/:userId", { preHandler: manage }, async (req) => {
    const p = parse(studentParam, req.params);
    return staffCheckIn(db, auth(req), p.id, p.userId, parse(z.object({ reported: z.boolean() }), req.body).reported, app.now());
  });
  app.post("/console/placements/:id/schedules/:scheduleId/absent", { preHandler: manage }, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), scheduleId: z.string().uuid() }), req.params);
    return markUnreportedAbsent(db, auth(req), p.id, p.scheduleId);
  });

  app.put("/console/placements/:id/offer-details", { preHandler: manage }, async (req) => {
    const details = parse(
      z.object({
        fixedRupees: rupees,
        variableRupees: rupees,
        joiningBonusRupees: rupees,
        bondMonths: z.number().int().min(0).max(120).nullable().optional(),
        bondAmountRupees: rupees,
        probationMonths: z.number().int().min(0).max(24).nullable().optional(),
        notes: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );
    return setOfferDetails(db, auth(req), parse(idParam, req.params).id, details);
  });

  // ---------- Student coordinators ----------
  app.get("/student/desks", { preHandler: play }, async (req) => myDesks(db, ctx(req)));
  app.get("/student/desks/:id", { preHandler: play }, async (req) => coordinatorDesk(db, ctx(req), parse(idParam, req.params).id));
  app.put("/student/desks/:id/:userId", { preHandler: play }, async (req) => {
    const p = parse(studentParam, req.params);
    return coordinatorCheckIn(db, ctx(req), p.id, p.userId, parse(z.object({ reported: z.boolean() }), req.body).reported);
  });
}
