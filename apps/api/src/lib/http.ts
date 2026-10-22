import type { FastifyReply, FastifyRequest } from "fastify";
import { can, type Permission } from "@playcode/core";
import type { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { authSessions, tenants, users } from "../db/schema";
import { verifyToken } from "./auth";
import { badRequest, forbidden, HttpError, unauthorized } from "./errors";
import type { AuthContext } from "../services/scope";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
  interface FastifyInstance {
    now: () => Date;
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      "Invalid request",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  let claims: Awaited<ReturnType<typeof verifyToken>>;
  try {
    claims = await verifyToken(header.slice(7));
  } catch {
    throw unauthorized("Your session has expired. Please sign in again.");
  }
  // Tokens outlive account changes, so check on every request that the account is
  // active and this sign-in session hasn't been signed out (one indexed lookup).
  const [row] = await db
    .select({ status: users.status, hasTotp: sql<boolean>`${users.totpSecretEnc} is not null`, settings: tenants.settings, session: authSessions })
    .from(users)
    .leftJoin(authSessions, and(eq(authSessions.id, claims.sid), eq(authSessions.userId, users.id)))
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, claims.sub));
  if (row?.status !== "active") throw unauthorized("This account is no longer active.");
  if (!row.session || row.session.revokedAt) throw unauthorized("You were signed out on this device. Please sign in again.");
  const now = new Date();
  if (now.getTime() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
    void db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, row.session.id)).catch(() => {});
  }
  // An institution can require staff to use two-factor sign-in; until they set it up, only setup is open.
  const staff = claims.roles.some((r) => r !== "student");
  if (staff && row.settings?.requireStaffMfa && !row.hasTotp && !MFA_SETUP_ROUTES.some((p) => req.url.startsWith(p))) {
    throw new HttpError(403, "mfa_setup_required", "Your institution requires two-factor sign-in. Set it up to continue.");
  }
  req.auth = { userId: claims.sub, tenantId: claims.tenantId, roles: claims.roles, sessionId: claims.sid };
}

/** What staff can still reach before setting up two-factor sign-in. */
const MFA_SETUP_ROUTES = ["/me", "/auth/2fa", "/auth/sessions", "/auth/logout", "/auth/switch-tenant"];

export function requirePermission(permission: Permission) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!can(req.auth.roles, permission)) throw forbidden();
  };
}

/** Like requirePermission, but passes if the user has any of the permissions. */
export function requireAny(...permissions: Permission[]) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!permissions.some((p) => can(req.auth.roles, p))) throw forbidden();
  };
}

export function tenantOf(req: FastifyRequest): string {
  if (!req.auth.tenantId) throw forbidden("This action needs an institution account");
  return req.auth.tenantId;
}
