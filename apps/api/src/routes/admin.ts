import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { addDays, isoWeekKey } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { memberships, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { hashPassword } from "../lib/auth";
import { badRequest, forbidden } from "../lib/errors";
import { authenticate, parse, requirePermission } from "../lib/http";
import { closeLeagueWeek } from "../services/leagues";
import { getTenant, tenantToday } from "../services/tenant";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/tenants", { preHandler: requirePermission("tenants.manage") }, async (req) => {
    const rows = await db
      .select({
        tenant: tenants,
        students: sql<number>`(select count(distinct m.user_id)::int from memberships m where m.tenant_id = ${tenants.id} and m.role = 'student')`,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt));
    // Partner admins only see their own sub-tenants.
    const visible = req.auth.roles.includes("super_admin")
      ? rows
      : rows.filter((r) => r.tenant.parentId === req.auth.tenantId || r.tenant.id === req.auth.tenantId);
    return { tenants: visible.map((r) => ({ ...r.tenant, studentsUsed: r.students })) };
  });

  app.post("/tenants", { preHandler: requirePermission("tenants.manage") }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().min(2).max(120),
        slug: z.string().regex(/^[a-z0-9-]{3,40}$/, "lowercase letters, digits and dashes"),
        plan: z.enum(["starter", "pro", "enterprise"]).default("pro"),
        seats: z.number().int().min(1).max(1_000_000).default(500),
        validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        admin: z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) }),
      }),
      req.body,
    );
    const isSuper = req.auth.roles.includes("super_admin");
    const email = body.admin.email.toLowerCase();
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) throw badRequest("That admin email is already registered");
    const created = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: body.name,
          slug: body.slug,
          plan: body.plan,
          seats: body.seats,
          validUntil: body.validUntil ?? null,
          // Partner admins create sub-tenants under their own organisation.
          parentId: isSuper ? null : req.auth.tenantId,
        })
        .returning();
      const [admin] = await tx
        .insert(users)
        .values({ tenantId: tenant!.id, name: body.admin.name, email, passwordHash: await hashPassword(body.admin.password) })
        .returning();
      await tx.insert(memberships).values({ userId: admin!.id, tenantId: tenant!.id, orgUnitId: null, role: "inst_admin" });
      await audit(tx, { tenantId: tenant!.id, actorId: req.auth.userId, action: "tenant.create", target: tenant!.id, data: { name: body.name } });
      return tenant!;
    }).catch((err: { code?: string }) => {
      if (err.code === "23505") throw badRequest("That short name (slug) is already taken");
      throw err;
    });
    return { tenant: created };
  });

  /** Close a league week. Defaults to last week; meant for a weekly scheduled job. */
  app.post("/leagues/close-week", { preHandler: requirePermission("leagues.manage") }, async (req) => {
    const body = parse(z.object({ tenantId: z.string().uuid().optional(), weekKey: z.string().regex(/^\d{4}-W\d{2}$/).optional() }), req.body ?? {});
    const tenantId = body.tenantId ?? req.auth.tenantId;
    if (!tenantId) throw badRequest("tenantId is required");
    if (tenantId !== req.auth.tenantId && !req.auth.roles.includes("super_admin")) throw forbidden();
    const tenant = await getTenant(db, tenantId);
    const weekKey = body.weekKey ?? isoWeekKey(addDays(tenantToday(tenant, app.now()), -7));
    const summary = await db.transaction((tx) => closeLeagueWeek(tx, tenantId, weekKey));
    await audit(db, { tenantId, actorId: req.auth.userId, action: "league.close_week", target: weekKey, data: summary });
    return { weekKey, ...summary };
  });
}
