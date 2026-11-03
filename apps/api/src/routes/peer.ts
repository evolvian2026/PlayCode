import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { digestSetting, setDigest, weekSummary } from "../services/digest";
import { cancelRequest, cancelSession, giveFeedback, myPeer, requestPartner } from "../services/peer";

const idParam = z.object({ id: z.string().uuid() });
const rating = z.number().int().min(1).max(5);

/** Peer mock interviews, and the placement cell's week. */
export async function peerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/peer", { preHandler: play }, async (req) => myPeer(db, ctx(req)));
  app.post("/student/peer/request", { preHandler: play }, async (req) => {
    const input = parse(
      z.object({
        track: z.enum(["technical", "hr"]),
        mode: z.enum(["online", "in_person", "either"]),
        windows: z
          .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["morning", "afternoon", "evening"]) }))
          .min(1, "Pick at least one time")
          .max(21),
      }),
      req.body,
    );
    return requestPartner(db, ctx(req), input);
  });
  app.post("/student/peer/request/cancel", { preHandler: play }, async (req) => cancelRequest(db, ctx(req)));
  app.post("/student/peer/sessions/:id/cancel", { preHandler: play }, async (req) => cancelSession(db, ctx(req), parse(idParam, req.params).id));
  app.post("/student/peer/sessions/:id/feedback", { preHandler: play }, async (req) => {
    const input = parse(
      z.object({
        partnerAbsent: z.boolean().default(false),
        ratings: z.object({ clarity: rating, content: rating, confidence: rating }).nullable().default(null),
        comment: z.string().max(1000).default(""),
      }),
      req.body,
    );
    return giveFeedback(db, ctx(req), parse(idParam, req.params).id, input);
  });

  app.get("/console/week", { preHandler: manage }, async (req) => ({ ...(await weekSummary(db, { ...req.auth, tenantId: tenantOf(req) }, app.now())), digest: await digestSetting(db, req.auth.userId) }));
  app.put("/console/week/digest", { preHandler: manage }, async (req) => setDigest(db, req.auth.userId, parse(z.object({ enabled: z.boolean() }), req.body).enabled));
}
