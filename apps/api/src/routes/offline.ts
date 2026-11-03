import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { offlinePack, syncPack } from "../services/offline";
import { responseSchema } from "./student";

/** Offline practice: download a pack of questions, answer without a connection, sync to have them marked. */
export async function offlineRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.post("/student/offline-pack", async (req) => offlinePack(db, ctx(req)));
  app.post("/student/offline-pack/:id/sync", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(
      z.object({
        answers: z
          .array(z.object({ questionId: z.string().max(100), response: responseSchema, answeredAt: z.coerce.date(), timeMs: z.number().int().min(0).max(3_600_000) }))
          .max(50),
      }),
      req.body,
    );
    await rateLimit(`offline-sync:${req.auth.userId}`, 20, 60_000, app.now(), "Too many syncs");
    return syncPack(db, ctx(req), id, body.answers);
  });
}
