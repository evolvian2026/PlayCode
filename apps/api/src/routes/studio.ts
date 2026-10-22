import type { FastifyInstance, FastifyRequest } from "fastify";
import { can, QUESTION_TYPES } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { aiProvider } from "../lib/ai";
import { forbidden } from "../lib/errors";
import { authenticate, parse, requireAny } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { checkQuestion, createQuestion, DRAFTABLE, draftWithAi, getStudio, listStudio, runCheck, setStatus, updateQuestion, type Bank } from "../services/studio";

const codeLanguage = z.enum(["c", "java", "python"]);
const option = z.object({ id: z.string().min(1).max(4), text: z.string().min(1).max(4000), code: z.boolean().optional() });

const body = z.object({
  stem: z.string().min(1).max(2000),
  code: z.string().max(20_000).optional(),
  language: z.enum(["c", "java", "python", "pseudocode", "sql"]),
  options: z.array(option).max(8).optional(),
  lines: z.array(z.object({ id: z.string().min(1).max(8), text: z.string().max(500) })).max(30).optional(),
  inputHint: z.string().max(200).optional(),
  examples: z.array(z.object({ input: z.string().max(2000), output: z.string().max(2000) })).max(10).optional(),
  languages: z.array(codeLanguage).max(3).optional(),
  starterCode: z.record(codeLanguage, z.string().max(20_000)).optional(),
  schema: z.string().max(20_000).optional(),
});

const answer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("option"), optionId: z.string().min(1) }),
  z.object({ kind: z.literal("text"), accepted: z.array(z.string().min(1).max(2000)).min(1).max(10), caseSensitive: z.boolean().optional() }),
  z.object({ kind: z.literal("lines"), lines: z.array(z.number().int().min(1)).min(1).max(10) }),
  z.object({ kind: z.literal("order"), orders: z.array(z.array(z.string())).min(1).max(5) }),
  z.object({
    kind: z.literal("tests"),
    tests: z.array(z.object({ input: z.string().max(100_000), output: z.string().max(100_000), hidden: z.boolean(), weight: z.number().positive().optional() })).min(2).max(50),
    reference: z.object({ language: codeLanguage, source: z.string().max(20_000) }).optional(),
  }),
  z.object({ kind: z.literal("sql"), solution: z.string().min(1).max(20_000), ordered: z.boolean().optional() }),
]);

const studioInput = z.object({
  type: z.enum(QUESTION_TYPES),
  skillId: z.string().min(1).max(60),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  body,
  answer,
  explanation: z.string().min(1).max(4000),
  hints: z.array(z.string().max(500)).max(5).default([]),
  tags: z.array(z.string().max(40)).max(10).default([]),
  solutions: z.record(codeLanguage, z.string().max(20_000)).nullable().optional(),
  checkMode: z.enum(["run", "manual"]).default("manual"),
  origin: z.enum(["studio", "ai"]).optional(),
});

/** Institution staff write into their institution's private bank; PlayCode's content team into the global bank. */
function bankOf(req: FastifyRequest): Bank {
  if (req.auth.tenantId) {
    if (!can(req.auth.roles, "content.private.manage")) throw forbidden("You can't edit questions for this institution");
    return { tenantId: req.auth.tenantId };
  }
  if (can(req.auth.roles, "content.global.manage")) return { tenantId: null };
  throw forbidden();
}

const idParam = z.object({ id: z.string().min(1).max(80) });

export async function studioRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAny("content.private.manage", "content.global.manage"));

  app.get("/studio", async (req) => ({ bank: bankOf(req).tenantId ? "institution" : "global", ai: Boolean(aiProvider()), draftable: DRAFTABLE }));

  app.get("/studio/questions", async (req) => {
    const q = parse(z.object({ status: z.enum(["draft", "live", "retired"]).optional(), skillId: z.string().max(60).optional(), search: z.string().max(100).optional() }), req.query);
    return { questions: await listStudio(db, bankOf(req), q) };
  });

  app.get("/studio/questions/:id", async (req) => ({ question: await getStudio(db, bankOf(req), parse(idParam, req.params).id) }));

  app.post("/studio/questions", async (req) => ({ question: await createQuestion(db, bankOf(req), req.auth.userId, parse(studioInput, req.body), app.now()) }));

  app.put("/studio/questions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return { question: await updateQuestion(db, bankOf(req), req.auth.userId, id, parse(studioInput, req.body), app.now()) };
  });

  // Check an unsaved question (the editor's "Check" button) or a saved one.
  app.post("/studio/check", async (req) => {
    bankOf(req);
    rateLimit(`studio-check:${req.auth.userId}`, 30, 60_000);
    return { check: await checkQuestion(parse(studioInput, req.body), app.now()) };
  });
  app.post("/studio/questions/:id/check", async (req) => {
    rateLimit(`studio-check:${req.auth.userId}`, 30, 60_000);
    return { check: await runCheck(db, bankOf(req), parse(idParam, req.params).id, app.now()) };
  });

  app.post("/studio/questions/:id/status", async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(z.object({ status: z.enum(["live", "retired", "draft"]) }), req.body);
    return { question: await setStatus(db, bankOf(req), req.auth.userId, id, status, app.now()) };
  });

  app.post("/studio/draft", async (req) => {
    const bank = bankOf(req);
    const input = parse(
      z.object({
        type: z.enum(QUESTION_TYPES),
        skillId: z.string().min(1).max(60),
        language: z.enum(["c", "java", "python", "pseudocode"]),
        difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        count: z.number().int().min(1).max(5).default(3),
        guidance: z.string().max(1000).optional(),
      }),
      req.body,
    );
    rateLimit(`studio-draft:${req.auth.userId}`, 10, 60 * 60_000);
    return { drafts: await draftWithAi(db, { ...input, tenantId: bank.tenantId, actorId: req.auth.userId, now: app.now() }) };
  });
}
