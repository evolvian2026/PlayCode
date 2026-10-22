import { randomInt } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { certificates, tenants, users } from "../db/schema";
import { effectiveBranding } from "./branding";

// Letters and digits that cannot be confused when read aloud or typed from paper.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function certificateCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Issue (or improve the score on) a mission certificate. Safe to call on every pass. */
export async function issueMissionCertificate(
  db: DbOrTx,
  args: { tenantId: string; userId: string; packId: string; title: string; scorePct: number; now: Date },
): Promise<string> {
  const [row] = await db
    .insert(certificates)
    .values({ code: certificateCode(), tenantId: args.tenantId, userId: args.userId, kind: "mission", refId: args.packId, title: args.title, scorePct: args.scorePct, issuedAt: args.now })
    .onConflictDoUpdate({
      target: [certificates.userId, certificates.kind, certificates.refId],
      set: { scorePct: sql`greatest(${certificates.scorePct}, ${args.scorePct})` },
    })
    .returning({ code: certificates.code });
  return row!.code;
}

export async function userCertificates(db: DbOrTx, userId: string) {
  return db
    .select({ code: certificates.code, title: certificates.title, scorePct: certificates.scorePct, issuedAt: certificates.issuedAt, revokedAt: certificates.revokedAt })
    .from(certificates)
    .where(eq(certificates.userId, userId))
    .orderBy(desc(certificates.issuedAt));
}

/** Public verification: what an employer sees when they open the link or scan the QR code. */
export async function verifyCertificate(db: DbOrTx, code: string) {
  const [row] = await db
    .select({ cert: certificates, name: users.name, tenant: tenants })
    .from(certificates)
    .innerJoin(users, eq(users.id, certificates.userId))
    .innerJoin(tenants, eq(tenants.id, certificates.tenantId))
    .where(and(eq(certificates.code, code.toUpperCase())));
  if (!row) return { valid: false as const };
  const brand = await effectiveBranding(db, row.tenant);
  return {
    valid: row.cert.revokedAt === null,
    revoked: row.cert.revokedAt !== null,
    code: row.cert.code,
    holder: row.name,
    title: row.cert.title,
    scorePct: row.cert.scorePct,
    issuedAt: row.cert.issuedAt,
    institution: row.tenant.name,
    branding: brand,
  };
}
