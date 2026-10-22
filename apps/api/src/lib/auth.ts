import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@playcode/core";
import { env } from "../env";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = "playcode";

export interface TokenClaims {
  sub: string; // user id
  tenantId: string | null;
  roles: Role[];
  /** The sign-in session (auth_sessions.id); revoking it signs this token out. */
  sid: string;
}

export async function signToken(claims: TokenClaims, expiresIn = "12h"): Promise<string> {
  return new SignJWT({ tenantId: claims.tenantId, roles: claims.roles, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ["HS256"] });
  // API client tokens (/v1) and half-finished two-factor sign-ins are not sessions.
  if (payload.typ !== undefined) throw new Error("This token cannot be used here");
  if (typeof payload.sid !== "string") throw new Error("Token has no session");
  return { sub: payload.sub!, tenantId: (payload.tenantId as string | null) ?? null, roles: (payload.roles as Role[]) ?? [], sid: payload.sid };
}

/** Proof that the first factor (password or code) passed; exchanged for a session once the second factor checks out. */
export async function signMfaToken(userId: string, method: string): Promise<string> {
  return new SignJWT({ typ: "mfa", method })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience("playcode-mfa")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyMfaToken(token: string): Promise<{ userId: string; method: string }> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: "playcode-mfa", algorithms: ["HS256"] });
  if (payload.typ !== "mfa") throw new Error("not a two-factor token");
  return { userId: payload.sub!, method: String(payload.method) };
}

export interface ApiTokenClaims {
  clientId: string; // api_clients.id
  tenantId: string;
  scopes: string[];
}

export const API_TOKEN_TTL_S = 3600;

export async function signApiToken(claims: ApiTokenClaims): Promise<string> {
  return new SignJWT({ typ: "api", tenantId: claims.tenantId, scope: claims.scopes.join(" ") })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.clientId)
    .setIssuer(ISSUER)
    .setAudience("playcode-api")
    .setIssuedAt()
    .setExpirationTime(`${API_TOKEN_TTL_S}s`)
    .sign(secret);
}

export async function verifyApiToken(token: string): Promise<ApiTokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: "playcode-api", algorithms: ["HS256"] });
  if (payload.typ !== "api") throw new Error("not an API token");
  return { clientId: payload.sub!, tenantId: payload.tenantId as string, scopes: String(payload.scope ?? "").split(" ").filter(Boolean) };
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
