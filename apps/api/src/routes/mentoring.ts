import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, type Permission } from "@playcode/core";
import { db } from "../db/client";
import { forbidden } from "../lib/errors";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { assignMentor, assignmentSheet, logMeeting, menteeRecord, myMentees, myMentor, splitSection, unassign } from "../services/mentoring";

const ASSIGNERS: Permission[] = ["users.manage", "placements.manage", "analytics.department"];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Assigning mentors and the mentor's own views, under /console. */
export async function mentoringConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });
  const assigners = requireAny(...ASSIGNERS);
  const staff = requireAny("analytics.institution", "analytics.department", "analytics.own_units");

  app.get("/mentoring/assign", { preHandler: assigners }, async (req) => assignmentSheet(db, auth(req), parse(z.object({ unitId: z.string().uuid({ message: "Choose a batch or section" }) }), req.query).unitId));
  app.post("/mentoring/assign", { preHandler: assigners }, async (req) => {
    const { mentorId, studentIds } = parse(z.object({ mentorId: z.string().uuid(), studentIds: z.array(z.string().uuid()).min(1).max(500) }), req.body);
    return assignMentor(db, auth(req), mentorId, studentIds, app.now());
  });
  app.post("/mentoring/split", { preHandler: assigners }, async (req) => {
    const { unitId, mentorIds } = parse(z.object({ unitId: z.string().uuid(), mentorIds: z.array(z.string().uuid()).min(1).max(40) }), req.body);
    return splitSection(db, auth(req), unitId, mentorIds, app.now());
  });
  app.post("/mentoring/unassign", { preHandler: assigners }, async (req) => unassign(db, auth(req), parse(z.object({ studentIds: z.array(z.string().uuid()).min(1).max(500) }), req.body).studentIds));

  app.get("/mentees", { preHandler: staff }, async (req) => {
    const { mentorId } = parse(z.object({ mentorId: z.string().uuid().optional() }), req.query);
    // Another mentor's list is for the people who assign mentors.
    if (mentorId && mentorId !== req.auth.userId && !ASSIGNERS.some((p) => can(req.auth.roles, p))) throw forbidden("You can see your own mentees");
    return myMentees(db, auth(req), app.now(), mentorId);
  });
  app.get("/mentees/:id", { preHandler: staff }, async (req) => menteeRecord(db, auth(req), parse(z.object({ id: z.string().uuid() }), req.params).id));
  app.post("/mentees/:id/meetings", { preHandler: staff }, async (req) => {
    const input = parse(
      z.object({
        meetingDate: day,
        mode: z.enum(["in_person", "call", "online"]),
        notes: z.string().max(4000).default(""),
        actionPoints: z.string().max(2000).default(""),
        followUpOn: day.nullable().default(null),
      }),
      req.body,
    );
    return logMeeting(db, auth(req), parse(z.object({ id: z.string().uuid() }), req.params).id, input, app.now());
  });
}

/** A student's mentor and the action points from their meetings. */
export async function mentoringStudentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  app.get("/student/mentor", async (req) => myMentor(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() }));
}
