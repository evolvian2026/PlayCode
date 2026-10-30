import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { joiningBoard, setJoining, setMyJoining } from "../services/joining";
import { createOpening, listOpeningsForStaff, myOpenings, openingResponsesFor, respond, withdrawOpening } from "../services/openings";
import { publicRecordSetting, setPublicRecord } from "../services/public-record";

const idParam = z.object({ id: z.string().uuid() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04");
const percent = z.number().min(0).max(100).nullable().optional();
const joining = z.object({
  status: z.enum(["awaiting_letter", "letter_received", "date_given", "joined", "revoked"]),
  joiningDate: day.nullable().default(null),
  note: z.string().trim().max(1000).default(""),
});

/** Openings found outside campus drives, where accepted offers stand, and the public placement record. */
export async function openingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = [requirePermission("practice.play"), requireFeature("placements")];
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const auth = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId });
  const staffAuth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  // ---------- Openings ----------
  app.get("/console/openings", { preHandler: manage }, async (req) => listOpeningsForStaff(db, tenantOf(req), app.now()));
  app.post("/console/openings", { preHandler: manage }, async (req) => {
    const input = parse(
      z.object({
        kind: z.enum(["off_campus", "pool_campus", "internship"]),
        company: z.string().trim().min(2, "Enter the company").max(120),
        roleTitle: z.string().trim().min(2, "Enter the role").max(120),
        payRupees: z.number().int().min(1000).max(100_000_000).nullable().default(null),
        location: z.string().trim().max(120).default(""),
        details: z.string().max(4000).default(""),
        applyUrl: z
          .string()
          .trim()
          .max(500)
          .nullable()
          .default(null)
          .transform((v) => v || null)
          .refine((v) => !v || /^https:\/\//.test(v), "The link must start with https://"),
        closesOn: day,
        criteria: z.object({
          unitIds: z.array(z.string().uuid()).max(50).default([]),
          minCgpa: z.number().min(0).max(10).nullable().optional(),
          maxBacklogs: z.number().int().min(0).max(20).nullable().optional(),
          min10th: percent,
          min12th: percent,
          graduationYears: z.array(z.number().int().min(2000).max(2100)).max(5).nullable().optional(),
          allowPlaced: z.boolean().default(true),
        }),
      }),
      req.body,
    );
    return createOpening(db, auth(req), input, app.now());
  });
  app.get("/console/openings/:id", { preHandler: manage }, async (req) => openingResponsesFor(db, tenantOf(req), parse(idParam, req.params).id, app.now()));
  app.post("/console/openings/:id/withdraw", { preHandler: manage }, async (req) => withdrawOpening(db, auth(req), parse(idParam, req.params).id, app.now()));

  app.get("/student/openings", { preHandler: play }, async (req) => myOpenings(db, ctx(req)));
  app.put("/student/openings/:id", { preHandler: play }, async (req) => {
    const { response } = parse(z.object({ response: z.enum(["applied", "not_interested"]).nullable() }), req.body);
    return respond(db, ctx(req), parse(idParam, req.params).id, response);
  });

  // ---------- Joining ----------
  app.put("/student/placements/:id/joining", { preHandler: play }, async (req) => setMyJoining(db, ctx(req), parse(idParam, req.params).id, parse(joining, req.body)));
  app.get("/console/joining", { preHandler: manage }, async (req) => joiningBoard(db, staffAuth(req), app.now()));
  app.put("/console/joining/:id/:userId", { preHandler: manage }, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
    return setJoining(db, staffAuth(req), p.id, p.userId, parse(joining, req.body), app.now());
  });

  // ---------- Public placement record ----------
  const publish = [requireAny("placements.manage", "tenant.settings"), requireFeature("placements")];
  app.get("/console/placements/public-record", { preHandler: publish }, async (req) => publicRecordSetting(db, tenantOf(req)));
  app.put("/console/placements/public-record", { preHandler: publish }, async (req) => setPublicRecord(db, auth(req), parse(z.object({ enabled: z.boolean() }), req.body).enabled));
}
