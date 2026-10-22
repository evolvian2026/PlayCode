import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { answer, finishEarly, getMine, listMine, startInterview } from "../services/interviews";

const idParam = z.object({ id: z.string().uuid() });

/** AI mock interviews in the student app. */
export async function interviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: { auth: { userId: string } } & Parameters<typeof tenantOf>[0]) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/interviews", async (req) => listMine(db, ctx(req)));

  app.post("/student/interviews", async (req) => {
    const { track } = parse(z.object({ track: z.enum(["service", "product"]) }), req.body);
    return startInterview(db, ctx(req), track);
  });

  app.get("/student/interviews/:id", async (req) => getMine(db, ctx(req), parse(idParam, req.params).id));

  app.post("/student/interviews/:id/answer", async (req) => {
    const { text } = parse(z.object({ text: z.string().trim().min(1, "Write an answer first").max(4000) }), req.body);
    return answer(db, ctx(req), parse(idParam, req.params).id, text);
  });

  app.post("/student/interviews/:id/finish", async (req) => finishEarly(db, ctx(req), parse(idParam, req.params).id));
}
