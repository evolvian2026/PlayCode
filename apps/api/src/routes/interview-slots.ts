import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PANEL_RUBRIC } from "@playcode/core";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { bookSlot, cancelBooking, cancelSlot, createSlots, recordFeedback, staffSlots, studentSlots } from "../services/interview-slots";

const idParam = z.object({ id: z.string().uuid() });

/** Mock interviews with faculty and alumni: slots, bookings and rubric feedback. */
export async function interviewSlotRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const id = (req: FastifyRequest) => parse(idParam, req.params).id;

  app.register(async (s) => {
    s.addHook("preHandler", requirePermission("practice.play"));
    s.get("/student/interview-slots", async (req) => studentSlots(db, ctx(req)));
    s.post("/student/interview-slots/:id/book", async (req) => bookSlot(db, ctx(req), id(req)));
    s.post("/student/interview-slots/:id/cancel", async (req) => cancelBooking(db, ctx(req), id(req)));
  });

  app.register(async (c) => {
    c.addHook("preHandler", requireAny("placements.manage", "assignments.manage"));
    c.addHook("preHandler", async (req) => void tenantOf(req));
    c.get("/console/interview-slots", async (req) => staffSlots(db, req.auth, app.now()));
    c.post("/console/interview-slots", async (req) => {
      const body = parse(
        z.object({
          interviewerName: z.string().trim().min(2).max(80),
          kind: z.enum(["technical", "hr", "general"]),
          startsAt: z.coerce.date(),
          durationMinutes: z.number().int().min(10).max(90),
          count: z.number().int().min(1).max(12).default(1),
          location: z.string().trim().max(300).default(""),
          unitIds: z.array(z.string().uuid()).max(50).default([]),
        }),
        req.body,
      );
      return createSlots(db, req.auth, body, app.now());
    });
    c.post("/console/interview-slots/:id/cancel", async (req) => cancelSlot(db, req.auth, id(req), app.now()));
    c.post("/console/interview-slots/:id/feedback", async (req) => {
      const score = z.number().int().min(1).max(5);
      const body = parse(
        z.union([
          z.object({ noShow: z.literal(true) }),
          z.object({
            scores: z.object(Object.fromEntries(PANEL_RUBRIC.map(([k]) => [k, score])) as Record<(typeof PANEL_RUBRIC)[number][0], typeof score>),
            overall: score,
            recommendation: z.enum(["ready", "almost", "not_yet"]),
            strengths: z.string().trim().max(2000).default(""),
            improvements: z.string().trim().max(2000).default(""),
          }),
        ]),
        req.body,
      );
      return recordFeedback(db, req.auth, id(req), body, app.now());
    });
  });
}
