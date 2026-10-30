import type { FastifyInstance, FastifyRequest } from "fastify";
import { localDate } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { askOnDuty, cancelOnDuty, decideOnDuty, myOnDuty, onDutyLetter, onDutyQueue, onDutyRoster, rosterCsv } from "../services/on-duty";
import { requireFeature } from "../services/plan";
import { getTenant } from "../services/tenant";

const idParam = z.object({ id: z.string().uuid() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

/** On duty for drives and placement events: students ask, the placement cell approves, class teachers see who's away. */
export async function onDutyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = [requirePermission("practice.play"), requireFeature("placements")];
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const view = [requireAny("placements.manage", "assignments.manage"), requireFeature("placements")];
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/student/on-duty", { preHandler: play }, async (req) => myOnDuty(db, ctx(req)));
  app.post("/student/on-duty", { preHandler: play }, async (req) => {
    const input = parse(
      z.object({
        date: day,
        part: z.enum(["full", "forenoon", "afternoon"]).default("full"),
        reason: z.enum(["drive", "opening", "other"]),
        driveId: z.string().uuid().nullable().default(null),
        openingId: z.string().uuid().nullable().default(null),
        purpose: z.string().max(200).default(""),
        detail: z.string().max(300).default(""),
      }),
      req.body,
    );
    return askOnDuty(db, ctx(req), input);
  });
  app.post("/student/on-duty/:id/cancel", { preHandler: play }, async (req) => cancelOnDuty(db, ctx(req), parse(idParam, req.params).id));
  app.get("/student/on-duty/:id/letter", { preHandler: play }, async (req, reply) => {
    const { filename, pdf } = await onDutyLetter(db, ctx(req), parse(idParam, req.params).id);
    return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${filename}"`).send(pdf);
  });

  app.get("/console/on-duty/queue", { preHandler: manage }, async (req) => onDutyQueue(db, auth(req)));
  app.post("/console/on-duty/decide", { preHandler: manage }, async (req) => {
    const input = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), approve: z.boolean(), note: z.string().max(500).nullable().default(null) }), req.body);
    return decideOnDuty(db, auth(req), input.ids, input, app.now());
  });
  const range = async (req: FastifyRequest) => {
    const today = localDate(app.now(), (await getTenant(db, tenantOf(req))).timeZone);
    const q = parse(z.object({ from: day.optional(), to: day.optional() }), req.query);
    return { from: q.from ?? today, to: q.to ?? q.from ?? today };
  };
  app.get("/console/on-duty", { preHandler: view }, async (req) => {
    const { from, to } = await range(req);
    return onDutyRoster(db, auth(req), from, to);
  });
  app.get("/console/on-duty.csv", { preHandler: view }, async (req, reply) => {
    const { from, to } = await range(req);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="on-duty-${from}-to-${to}.csv"`);
    return rosterCsv(await onDutyRoster(db, auth(req), from, to));
  });
}
