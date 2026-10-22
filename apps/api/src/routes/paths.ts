import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { forbidden } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { archivePath, createPath, listPaths, pathCsv, pathDetail, studentPaths } from "../services/paths";
import { assertUnitsInScope, scopedUnitIds } from "../services/scope";

const idParam = z.object({ id: z.string().uuid() });

/** Staff may open a path if it targets at least one unit in their scope. */
async function assertPathInScope(req: FastifyRequest, unitIds: string[]) {
  const scoped = new Set(await scopedUnitIds(db, req.auth));
  if (!unitIds.some((u) => scoped.has(u))) throw forbidden("This learning path is outside your scope");
}

/** Learning paths: built and tracked in the console, followed by students. */
export async function pathRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/console/paths", { preHandler: requirePermission("assignments.manage") }, async (req) => ({
    paths: await listPaths(db, tenantOf(req), await scopedUnitIds(db, req.auth), app.now()),
  }));

  app.post("/console/paths", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const body = parse(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().max(2000).default(""),
        unitIds: z.array(z.string().uuid()).min(1).max(50),
        steps: z
          .array(z.object({ kind: z.enum(["skill", "pack"]), ref: z.string().min(1).max(80), target: z.number().int().min(10).max(100).optional(), dueDays: z.number().int().min(0).max(365).nullable().optional() }))
          .min(1)
          .max(30),
        sequential: z.boolean().default(true),
        startsAt: z.coerce.date(),
      }),
      req.body,
    );
    await assertUnitsInScope(db, req.auth, body.unitIds);
    return { path: await createPath(db, { ...body, tenantId: tenantOf(req), actorId: req.auth.userId }) };
  });

  app.get("/console/paths/:id", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    const detail = await pathDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now());
    await assertPathInScope(req, detail.path.orgUnitIds);
    return detail;
  });

  app.get("/console/paths/:id/export", { preHandler: requirePermission("reports.export") }, async (req, reply) => {
    const detail = await pathDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now());
    await assertPathInScope(req, detail.path.orgUnitIds);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="path-progress.csv"`);
    return pathCsv(detail);
  });

  app.post("/console/paths/:id/archive", { preHandler: requirePermission("assignments.manage") }, async (req) => {
    await assertPathInScope(req, (await pathDetail(db, tenantOf(req), parse(idParam, req.params).id, app.now())).path.orgUnitIds);
    await archivePath(db, tenantOf(req), req.auth.userId, parse(idParam, req.params).id);
    return { ok: true };
  });

  app.get("/student/paths", { preHandler: requirePermission("practice.play") }, async (req) => ({
    paths: await studentPaths(db, { tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() }),
  }));
}
