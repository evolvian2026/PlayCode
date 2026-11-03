import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { createSquad, GOALS, joinSquad, leaveSquad, mySquad, nudge, setGoal } from "../services/squads";

const goal = z.number().int().refine((n) => (GOALS as readonly number[]).includes(n), { message: `Choose a goal of ${GOALS.join(", ")} answers` });

/** Study squads for students. */
export async function squadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/squad", async (req) => mySquad(db, ctx(req)));
  app.post("/student/squad", async (req) => createSquad(db, ctx(req), parse(z.object({ name: z.string().trim().min(2).max(40), weeklyGoal: goal.default(100) }), req.body)));
  app.put("/student/squad", async (req) => setGoal(db, ctx(req), parse(z.object({ weeklyGoal: goal }), req.body).weeklyGoal));
  app.post("/student/squad/join", async (req) => {
    await rateLimit(`squad-join:${req.auth.userId}`, 10, 60_000, app.now(), "Too many tries");
    return joinSquad(db, ctx(req), parse(z.object({ code: z.string().trim().min(4).max(12) }), req.body).code);
  });
  app.post("/student/squad/leave", async (req) => {
    await leaveSquad(db, req.auth.userId);
    return mySquad(db, ctx(req));
  });
  app.post("/student/squad/nudge", async (req) => nudge(db, ctx(req), parse(z.object({ userId: z.string().uuid() }), req.body).userId));
}
