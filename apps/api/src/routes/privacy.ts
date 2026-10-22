import { and, desc, eq, like, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { auditLogs, erasureRequests, users } from "../db/schema";
import { badRequest, forbidden } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { cancelErasure, consentState, exportUserData, listErasureRequests, recordConsent, requestErasure, resolveErasure } from "../services/privacy";
import { scopedUnitIds, studentIdsInUnits } from "../services/scope";

/** Self-service privacy (consent, export, deletion) and the admin side: requests and the audit log. */
export async function privacyRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", authenticate);

    // ---------- Anyone signed in ----------
    r.get("/privacy", async (req) => {
      const [pending] = await db
        .select()
        .from(erasureRequests)
        .where(eq(erasureRequests.userId, req.auth.userId))
        .orderBy(desc(erasureRequests.createdAt))
        .limit(1);
      return { ...(await consentState(db, req.auth.userId)), erasure: pending ?? null, canRequestErasure: req.auth.roles.includes("student") && Boolean(req.auth.tenantId) };
    });

    r.post("/privacy/notice", async (req) => {
      parse(z.object({ accept: z.literal(true) }), req.body);
      await recordConsent(db, { tenantId: req.auth.tenantId, userId: req.auth.userId, purpose: "privacy_notice", granted: true, source: "app", now: app.now() });
      return consentState(db, req.auth.userId);
    });

    r.get("/privacy/export", async (req, reply) => {
      const data = await exportUserData(db, req.auth.userId, app.now());
      reply.header("content-disposition", `attachment; filename="playcode-my-data-${app.now().toISOString().slice(0, 10)}.json"`);
      return data;
    });

    r.post("/privacy/erasure", { preHandler: requirePermission("practice.play") }, async (req) => {
      const { reason } = parse(z.object({ reason: z.string().max(500).optional() }), req.body ?? {});
      return { request: await requestErasure(db, { tenantId: tenantOf(req), userId: req.auth.userId, reason: reason?.trim() || null, now: app.now() }) };
    });

    r.post("/privacy/erasure/cancel", async (req) => {
      await cancelErasure(db, req.auth.userId, app.now());
      return { ok: true };
    });

    // ---------- Admins ----------
    const inScope = (req: Parameters<typeof tenantOf>[0]) => async (userId: string) =>
      (await studentIdsInUnits(db, tenantOf(req), await scopedUnitIds(db, req.auth))).includes(userId);

    r.get("/console/privacy/requests", { preHandler: requirePermission("users.manage") }, async (req) => ({ requests: await listErasureRequests(db, tenantOf(req)) }));

    r.post("/console/privacy/requests/:id", { preHandler: requirePermission("users.manage") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const body = parse(z.object({ decision: z.enum(["erase", "reject"]), note: z.string().max(500).optional() }), req.body);
      return resolveErasure(db, { tenantId: tenantOf(req), actorId: req.auth.userId, requestId: id, decision: body.decision, note: body.note?.trim() || null, inScope: inScope(req), now: app.now() });
    });

    // Fulfil an access request on a student's behalf.
    r.get("/console/students/:id/export", { preHandler: requirePermission("users.manage") }, async (req, reply) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      if (!(await inScope(req)(id))) throw forbidden("This student is outside your scope");
      reply.header("content-disposition", `attachment; filename="playcode-student-${id}.json"`);
      return exportUserData(db, id, app.now());
    });

    r.get("/console/audit", { preHandler: requirePermission("audit.view") }, async (req) => {
      const q = parse(z.object({ action: z.string().max(60).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
      const tenantId = tenantOf(req);
      const ts = sql`date_trunc('milliseconds', ${auditLogs.createdAt})`;
      let after = sql`true`;
      if (q.cursor) {
        const [at, id] = Buffer.from(q.cursor, "base64url").toString().split("|");
        if (!at || !id || Number.isNaN(Date.parse(at)) || !z.string().uuid().safeParse(id).success) throw badRequest("Bad cursor");
        after = sql`(${ts}, ${auditLogs.id}) < (${new Date(at)}::timestamptz, ${id}::uuid)`;
      }
      const rows = await db
        .select({ id: auditLogs.id, action: auditLogs.action, target: auditLogs.target, data: auditLogs.data, at: auditLogs.createdAt, actorId: auditLogs.actorId, actorName: users.name, actorEmail: users.email })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(and(eq(auditLogs.tenantId, tenantId), q.action ? like(auditLogs.action, `${q.action.replace(/[%_\\]/g, "")}%`) : undefined, after))
        .orderBy(desc(ts), desc(auditLogs.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      const actions = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(auditLogs.action);
      return {
        entries: page,
        nextCursor: rows.length > q.limit && last ? Buffer.from(`${last.at.toISOString()}|${last.id}`).toString("base64url") : null,
        actions: actions.map((a) => a.action),
      };
    });
  });
}
