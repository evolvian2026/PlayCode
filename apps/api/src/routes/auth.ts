import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isStaff, permissionsFor, type Role } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { memberships, tenants, users } from "../db/schema";
import { checkPassword, signToken } from "../lib/auth";
import { notFound, unauthorized } from "../lib/errors";
import { authenticate, parse } from "../lib/http";

async function loadIdentity(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const rows = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
  const roles = [...new Set(rows.map((r) => r.role))] as Role[];
  const [tenant] = user.tenantId ? await db.select().from(tenants).where(eq(tenants.id, user.tenantId)) : [];
  return {
    user,
    roles,
    body: {
      user: { id: user.id, name: user.name, email: user.email, rollNo: user.rollNo, tenantId: user.tenantId, roles },
      tenant: tenant ? { id: tenant.id, name: tenant.name, plan: tenant.plan } : null,
      permissions: [...permissionsFor(roles)],
      home: isStaff(roles) ? "console" : "play",
    },
  };
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
    const identity = await loadIdentity(req.auth.userId);
    if (!identity) throw notFound("User");
    return identity.body;
  });
}
