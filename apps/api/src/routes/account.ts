import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authSessions, memberships, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { checkSecondFactor, confirmTotpSetup, disableTotp, otpChannelsAvailable, startTotpSetup } from "../services/mfa";
import { samlLogoutUrl } from "../services/saml";
import { listSessions, revokeAll, revokeSession } from "../services/sessions";
import { getTenant } from "../services/tenant";

/** A signed-in person's own security: devices, two-factor; and the institution's policy. */
export async function accountRoutes(app: FastifyInstance) {
  app.get("/auth/otp/channels", async () => otpChannelsAvailable());

  app.register(async (r) => {
    r.addHook("preHandler", authenticate);
    const me = async (userId: string) => (await db.select().from(users).where(eq(users.id, userId)))[0]!;

    // ---------- Devices ----------
    r.get("/auth/sessions", async (req) => ({ sessions: await listSessions(db, req.auth.userId, req.auth.sessionId!) }));
    r.post("/auth/sessions/:id/revoke", async (req) => {
      await revokeSession(db, req.auth.userId, parse(z.object({ id: z.string().uuid() }), req.params).id, app.now());
      return { ok: true };
    });
    r.post("/auth/sessions/revoke-others", async (req) => ({ revoked: await revokeAll(db, req.auth.userId, app.now(), req.auth.sessionId) }));
    r.post("/auth/logout", async (req) => {
      const [session] = await db.select({ saml: authSessions.saml }).from(authSessions).where(eq(authSessions.id, req.auth.sessionId!));
      await revokeSession(db, req.auth.userId, req.auth.sessionId!, app.now());
      // Signed in through SAML with single logout: the browser goes on to the IdP to end that session too.
      return { ok: true, redirect: await samlLogoutUrl(db, session?.saml ?? null) };
    });

    // ---------- Two-factor ----------
    r.get("/auth/2fa", async (req) => {
      const u = await me(req.auth.userId);
      const tenant = u.tenantId ? await getTenant(db, u.tenantId) : null;
      return {
        enabled: Boolean(u.totpSecretEnc),
        required: Boolean(tenant?.settings.requireStaffMfa && req.auth.roles.some((x) => x !== "student")),
        recoveryCodesLeft: u.recoveryCodes.length,
      };
    });
    r.post("/auth/2fa/setup", async (req) => startTotpSetup(db, await me(req.auth.userId)));
    r.post("/auth/2fa/enable", async (req) => {
      await rateLimit(`2fa-setup:${req.auth.userId}`, 10, 15 * 60_000, undefined, "Too many codes tried");
      const { code } = parse(z.object({ code: z.string().min(6).max(8) }), req.body);
      return confirmTotpSetup(db, await me(req.auth.userId), code, app.now());
    });
    r.post("/auth/2fa/disable", async (req) => {
      await rateLimit(`2fa:${req.auth.userId}`, 8, 15 * 60_000, undefined, "Too many codes tried");
      const { code } = parse(z.object({ code: z.string().min(6).max(20) }), req.body);
      const u = await me(req.auth.userId);
      const tenant = u.tenantId ? await getTenant(db, u.tenantId) : null;
      if (tenant?.settings.requireStaffMfa && req.auth.roles.some((x) => x !== "student")) throw forbidden("Your institution requires two-factor sign-in for staff");
      if (!(await checkSecondFactor(db, u, code, app.now()))) throw badRequest("That code didn't match");
      await disableTotp(db, u, u.id);
      return { ok: true };
    });

    // ---------- Institution policy ----------
    r.get("/console/security", { preHandler: requirePermission("tenant.settings") }, async (req) => {
      const tenantId = tenantOf(req);
      const tenant = await getTenant(db, tenantId);
      const [counts] = await db
        .select({
          staff: sql<number>`count(distinct ${users.id})::int`,
          withTwoFactor: sql<number>`count(distinct ${users.id}) filter (where ${users.totpSecretEnc} is not null)::int`,
        })
        .from(users)
        .innerJoin(memberships, and(eq(memberships.userId, users.id), ne(memberships.role, "student")))
        .where(and(eq(users.tenantId, tenantId), eq(users.status, "active")));
      return { requireStaffMfa: Boolean(tenant.settings.requireStaffMfa), staff: counts?.staff ?? 0, staffWithTwoFactor: counts?.withTwoFactor ?? 0 };
    });

    r.put("/console/security", { preHandler: requirePermission("tenant.settings") }, async (req) => {
      const tenantId = tenantOf(req);
      const { requireStaffMfa } = parse(z.object({ requireStaffMfa: z.boolean() }), req.body);
      // Otherwise the admin would be locked out of the page that turns it off again.
      if (requireStaffMfa && !(await me(req.auth.userId)).totpSecretEnc) throw badRequest("Set up two-factor sign-in for yourself first");
      await db
        .update(tenants)
        .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ requireStaffMfa })}::jsonb` })
        .where(eq(tenants.id, tenantId));
      await audit(db, { tenantId, actorId: req.auth.userId, action: "settings.security", data: { requireStaffMfa } });
      return { requireStaffMfa };
    });

    // A staff member lost their phone and their recovery codes: an admin turns two-factor off for them.
    r.post("/console/users/:id/reset-2fa", { preHandler: requirePermission("users.manage") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantOf(req)), isNotNull(users.totpSecretEnc)));
      if (!target) throw notFound("Account with two-factor sign-in");
      if (target.id === req.auth.userId) throw badRequest("Turn your own two-factor sign-in off from your account page");
      await disableTotp(db, target, req.auth.userId);
      await revokeAll(db, target.id, app.now());
      return { ok: true };
    });
  });
}
