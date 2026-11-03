import { eq } from "drizzle-orm";
import { DEFAULT_STREAK_RULES, localDate, type StreakRules } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { tenants } from "../db/schema";
import { notFound } from "../lib/errors";

export async function getTenant(db: DbOrTx, tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound("Institution");
  return tenant;
}

export function tenantToday(tenant: { timeZone: string }, now: Date): string {
  return localDate(now, tenant.timeZone);
}

export function streakRules(tenant: { settings: { weekendsOptional?: boolean } }): StreakRules {
  return { ...DEFAULT_STREAK_RULES, weekendsOptional: tenant.settings.weekendsOptional ?? false };
}
