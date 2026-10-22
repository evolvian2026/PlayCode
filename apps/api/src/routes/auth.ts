import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isStaff, permissionsFor, type Role } from "@playcode/core";
import { z } from "zod";
import { db } from "../db/client";
import { memberships, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { rateLimit } from "../lib/rate-limit";
import { checkPassword, signMfaToken, signToken, verifyMfaToken } from "../lib/auth";
import { forbidden, notFound, unauthorized } from "../lib/errors";
import { env } from "../env";
import { effectiveBranding } from "../services/branding";
import { startSaml } from "../services/saml";
import { finishLogin, startLogin } from "../services/sso";
import { authenticate, parse } from "../lib/http";
import { checkSecondFactor, requestLoginCode, verifyLoginCode } from "../services/mfa";
import { issueSession, type SignInMethod } from "../services/sessions";

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
      /** The institution requires two-factor for staff and this person hasn't set it up yet. */
      mfaSetupRequired: Boolean(isStaff(roles) && tenant?.settings.requireStaffMfa && !user.totpSecretEnc),
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

/**
 * The password or sign-in code was right. Staff with two-factor on get a
 * short-lived ticket to exchange with their authenticator code; everyone else
 * gets a session straight away.
 */
async function firstFactorPassed(user: typeof users.$inferSelect, method: SignInMethod, req: FastifyRequest) {
  if (user.totpSecretEnc) return { mfaRequired: true, mfaToken: await signMfaToken(user.id, method) };
  const token = await issueSession(db, { userId: user.id, method, userAgent: req.headers["user-agent"], ip: req.ip });
  return { token, ...(await loadIdentity(user.id))!.body };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    // Slow down password guessing: per account and per address.
    await rateLimit(`login:${body.email.toLowerCase()}`, 10, 10 * 60_000);
    await rateLimit(`login-ip:${req.ip}`, 100, 10 * 60_000);
    const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase().trim()));
    // Same message for unknown email and wrong password.
    if (!user || user.status !== "active" || !(await checkPassword(body.password, user.passwordHash))) {
      throw unauthorized("Email or password is incorrect");
    }
    return firstFactorPassed(user, "password", req);
  });

  // ---------- Sign-in codes (passwordless) ----------
  app.post("/auth/otp/request", async (req) => {
    const body = parse(z.object({ email: z.string().email(), channel: z.enum(["email", "whatsapp"]).default("email") }), req.body);
    await rateLimit(`otp-request:${body.email.toLowerCase()}`, 5, 15 * 60_000, undefined, "Too many codes requested");
    await rateLimit(`otp-request-ip:${req.ip}`, 30, 15 * 60_000, undefined, "Too many codes requested");
    await requestLoginCode(db, body, app.now());
    // The same answer whether or not the account exists.
    return { sent: true };
  });

  app.post("/auth/otp/verify", async (req) => {
    const body = parse(z.object({ email: z.string().email(), code: z.string().min(4).max(12) }), req.body);
    await rateLimit(`otp-verify-ip:${req.ip}`, 60, 15 * 60_000);
    const user = await verifyLoginCode(db, body, app.now());
    return firstFactorPassed(user, "otp", req);
  });

  // ---------- Two-factor ----------
  app.post("/auth/login/2fa", async (req) => {
    const body = parse(z.object({ mfaToken: z.string(), code: z.string().min(6).max(20) }), req.body);
    let pending: { userId: string; method: string };
    try {
      pending = await verifyMfaToken(body.mfaToken);
    } catch {
      throw unauthorized("The sign-in took too long. Start again.");
    }
    await rateLimit(`2fa:${pending.userId}`, 8, 15 * 60_000, undefined, "Too many codes tried");
    const [user] = await db.select().from(users).where(eq(users.id, pending.userId));
    if (!user || user.status !== "active" || !(await checkSecondFactor(db, user, body.code, app.now()))) throw unauthorized("That code didn't match");
    const token = await issueSession(db, { userId: user.id, method: pending.method as SignInMethod, userAgent: req.headers["user-agent"], ip: req.ip });
    return { token, ...(await loadIdentity(user.id))!.body };
  });

  app.get("/me", { preHandler: authenticate }, async (req) => {
    const identity = await loadIdentity(req.auth.userId, req.auth.tenantId);
    if (!identity) throw notFound("User");
    return identity.body;
  });

  // ---------- Single sign-on ----------
  app.get("/auth/sso/start", async (req, reply) => {
    const { org } = parse(z.object({ org: z.string().min(1).max(60) }), req.query);
    // An institution on SAML goes to its SAML identity provider; otherwise OpenID Connect.
    const saml = await startSaml(db, org);
    return reply.redirect(saml ?? (await startLogin(db, org, app.now())));
  });

  app.get("/auth/sso/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    const app_ = env.PUBLIC_APP_URL.replace(/\/$/, "");
    try {
      if (q.error || !q.code || !q.state) throw new Error(q.error_description ?? q.error ?? "Sign-in was cancelled");
      const token = await finishLogin(db, { code: q.code, state: q.state }, app.now());
      // The token goes in the fragment, which browsers never send to a server or log.
      return reply.redirect(`${app_}/sso#token=${encodeURIComponent(token)}`);
    } catch (err) {
      return reply.redirect(`${app_}/login?sso_error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
    }
  });

  app.post("/auth/switch-tenant", { preHandler: authenticate }, async (req) => {
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid().nullable() }), req.body);
    const identity = await loadIdentity(req.auth.userId);
    if (!identity) throw notFound("User");
    if (tenantId === null || tenantId === identity.user.tenantId) {
      const token = await signToken({ sub: identity.user.id, tenantId: identity.user.tenantId, roles: identity.roles, sid: req.auth.sessionId! });
      return { token, ...identity.body };
    }
    const [target] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!target) throw notFound("Institution");
    if (!(await canSwitch(identity.user.id, identity.roles, identity.user.tenantId, target))) throw forbidden("You cannot manage that institution");
    await audit(db, { tenantId: target.id, actorId: identity.user.id, action: "tenant.switch_in", target: target.id });
    const token = await signToken({ sub: identity.user.id, tenantId: target.id, roles: identity.roles, sid: req.auth.sessionId! }, "4h");
    return { token, ...(await loadIdentity(identity.user.id, target.id))!.body };
  });
}
