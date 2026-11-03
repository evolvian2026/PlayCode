import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { db, pool } from "../db/client";
import { memberships, users } from "../db/schema";
import { hashPassword } from "../lib/auth";

// The first PlayCode super admin on a new deployment. The password is random
// and printed once; the admin signs in, sets up two-factor sign-in (required
// for staff) and changes it. Re-running for an existing email does nothing, so
// the script can't be used to take over an account.

export async function createSuperAdmin(database: Db, args: { email: string; name: string }): Promise<{ created: false } | { created: true; password: string }> {
  const email = args.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Give a valid email address");
  const [existing] = await database.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return { created: false };
  const password = randomBytes(18).toString("base64url");
  const [user] = await database.insert(users).values({ tenantId: null, name: args.name, email, passwordHash: await hashPassword(password) }).returning();
  await database.insert(memberships).values({ userId: user!.id, tenantId: null, orgUnitId: null, role: "super_admin" });
  return { created: true, password };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [email, ...name] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: pnpm --filter @playcode/api admin:create <email> [name]");
    process.exit(1);
  }
  const res = await createSuperAdmin(db, { email, name: name.join(" ") || "PlayCode Admin" });
  console.log(res.created ? `Created super admin ${email}. Password (shown once): ${res.password}` : `${email} already exists; nothing changed.`);
  await pool.end();
}
