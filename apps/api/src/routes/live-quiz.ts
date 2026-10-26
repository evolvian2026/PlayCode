import type { FastifyInstance, FastifyRequest } from "fastify";
import { LIVE_MAX_QUESTIONS, LIVE_MAX_SECONDS, LIVE_MIN_SECONDS } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { advanceQuiz, answerLive, createLiveQuiz, hostView, joinQuiz, myQuizzes, playerView } from "../services/live-quiz";
import { responseSchema } from "./student";

const idParam = z.object({ id: z.string().uuid() });

/** Live classroom quizzes: teachers host them, students join with a code. */
export async function liveQuizRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.register(async (h) => {
    h.addHook("preHandler", requirePermission("assignments.manage"));
    h.get("/console/live", async (req) => myQuizzes(db, ctx(req)));
    h.post("/console/live", async (req) => {
      const body = parse(
        z
          .object({
            title: z.string().trim().min(2).max(120),
            packId: z.string().max(100).optional(),
            skillId: z.string().max(100).optional(),
            count: z.number().int().min(1).max(LIVE_MAX_QUESTIONS).default(10),
            secondsPerQuestion: z.number().int().min(LIVE_MIN_SECONDS).max(LIVE_MAX_SECONDS).default(20),
          })
          .refine((b) => Boolean(b.packId) !== Boolean(b.skillId), "Choose a mission or a skill"),
        req.body,
      );
      return { id: (await createLiveQuiz(db, ctx(req), body)).id };
    });
    h.get("/console/live/:id", async (req) => hostView(db, ctx(req), parse(idParam, req.params).id));
    h.post("/console/live/:id/next", async (req) => advanceQuiz(db, ctx(req), parse(idParam, req.params).id, "next"));
    h.post("/console/live/:id/end", async (req) => advanceQuiz(db, ctx(req), parse(idParam, req.params).id, "end"));
  });

  app.register(async (s) => {
    s.addHook("preHandler", requirePermission("practice.play"));
    s.post("/student/live/join", async (req) => {
      // Codes are short: limit guessing.
      await rateLimit(`live-join:${req.auth.userId}`, 20, 10 * 60_000, app.now(), "Too many tries; check the code with your teacher");
      return joinQuiz(db, ctx(req), parse(z.object({ code: z.string().regex(/^\d{6}$/, "The code has 6 digits") }), req.body).code);
    });
    s.get("/student/live/:id", async (req) => playerView(db, ctx(req), parse(idParam, req.params).id));
    s.post("/student/live/:id/answer", async (req) =>
      answerLive(db, ctx(req), parse(idParam, req.params).id, parse(z.object({ index: z.number().int().min(0), response: responseSchema }), req.body)),
    );
  });
}
