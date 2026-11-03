import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { acknowledge, circularDetail, createCircular, listCirculars, myCirculars, remindCircular, withdrawCircular } from "../services/circulars";

const idParam = z.object({ id: z.string().uuid() });

/** Circulars: staff post them and see who has acknowledged (under /console). */
export async function circularConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAny("placements.manage", "assignments.manage"));
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/circulars", async (req) => listCirculars(db, auth(req), app.now()));
  app.post("/circulars", async (req) => {
    const input = parse(
      z
        .object({
          title: z.string().trim().min(3, "Give it a title").max(140),
          body: z.string().trim().min(10, "Write the circular").max(5000),
          unitIds: z.array(z.string().uuid()).max(50).default([]),
          requireAck: z.boolean().default(false),
          ackBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        })
        .refine((v) => !v.requireAck || v.ackBy, { message: "Choose the last day to acknowledge", path: ["ackBy"] }),
      req.body,
    );
    return createCircular(db, auth(req), input, app.now());
  });
  app.get("/circulars/:id", async (req) => circularDetail(db, auth(req), parse(idParam, req.params).id));
  app.post("/circulars/:id/remind", async (req) => remindCircular(db, auth(req), parse(idParam, req.params).id, app.now()));
  app.post("/circulars/:id/withdraw", async (req) => withdrawCircular(db, auth(req), parse(idParam, req.params).id, app.now()));
}

export async function circularStudentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  app.get("/student/circulars", async (req) => myCirculars(db, ctx(req)));
  app.post("/student/circulars/:id/ack", async (req) => acknowledge(db, ctx(req), parse(idParam, req.params).id));
}
