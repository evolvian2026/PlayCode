import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { addDays, isoWeekKey } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { memberships, responses, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { hashPassword } from "../lib/auth";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { authenticate, parse, requirePermission } from "../lib/http";
import { customerHealth, healthCsv } from "../services/health";
import { closeLeagueWeek } from "../services/leagues";
import { getTenant, tenantToday } from "../services/tenant";
import { PLANS, type Plan } from "@playcode/core";

/** Seats a partner has left to hand out: its pool minus what its sub-tenants hold. */
async function partnerPool(partnerId: string, excludeChildId?: string) {
  const [partner] = await db.select().from(tenants).where(eq(tenants.id, partnerId));
  if (!partner) throw notFound("Partner");
  const [{ allocated } = { allocated: 0 }] = await db
    .select({ allocated: sql<number>`coalesce(sum(${tenants.seats}), 0)::int` })
    .from(tenants)
    .where(and(eq(tenants.parentId, partnerId), excludeChildId ? ne(tenants.id, excludeChildId) : undefined));
  return { partner, total: partner.seats, allocated, available: partner.seats - allocated };
}

/** A partner can give its colleges any plan up to its own. */
async function assertPlanWithinPartner(partnerId: string, plan: Plan) {
  const [partner] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, partnerId));
  if (!partner || PLANS.indexOf(plan) > PLANS.indexOf(partner.plan)) throw forbidden(`Your partner plan allows colleges up to ${partner?.plan ?? "starter"}`);
}

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
        type: z.enum(["institution", "partner", "company"]).default("institution"),
        plan: z.enum(["starter", "pro", "enterprise"]).default("pro"),
        seats: z.number().int().min(1).max(1_000_000).default(500),
        validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        admin: z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) }),
      }),
      req.body,
    );
    const isSuper = req.auth.roles.includes("super_admin");
    if (!isSuper) {
      // Partners create institutions and companies under themselves, from their own seat pool.
      if (body.type === "partner") throw forbidden("Only PlayCode can create partners");
      await assertPlanWithinPartner(req.auth.tenantId!, body.plan);
      const pool = await partnerPool(req.auth.tenantId!);
      if (body.seats > pool.available) throw badRequest(`Only ${pool.available} seats are left in your pool`);
    }
    const email = body.admin.email.toLowerCase();
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) throw badRequest("That admin email is already registered");
    const created = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: body.name,
          slug: body.slug,
          type: body.type,
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
      await tx.insert(memberships).values({ userId: admin!.id, tenantId: tenant!.id, orgUnitId: null, role: body.type === "partner" ? "partner_admin" : "inst_admin" });
      await audit(tx, { tenantId: tenant!.id, actorId: req.auth.userId, action: "tenant.create", target: tenant!.id, data: { name: body.name } });
      return tenant!;
    }).catch((err: { code?: string }) => {
      if (err.code === "23505") throw badRequest("That short name (slug) is already taken");
      throw err;
    });
    return { tenant: created };
  });

  app.put("/tenants/:id", { preHandler: requirePermission("tenants.manage") }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(
      z.object({
        seats: z.number().int().min(1).max(1_000_000).optional(),
        plan: z.enum(["starter", "pro", "enterprise"]).optional(),
        validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      req.body,
    );
    const [target] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!target) throw notFound("Institution");
    if (!req.auth.roles.includes("super_admin")) {
      if (target.parentId !== req.auth.tenantId) throw forbidden("You can only change your own institutions");
      if (body.plan) await assertPlanWithinPartner(req.auth.tenantId!, body.plan);
      if (body.seats !== undefined) {
        const pool = await partnerPool(req.auth.tenantId!, target.id);
        if (body.seats > pool.available) throw badRequest(`Only ${pool.available} seats are left in your pool`);
      }
    }
    if (body.seats !== undefined) {
      const [{ used } = { used: 0 }] = await db
        .select({ used: sql<number>`count(distinct ${memberships.userId})::int` })
        .from(memberships)
        .where(and(eq(memberships.tenantId, id), eq(memberships.role, "student")));
      if (body.seats < used) throw badRequest(`${used} students already use seats here`);
    }
    const [updated] = await db.update(tenants).set(body).where(eq(tenants.id, id)).returning();
    await audit(db, { tenantId: id, actorId: req.auth.userId, action: "tenant.update", target: id, data: body });
    return { tenant: updated };
  });

  /** Partner dashboard: seat pool and each sub-tenant's usage. */
  // Customer health: every customer for PlayCode staff, a partner's own colleges for the partner.
  const healthFor = (req: FastifyRequest) => {
    if (!req.auth.roles.includes("super_admin") && !req.auth.tenantId) throw badRequest("Sign in with a partner account");
    return customerHealth(db, { partnerId: req.auth.roles.includes("super_admin") ? null : req.auth.tenantId, now: app.now() });
  };
  app.get("/health", { preHandler: requirePermission("tenants.manage") }, async (req) => healthFor(req));
  app.get("/health/export", { preHandler: [requirePermission("tenants.manage"), requirePermission("reports.export")] }, async (req, reply) => {
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="customer-health.csv"`);
    return healthCsv(await healthFor(req));
  });

  app.get("/partner/overview", { preHandler: requirePermission("tenants.manage") }, async (req) => {
    const partnerId = req.auth.tenantId;
    if (!partnerId) throw badRequest("Sign in with a partner account");
    const pool = await partnerPool(partnerId);
    const children = await db.select().from(tenants).where(eq(tenants.parentId, partnerId)).orderBy(tenants.name);
    const ids = children.map((c) => c.id);
    const used = ids.length
      ? await db
          .select({ tenantId: memberships.tenantId, n: sql<number>`count(distinct ${memberships.userId})::int` })
          .from(memberships)
          .where(and(inArray(memberships.tenantId, ids), eq(memberships.role, "student")))
          .groupBy(memberships.tenantId)
      : [];
    const since = new Date(app.now().getTime() - 7 * 86_400_000);
    const active = ids.length
      ? await db
          .select({ tenantId: responses.tenantId, n: sql<number>`count(distinct ${responses.userId})::int` })
          .from(responses)
          .where(and(inArray(responses.tenantId, ids), gte(responses.createdAt, since)))
          .groupBy(responses.tenantId)
      : [];
    return {
      partner: { id: pool.partner.id, name: pool.partner.name, type: pool.partner.type },
      seats: { total: pool.total, allocated: pool.allocated, available: pool.available },
      tenants: children.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        type: c.type,
        plan: c.plan,
        seats: c.seats,
        validUntil: c.validUntil,
        studentsUsed: used.find((u) => u.tenantId === c.id)?.n ?? 0,
        activeLast7Days: active.find((a) => a.tenantId === c.id)?.n ?? 0,
      })),
    };
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
