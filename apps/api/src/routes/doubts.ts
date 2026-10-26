import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { answerDoubt, askDoubt, closeDoubt, doubtsOnQuestion, myDoubts, openDoubtCount, staffDoubts } from "../services/doubts";

/** Doubts: students ask about a question they answered; their teachers reply. */
export async function doubtRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const questionParam = z.object({ id: z.string().min(1).max(100) });
  const idParam = z.object({ id: z.string().uuid() });

  app.register(async (s) => {
    s.addHook("preHandler", requirePermission("practice.play"));
    s.get("/student/doubts", async (req) => myDoubts(db, ctx(req)));
    s.get("/student/questions/:id/doubts", async (req) => doubtsOnQuestion(db, ctx(req), parse(questionParam, req.params).id));
    s.post("/student/questions/:id/doubts", async (req) =>
      askDoubt(db, ctx(req), parse(questionParam, req.params).id, parse(z.object({ text: z.string().trim().min(5).max(1000) }), req.body).text),
    );
  });

  app.register(async (c) => {
    c.addHook("preHandler", requirePermission("doubts.answer"));
    c.addHook("preHandler", async (req) => void tenantOf(req));
    c.get("/console/doubts", async (req) => staffDoubts(db, req.auth, parse(z.object({ status: z.enum(["open", "answered", "closed"]).default("open") }), req.query).status));
    c.get("/console/doubts/count", async (req) => ({ open: await openDoubtCount(db, req.auth) }));
    c.post("/console/doubts/:id/answer", async (req) =>
      answerDoubt(db, req.auth, parse(idParam, req.params).id, parse(z.object({ answer: z.string().trim().min(2).max(3000), shared: z.boolean().default(true) }), req.body), app.now()),
    );
    c.post("/console/doubts/:id/close", async (req) => closeDoubt(db, req.auth, parse(idParam, req.params).id));
  });
}
