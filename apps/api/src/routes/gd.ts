import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { finishGd, getMyGd, listen, listMyGds, speak, startGd, wrapUp } from "../services/gd";

const idParam = z.object({ id: z.string().uuid() });

/** Group discussion practice in the student app. */
export async function gdRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: { auth: { userId: string } } & Parameters<typeof tenantOf>[0]) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/gd", async (req) => listMyGds(db, ctx(req)));
  app.post("/student/gd", async (req) => startGd(db, ctx(req), parse(z.object({ topicId: z.string().max(60).optional() }), req.body ?? {}).topicId));
  app.get("/student/gd/:id", async (req) => getMyGd(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/gd/:id/speak", async (req) => {
    const { text } = parse(z.object({ text: z.string().trim().min(2, "Say something first").max(1500, "Keep it under 1500 characters: in a GD, short points land better") }), req.body);
    return speak(db, ctx(req), parse(idParam, req.params).id, text);
  });
  app.post("/student/gd/:id/listen", async (req) => listen(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/gd/:id/wrap", async (req) => wrapUp(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/gd/:id/finish", async (req) => finishGd(db, ctx(req), parse(idParam, req.params).id));
}
