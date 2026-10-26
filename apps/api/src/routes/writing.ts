import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { getMyWriting, submitWriting, writingHome } from "../services/writing";

/** Written English practice in the student app. */
export async function writingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: { auth: { userId: string } } & Parameters<typeof tenantOf>[0]) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/writing", async (req) => writingHome(db, ctx(req)));
  app.get("/student/writing/:id", async (req) => getMyWriting(db, ctx(req), parse(z.object({ id: z.string().uuid() }), req.params).id));
  app.post("/student/writing", async (req) => {
    const body = parse(
      z.object({
        taskId: z.string().max(60),
        text: z.string().trim().min(1, "Write your answer first").max(6000, "That's far over the word limit"),
        // From opening the task to sending it; capped at three hours.
        timeMs: z.number().int().min(0).max(3 * 3_600_000),
      }),
      req.body,
    );
    return submitWriting(db, ctx(req), body);
  });
}
