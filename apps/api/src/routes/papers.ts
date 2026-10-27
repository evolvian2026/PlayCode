import type { FastifyInstance } from "fastify";
import type { Role } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { paperReport, resultsSheet, saveResults } from "../services/paper-results";
import { createPaper, deletePaper, getPaper, listPapers, MAX_PAPER_QUESTIONS, paperPdf, paperSkills } from "../services/papers";

const idParam = z.object({ id: z.string().uuid() });

/** Question papers for class tests on paper, under /console. */
export async function paperRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("assignments.manage"));
  const auth = (req: Parameters<typeof tenantOf>[0] & { auth: { userId: string } }) => ({ tenantId: tenantOf(req), userId: req.auth.userId });

  app.get("/papers/skills", async (req) => paperSkills(db, tenantOf(req)));
  app.get("/papers", async (req) => listPapers(db, tenantOf(req)));

  app.post("/papers", async (req) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(3, "Give the paper a title").max(120),
        instructions: z.string().trim().max(1000).nullable().default(null),
        durationMinutes: z.number().int().min(5).max(240),
        marksPerQuestion: z.number().int().min(1).max(10).default(1),
        sets: z.union([z.literal(1), z.literal(2)]).default(1),
        picks: z.array(z.object({ skillId: z.string().max(80), count: z.number().int().min(1).max(MAX_PAPER_QUESTIONS) })).min(1).max(30),
      }),
      req.body,
    );
    return getPaper(db, tenantOf(req), (await createPaper(db, auth(req), { ...input, instructions: input.instructions || null }, app.now())).id);
  });

  app.get("/papers/:id", async (req) => getPaper(db, tenantOf(req), parse(idParam, req.params).id));

  app.delete("/papers/:id", async (req) => {
    await deletePaper(db, auth(req), parse(idParam, req.params).id);
    return { ok: true };
  });

  // ---------- Results ----------
  const scope = (req: Parameters<typeof tenantOf>[0] & { auth: { userId: string; roles: Role[] } }) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/papers/:id/results", async (req) => {
    const { unitId } = parse(z.object({ unitId: z.string().uuid({ message: "Choose a batch or section" }) }), req.query);
    return resultsSheet(db, scope(req), parse(idParam, req.params).id, unitId);
  });

  app.post("/papers/:id/results", async (req) => {
    const { entries } = parse(
      z.object({ entries: z.array(z.object({ userId: z.string().uuid(), set: z.enum(["A", "B"]), answers: z.string().max(400) })).min(1).max(300) }),
      req.body,
    );
    return saveResults(db, scope(req), parse(idParam, req.params).id, entries, app.now());
  });

  app.get("/papers/:id/report", async (req) => {
    const { unitId } = parse(z.object({ unitId: z.string().uuid().optional() }), req.query);
    return paperReport(db, scope(req), parse(idParam, req.params).id, unitId);
  });

  app.get("/papers/:id/pdf", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { set, kind } = parse(z.object({ set: z.enum(["A", "B"]).default("A"), kind: z.enum(["paper", "key"]).default("paper") }), req.query);
    const pdf = await paperPdf(db, tenantOf(req), id, set, kind);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="paper-${id.slice(0, 8)}-${set}${kind === "key" ? "-key" : ""}.pdf"`)
      .send(pdf);
  });
}
