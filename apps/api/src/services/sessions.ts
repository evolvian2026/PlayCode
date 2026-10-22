import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Role } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { authSessions, memberships, users } from "../db/schema";
import { audit } from "../lib/audit";
import { signToken } from "../lib/auth";
import { notFound } from "../lib/errors";

// Every sign-in (password, code, SSO, SAML, LMS launch, drive application)
// creates a session row; the token carries its id. Signing a device out
// revokes the row, and the API refuses its token on the next request.

export type SignInMethod = (typeof authSessions.$inferInsert)["method"];

export async function rolesOf(db: DbOrTx, userId: string): Promise<Role[]> {
  return [...new Set((await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId))).map((r) => r.role as Role))];
}

export async function issueSession(
  db: DbOrTx,
  args: { userId: string; method: SignInMethod; tenantId?: string | null; userAgent?: string | null; ip?: string | null },
): Promise<string> {
  const [user] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, args.userId));
  if (!user) throw notFound("User");
  const [session] = await db
    .insert(authSessions)
    .values({ userId: args.userId, method: args.method, userAgent: args.userAgent?.slice(0, 300) ?? null, ip: args.ip ?? null })
    .returning({ id: authSessions.id });
  return signToken({ sub: args.userId, tenantId: args.tenantId === undefined ? user.tenantId : args.tenantId, roles: await rolesOf(db, args.userId), sid: session!.id });
}

export async function listSessions(db: DbOrTx, userId: string, currentId: string) {
  const rows = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .orderBy(desc(authSessions.lastSeenAt))
    .limit(50);
  return rows.map((s) => ({ id: s.id, method: s.method, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === currentId }));
}

export async function revokeSession(db: DbOrTx, userId: string, sessionId: string, now: Date) {
  const [row] = await db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning();
  if (!row) throw notFound("Session");
}

/** Sign out everywhere (optionally except the current device). */
export async function revokeAll(db: DbOrTx, userId: string, now: Date, except?: string) {
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), except ? ne(authSessions.id, except) : undefined))
    .returning({ id: authSessions.id });
  const [u] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId));
  await audit(db, { tenantId: u?.tenantId ?? null, actorId: userId, action: "auth.sign_out_all", data: { sessions: rows.length } });
  return rows.length;
}
