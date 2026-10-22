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
}

export async function signToken(claims: TokenClaims, expiresIn = "12h"): Promise<string> {
  return new SignJWT({ tenantId: claims.tenantId, roles: claims.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ["HS256"] });
  // API client tokens are only valid on /v1.
  if (payload.typ === "api") throw new Error("API tokens cannot be used here");
  return { sub: payload.sub!, tenantId: (payload.tenantId as string | null) ?? null, roles: (payload.roles as Role[]) ?? [] };
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
