import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { decideCorrection, inbox, myTicket, myTickets, openTicket, staffClose, staffReply, staffTicket, studentClose, studentReply } from "../services/helpdesk";

const idParam = z.object({ id: z.string().uuid() });
const message = z.string().trim().min(2, "Write your message").max(3000);

/** Students' questions to the placement cell, and the placement cell's inbox. */
export async function helpdeskRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/student/help", { preHandler: play }, async (req) => myTickets(db, ctx(req)));
  app.post("/student/help", { preHandler: play }, async (req) => {
    const input = parse(
      z.object({
        category: z.enum(["record", "eligibility", "drive", "documents", "other"]),
        subject: z.string().trim().min(3, "Say briefly what it's about").max(140),
        message,
        correction: z.object({ field: z.enum(["cgpa", "backlogs", "tenthPct", "twelfthPct", "graduationYear"]), proposed: z.number() }).nullable().default(null),
      }),
      req.body,
    );
    return openTicket(db, ctx(req), input);
  });
  app.get("/student/help/:id", { preHandler: play }, async (req) => myTicket(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/help/:id/reply", { preHandler: play }, async (req) => studentReply(db, ctx(req), parse(idParam, req.params).id, parse(z.object({ body: message }), req.body).body));
  app.post("/student/help/:id/close", { preHandler: play }, async (req) => studentClose(db, ctx(req), parse(idParam, req.params).id));

  app.get("/console/help", { preHandler: manage }, async (req) => inbox(db, auth(req), parse(z.object({ status: z.enum(["open", "answered", "closed"]).default("open") }), req.query).status));
  app.get("/console/help/:id", { preHandler: manage }, async (req) => staffTicket(db, auth(req), parse(idParam, req.params).id));
  app.post("/console/help/:id/reply", { preHandler: manage }, async (req) => {
    const input = parse(z.object({ body: message, close: z.boolean().default(false) }), req.body);
    return staffReply(db, auth(req), parse(idParam, req.params).id, input, app.now());
  });
  app.post("/console/help/:id/correction", { preHandler: manage }, async (req) => {
    const { apply, note } = parse(z.object({ apply: z.boolean(), note: z.string().max(1000).nullable().default(null) }), req.body);
    return decideCorrection(db, auth(req), parse(idParam, req.params).id, apply, note, app.now());
  });
  app.post("/console/help/:id/close", { preHandler: manage }, async (req) => staffClose(db, auth(req), parse(idParam, req.params).id, app.now()));
}
