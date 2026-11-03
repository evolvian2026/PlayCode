import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { forbidden } from "../lib/errors";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { contestProblems, contestSimilarity, contestView, createContest, runInContest, staffContests, staffContestView, studentContests, submitToContest } from "../services/contests";
import { assertUnitsInScope } from "../services/scope";
import { responseSchema } from "./student";

const idParam = z.object({ id: z.string().uuid() });
const answerBody = z.object({ questionId: z.string().max(100), response: responseSchema });

/** Coding contests: taking part (students), running them and reading results (staff; PlayCode staff outside a college run inter-college ones). */
export async function contestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  /** The college, or null for PlayCode staff working across colleges. */
  const scope = (req: FastifyRequest) => {
    if (req.auth.tenantId) return req.auth.tenantId;
    if (!req.auth.roles.includes("super_admin")) throw forbidden("This action needs an institution account");
    return null;
  };

  app.register(async (s) => {
    s.addHook("preHandler", requirePermission("practice.play"));
    s.get("/student/contests", async (req) => studentContests(db, ctx(req)));
    s.get("/student/contests/:id", async (req) => contestView(db, ctx(req), parse(idParam, req.params).id));
    s.post("/student/contests/:id/submit", async (req) => submitToContest(db, ctx(req), parse(idParam, req.params).id, parse(answerBody, req.body)));
    s.post("/student/contests/:id/run", async (req) => runInContest(db, ctx(req), parse(idParam, req.params).id, parse(answerBody, req.body)));
  });

  app.register(async (c) => {
    c.addHook("preHandler", requireAny("events.manage", "analytics.institution", "analytics.department", "analytics.own_units"));
    c.get("/console/contests", async (req) => staffContests(db, scope(req), app.now()));
    c.get("/console/contests/problems", { preHandler: requirePermission("events.manage") }, async (req) => contestProblems(db, scope(req)));
    c.post("/console/contests", { preHandler: requirePermission("events.manage") }, async (req) => {
      const body = parse(
        z.object({
          title: z.string().trim().min(3).max(120),
          description: z.string().max(2000).default(""),
          problemIds: z.array(z.string().max(100)).min(1).max(12),
          audienceIds: z.array(z.string().uuid()).max(200).default([]),
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
          freezeMinutes: z.number().int().min(0).max(600).default(0),
        }),
        req.body,
      );
      const tenantId = scope(req);
      // A college contest targets units in the creator's scope; an inter-college one, colleges.
      if (tenantId && body.audienceIds.length) await assertUnitsInScope(db, req.auth, body.audienceIds);
      const contest = await createContest(db, { tenantId, actorId: req.auth.userId, input: body, now: app.now() });
      return { id: contest.id };
    });
    c.get("/console/contests/:id", async (req) => staffContestView(db, scope(req), parse(idParam, req.params).id, app.now()));
    c.get("/console/contests/:id/similarity", { preHandler: requirePermission("events.manage") }, async (req) => contestSimilarity(db, scope(req), parse(idParam, req.params).id, app.now()));
  });
}
