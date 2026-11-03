import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { getMyJam, jamHome, submitJam } from "../services/jam";
import { drillsHome, getMyDrill, submitDrill } from "../services/speaking-drills";
import { myPracticeTasks } from "../services/practice-tasks";
import { draftIntro, myIntro, practiseIntro, saveIntro } from "../services/self-intro";
import { getMyWriting, submitWriting, writingHome } from "../services/writing";

/** Written and spoken English practice in the student app. */
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

  // Speaking practice: one-minute JAM talks.
  app.get("/student/jam", async (req) => jamHome(db, ctx(req)));
  app.get("/student/jam/:id", async (req) => getMyJam(db, ctx(req), parse(z.object({ id: z.string().uuid() }), req.params).id));
  app.post("/student/jam", async (req) => {
    const body = parse(
      z.object({
        topicId: z.string().max(60),
        transcript: z.string().trim().min(1, "We didn't hear anything. Check your microphone and try again.").max(4000),
        // Microphone time; the page stops at a minute, so a little over allows for the browser's delay.
        spokenMs: z.number().int().min(1000).max(90_000),
      }),
      req.body,
    );
    return submitJam(db, ctx(req), body);
  });

  // "Tell me about yourself": the script, an AI draft from the profile, and spoken run-throughs.
  const introFields = z.object({
    targetRole: z.string().trim().max(80).default(""),
    extra: z.string().trim().max(600).default(""),
  });
  app.get("/student/intro", async (req) => myIntro(db, ctx(req)));
  app.put("/student/intro", async (req) => saveIntro(db, ctx(req), parse(introFields.extend({ script: z.string().trim().max(3000, "Keep it to about a minute") }), req.body)));
  app.post("/student/intro/draft", async (req) => draftIntro(db, ctx(req), parse(introFields, req.body)));
  app.post("/student/intro/practice", async (req) =>
    practiseIntro(db, ctx(req), parse(z.object({ heard: z.string().max(4000), spokenMs: z.number().int().min(1000).max(240_000), hidden: z.boolean().default(false) }), req.body)),
  );

  // Speaking and writing practice set by trainers, done through the pages above.
  app.get("/student/practice-tasks", async (req) => myPracticeTasks(db, ctx(req)));

  // Speaking drills: read aloud, and listen and repeat. Scored without AI.
  app.get("/student/speaking-drills", async (req) => drillsHome(db, ctx(req)));
  app.get("/student/speaking-drills/:id", async (req) => getMyDrill(db, ctx(req), parse(z.object({ id: z.string().uuid() }), req.params).id));
  app.post("/student/speaking-drills", async (req) => {
    const body = parse(
      z.object({
        kind: z.enum(["read", "repeat"]),
        items: z
          .array(z.object({ sentenceId: z.string().max(10), heard: z.string().max(600), spokenMs: z.number().int().min(0).max(60_000) }))
          .min(1, "Answer at least one sentence")
          .max(20),
      }),
      req.body,
    );
    return submitDrill(db, ctx(req), body);
  });
}
