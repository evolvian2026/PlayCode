import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isStaff, permissionsFor, type Role } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { memberships, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { checkPassword, signToken } from "../lib/auth";
import { forbidden, notFound, unauthorized } from "../lib/errors";
import { effectiveBranding } from "../services/branding";
import { authenticate, parse } from "../lib/http";

/**
 * The signed-in user, their roles and the tenant they are working in. Partner
 * and platform admins can switch into another tenant, so the active tenant
 * can differ from the user's own.
 */
export async function loadIdentity(userId: string, activeTenantId?: string | null) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const rows = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
  const roles = [...new Set(rows.map((r) => r.role))] as Role[];
  const tenantId = activeTenantId === undefined ? user.tenantId : activeTenantId;
  const [tenant] = tenantId ? await db.select().from(tenants).where(eq(tenants.id, tenantId)) : [];
  return {
    user,
    roles,
    body: {
      user: { id: user.id, name: user.name, email: user.email, rollNo: user.rollNo, tenantId: user.tenantId, roles },
      tenant: tenant ? { id: tenant.id, name: tenant.name, plan: tenant.plan, type: tenant.type, slug: tenant.slug } : null,
      branding: tenant ? await effectiveBranding(db, tenant) : null,
      switched: Boolean(tenant && tenant.id !== user.tenantId),
      permissions: [...permissionsFor(roles)],
      home: isStaff(roles) ? "console" : "play",
    },
  };
}

/** Partner admins can work inside their own sub-tenants; platform admins inside any tenant. */
async function canSwitch(userId: string, roles: Role[], homeTenantId: string | null, target: typeof tenants.$inferSelect) {
  if (roles.includes("super_admin")) return true;
  if (!roles.includes("partner_admin") || !homeTenantId) return false;
  if (target.id === homeTenantId) return true;
  const [own] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, homeTenantId), eq(memberships.role, "partner_admin")));
  return Boolean(own) && target.parentId === homeTenantId;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase().trim()));
    // Same message for unknown email and wrong password.
    if (!user || user.status !== "active" || !(await checkPassword(body.password, user.passwordHash))) {
      throw unauthorized("Email or password is incorrect");
    }
    const identity = (await loadIdentity(user.id))!;
    const token = await signToken({ sub: user.id, tenantId: user.tenantId, roles: identity.roles });
    return { token, ...identity.body };
  });

  app.get("/me", { preHandler: authenticate }, async (req) => {
    const identity = await loadIdentity(req.auth.userId, req.auth.tenantId);
    if (!identity) throw notFound("User");
    return identity.body;
  });

  app.post("/auth/switch-tenant", { preHandler: authenticate }, async (req) => {
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid().nullable() }), req.body);
    const identity = await loadIdentity(req.auth.userId);
    if (!identity) throw notFound("User");
    if (tenantId === null || tenantId === identity.user.tenantId) {
      const token = await signToken({ sub: identity.user.id, tenantId: identity.user.tenantId, roles: identity.roles });
      return { token, ...identity.body };
    }
    const [target] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!target) throw notFound("Institution");
    if (!(await canSwitch(identity.user.id, identity.roles, identity.user.tenantId, target))) throw forbidden("You cannot manage that institution");
    await audit(db, { tenantId: target.id, actorId: identity.user.id, action: "tenant.switch_in", target: target.id });
    const token = await signToken({ sub: identity.user.id, tenantId: target.id, roles: identity.roles }, "4h");
    return { token, ...(await loadIdentity(identity.user.id, target.id))!.body };
  });
}
