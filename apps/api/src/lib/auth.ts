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
  return { sub: payload.sub!, tenantId: (payload.tenantId as string | null) ?? null, roles: (payload.roles as Role[]) ?? [] };
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
