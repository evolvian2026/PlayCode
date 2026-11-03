import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { attendanceReport, cancelSession, checkIn, createSession, currentCode, feedbackReport, listSessions, markAttendance, myTraining, sessionDetail, setCheckIn, submitFeedback } from "../services/training";

const idParam = z.object({ id: z.string().uuid() });

/** Training sessions: staff schedule them and take attendance (under /console). */
export async function trainingConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAny("placements.manage", "assignments.manage"));
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/training", async (req) => listSessions(db, auth(req), app.now()));

  app.post("/training", async (req) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(3, "Give the session a title").max(120),
        kind: z.enum(["aptitude", "technical", "soft_skills", "mock_drive", "other"]),
        trainer: z.string().trim().min(2, "Who is taking it?").max(120),
        location: z.string().trim().min(2, "Where is it?").max(120),
        startsAt: z.coerce.date(),
        durationMinutes: z.number().int().min(15).max(480),
        unitIds: z.array(z.string().uuid()).max(50).default([]),
      }),
      req.body,
    );
    return createSession(db, auth(req), input, app.now());
  });

  app.get("/training/attendance", async (req) => {
    const { unitId } = parse(z.object({ unitId: z.string().uuid().optional() }), req.query);
    return attendanceReport(db, auth(req), app.now(), unitId);
  });

  app.get("/training/feedback", async (req) => feedbackReport(db, auth(req), app.now()));
  app.get("/training/:id", async (req) => sessionDetail(db, auth(req), parse(idParam, req.params).id, app.now()));
  app.post("/training/:id/check-in", async (req) => setCheckIn(db, auth(req), parse(idParam, req.params).id, parse(z.object({ open: z.boolean() }), req.body).open, app.now()));
  app.get("/training/:id/code", async (req) => currentCode(db, auth(req), parse(idParam, req.params).id, app.now()));
  app.post("/training/:id/attendance", async (req) => {
    const { userId, present } = parse(z.object({ userId: z.string().uuid(), present: z.boolean() }), req.body);
    return markAttendance(db, auth(req), parse(idParam, req.params).id, userId, present, app.now());
  });
  app.post("/training/:id/cancel", async (req) => cancelSession(db, auth(req), parse(idParam, req.params).id, app.now()));
}

/** A student's training sessions and check-in. */
export async function trainingStudentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/training", async (req) => myTraining(db, ctx(req)));
  app.post("/student/training/check-in", async (req) => {
    const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, "The code is six digits") }), req.body);
    return checkIn(db, ctx(req), code);
  });
  app.put("/student/training/:id/feedback", async (req) => {
    const rating = z.number().int().min(1).max(5);
    const input = parse(z.object({ content: rating, delivery: rating, relevance: rating, comment: z.string().max(1000).default("") }), req.body);
    return submitFeedback(db, ctx(req), parse(idParam, req.params).id, input);
  });
}
