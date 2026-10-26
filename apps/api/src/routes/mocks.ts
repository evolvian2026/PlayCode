import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { finishMock, mockView, nextMockSection, runInMock, saveMockAnswer, startMock, studentMocks } from "../services/mocks";
import { responseSchema } from "./student";

const idParam = z.object({ id: z.string().uuid() });

/** Self-serve mock tests on company patterns. */
export async function mockRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const id = (req: FastifyRequest) => parse(idParam, req.params).id;

  app.get("/student/mocks", async (req) => studentMocks(db, ctx(req)));
  app.post("/student/mocks", async (req) => startMock(db, ctx(req), parse(z.object({ pattern: z.string().max(40) }), req.body).pattern));
  app.get("/student/mocks/:id", async (req) => mockView(db, ctx(req), id(req)));
  app.put("/student/mocks/:id/answers", async (req) =>
    saveMockAnswer(db, ctx(req), id(req), parse(z.object({ questionId: z.string().max(100), response: responseSchema.nullable() }), req.body)),
  );
  app.post("/student/mocks/:id/run", async (req) => runInMock(db, ctx(req), id(req), parse(z.object({ questionId: z.string().max(100), response: responseSchema }), req.body)));
  app.post("/student/mocks/:id/next", async (req) => nextMockSection(db, ctx(req), id(req), parse(z.object({ section: z.number().int().min(0).max(20) }), req.body).section));
  app.post("/student/mocks/:id/finish", async (req) => finishMock(db, ctx(req), id(req)));
}
