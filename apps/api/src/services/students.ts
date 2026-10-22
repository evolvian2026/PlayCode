import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { memberships, users } from "../db/schema";
import { audit } from "../lib/audit";
import { hashPassword } from "../lib/auth";
import { badRequest } from "../lib/errors";
import { getTenant } from "./tenant";
import { deliverDue, emitEvent } from "./webhooks";

export interface StudentRow {
  name: string;
  email: string;
  rollNo: string | null;
  phone: string | null;
}

/** Create student accounts in a unit, within the licence's seats. Existing emails are skipped. */
export async function importStudents(db: Db, args: { tenantId: string; actorId: string | null; unitId: string; rows: StudentRow[]; defaultPassword?: string; now?: Date }) {
  const { tenantId, rows } = args;
  const tenant = await getTenant(db, tenantId);
  const invalid = rows.filter((r) => !r.name || !z.string().email().safeParse(r.email).success);
  if (invalid.length) throw badRequest(`${invalid.length} row(s) need a name and a valid email`, invalid.slice(0, 10));
  const emails = [...new Set(rows.map((r) => r.email.toLowerCase()))];
  const existing = new Set(emails.length ? (await db.select({ email: users.email }).from(users).where(inArray(users.email, emails))).map((u) => u.email) : []);
  const [{ count: used } = { count: 0 }] = await db
    .select({ count: sql<number>`count(distinct ${memberships.userId})::int` })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student")));
  const toCreate = rows.filter((r, i) => !existing.has(r.email.toLowerCase()) && rows.findIndex((x) => x.email.toLowerCase() === r.email.toLowerCase()) === i);
  if (used + toCreate.length > tenant.seats) {
    throw badRequest(`This import needs ${toCreate.length} seats but only ${Math.max(0, tenant.seats - used)} are left on your licence`);
  }
  const created: (StudentRow & { id: string; password: string })[] = [];
  let queued = 0;
  await db.transaction(async (tx) => {
    for (const r of toCreate) {
      const password = args.defaultPassword ?? randomBytes(6).toString("base64url");
      const [user] = await tx
        .insert(users)
        .values({ tenantId, name: r.name, email: r.email.toLowerCase(), rollNo: r.rollNo, phone: r.phone, passwordHash: await hashPassword(password) })
        .returning();
      await tx.insert(memberships).values({ userId: user!.id, tenantId, orgUnitId: args.unitId, role: "student" });
      created.push({ ...r, email: r.email.toLowerCase(), id: user!.id, password });
      // Written in the same transaction, so the event exists exactly when the account does.
      queued += await emitEvent(tx, tenantId, "user.created", { userId: user!.id, name: r.name, email: r.email.toLowerCase(), rollNo: r.rollNo, unitId: args.unitId }, args.now);
    }
    await audit(tx, { tenantId, actorId: args.actorId, action: "students.import", target: args.unitId, data: { created: created.length } });
  });
  if (queued) void deliverDue(db, args.now ?? new Date()).catch(() => {});
  return {
    created,
    skipped: rows.filter((r) => existing.has(r.email.toLowerCase())).map((r) => ({ email: r.email, reason: "already registered" })),
  };
}
