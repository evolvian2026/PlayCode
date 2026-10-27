import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission } from "../lib/http";
import { myClassTest, myClassTests } from "../services/paper-results";

/** A student's results from class tests on paper. */
export async function classTestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));

  app.get("/student/class-tests", async (req) => myClassTests(db, req.auth.userId));
  app.get("/student/class-tests/:id", async (req) => myClassTest(db, req.auth.userId, parse(z.object({ id: z.string().uuid() }), req.params).id));
}
