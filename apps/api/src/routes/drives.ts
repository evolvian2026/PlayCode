import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { drives, packs } from "../db/schema";
import { badRequest } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { applyToDrive, candidatesCsv, createDrive, driveDetail, getDrive, importCandidates, listDrives, publicDrive, setCandidateStatus } from "../services/drives";
import { parseStudentCsv } from "./console";

const sectionSchema = z.object({
  title: z.string().min(1).max(80),
  packId: z.string().optional(),
  skillIds: z.array(z.string()).max(20).optional(),
  pick: z.number().int().min(1).max(100),
  marks: z.number().min(0).max(100),
  negative: z.number().min(0).max(100).default(0),
});

/** Recruiter console for hiring drives, plus the public apply flow. */
export async function driveRoutes(app: FastifyInstance) {
  // ---------- Public ----------
  app.get("/public/drives/:code", async (req) => {
    const { code } = parse(z.object({ code: z.string().min(4).max(20) }), req.params);
    return (await publicDrive(db, code, app.now())).view;
  });

  app.post("/public/drives/:code/apply", async (req) => {
    const { code } = parse(z.object({ code: z.string().min(4).max(20) }), req.params);
    const body = parse(
      z.object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
        password: z.string().min(8).max(100),
        phone: z.string().max(20).optional(),
        college: z.string().max(120).optional(),
        consent: z.literal(true, { errorMap: () => ({ message: "Please accept the terms to apply" }) }),
      }),
      req.body,
    );
    rateLimit(`apply:${req.ip}`, 20, 60 * 60_000);
    return applyToDrive(db, code, body, app.now());
  });

  // ---------- Console ----------
  app.register(async (c) => {
    c.addHook("preHandler", authenticate);
    c.addHook("preHandler", requirePermission("drives.manage"));
    const idParam = z.object({ id: z.string().uuid() });

    c.get("/console/drives", async (req) => ({ drives: await listDrives(db, tenantOf(req)) }));

    c.post("/console/drives", async (req) => {
      const tenantId = tenantOf(req);
      const body = parse(
        z
          .object({
            title: z.string().min(1).max(120),
            roleTitle: z.string().min(1).max(120),
            description: z.string().max(4000).default(""),
            durationMinutes: z.number().int().min(5).max(600),
            openAt: z.coerce.date(),
            closeAt: z.coerce.date(),
            proctorLevel: z.union([z.literal(1), z.literal(2)]).default(2),
            cutoffPct: z.number().int().min(0).max(100).nullable().optional(),
            sections: z.array(sectionSchema).min(1).max(10),
          })
          .refine((b) => b.closeAt > b.openAt, { message: "Close time must be after open time" }),
        req.body,
      );
      const drive = await createDrive(db, {
        ...body,
        tenantId,
        actorId: req.auth.userId,
        packQuestionIds: async (packId) => {
          const [p] = await db.select().from(packs).where(eq(packs.id, packId));
          if (!p || (p.tenantId && p.tenantId !== tenantId)) throw badRequest("Unknown mission pack");
          return p.questionIds;
        },
      });
      return { drive };
    });

    c.get("/console/drives/:id", async (req) => driveDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now()));

    c.put("/console/drives/:id", async (req) => {
      const tenantId = tenantOf(req);
      const { id } = parse(idParam, req.params);
      const body = parse(z.object({ status: z.enum(["open", "closed"]).optional(), cutoffPct: z.number().int().min(0).max(100).nullable().optional() }), req.body);
      const d = await getDrive(db, tenantId, id);
      const [updated] = await db.update(drives).set(body).where(eq(drives.id, d.id)).returning();
      return { drive: updated };
    });

    c.put("/console/drives/:id/candidates/:userId", async (req) => {
      const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
      const body = parse(z.object({ status: z.enum(["applied", "shortlisted", "rejected", "hired"]), notes: z.string().max(1000).nullable().optional() }), req.body);
      return { candidate: await setCandidateStatus(db, { tenantId: tenantOf(req), actorId: req.auth.userId, driveId: id, userId, ...body, now: app.now() }) };
    });

    c.post("/console/drives/:id/candidates/import", async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(z.object({ csv: z.string().min(1).max(500_000) }), req.body);
      const result = await importCandidates(db, { tenantId: tenantOf(req), actorId: req.auth.userId, driveId: id, rows: parseStudentCsv(body.csv), now: app.now() });
      return { created: result.created.map(({ id: _id, ...r }) => r), skipped: result.skipped };
    });

    c.get("/console/drives/:id/export.csv", async (req, reply) => {
      const { candidates, drive } = await driveDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now());
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${drive.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-candidates.csv"`)
        .send(candidatesCsv(candidates));
    });
  });
}
