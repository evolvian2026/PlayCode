import type { FastifyReply, FastifyRequest } from "fastify";
import { can, type Permission } from "@playcode/core";
import type { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { verifyToken } from "./auth";
import { badRequest, forbidden, unauthorized } from "./errors";
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
  // Tokens outlive account changes, so check the account is still active (disabled or erased users are cut off at once).
  const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, claims.sub));
  if (u?.status !== "active") throw unauthorized("This account is no longer active.");
  req.auth = { userId: claims.sub, tenantId: claims.tenantId, roles: claims.roles };
}

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
