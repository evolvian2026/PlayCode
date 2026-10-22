import { and, eq, inArray } from "drizzle-orm";
import { hasInstitutionScope, type Role } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { memberships, orgUnits, users } from "../db/schema";
import { forbidden } from "../lib/errors";

// Which org units (departments, batches, sections) a staff user may see and
// act on. Institution-wide roles see everything in their tenant; HODs and
// faculty see the units they belong to and everything below them.

export interface AuthContext {
  userId: string;
  tenantId: string | null;
  roles: Role[];
}

export async function tenantUnits(db: DbOrTx, tenantId: string) {
  return db.select().from(orgUnits).where(eq(orgUnits.tenantId, tenantId));
}

export function descendants(units: { id: string; parentId: string | null }[], roots: string[]): string[] {
  const children = new Map<string, string[]>();
  for (const u of units) if (u.parentId) (children.get(u.parentId) ?? children.set(u.parentId, []).get(u.parentId)!).push(u.id);
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...out];
}

/** Org unit ids the user may act on. Platform staff without a tenant are refused. */
export async function scopedUnitIds(db: DbOrTx, auth: AuthContext): Promise<string[]> {
  if (!auth.tenantId) throw forbidden("Choose an institution first");
  const units = await tenantUnits(db, auth.tenantId);
  if (hasInstitutionScope(auth.roles)) return units.map((u) => u.id);
  const own = await db
    .select({ orgUnitId: memberships.orgUnitId })
    .from(memberships)
    .where(and(eq(memberships.userId, auth.userId), eq(memberships.tenantId, auth.tenantId)));
  // A tenant-wide membership (no unit) for a scoped role still means whole tenant.
  if (own.some((m) => m.orgUnitId === null && auth.roles.some((r) => r !== "student"))) return units.map((u) => u.id);
  return descendants(units, own.flatMap((m) => (m.orgUnitId ? [m.orgUnitId] : [])));
}

export async function assertUnitsInScope(db: DbOrTx, auth: AuthContext, unitIds: string[]): Promise<void> {
  const allowed = new Set(await scopedUnitIds(db, auth));
  const outside = unitIds.filter((id) => !allowed.has(id));
  if (outside.length) throw forbidden("Some batches or sections are outside your scope");
}

/** Student user ids with a student membership in any of the given units. */
export async function studentIdsInUnits(db: DbOrTx, tenantId: string, unitIds: string[]): Promise<string[]> {
  if (unitIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.role, "student"),
        inArray(memberships.orgUnitId, unitIds),
        eq(users.status, "active"),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Units a student belongs to, plus their ancestors (so batch-level assignments reach section members). */
export async function studentUnitIdsWithAncestors(db: DbOrTx, tenantId: string, userId: string): Promise<string[]> {
  const units = await tenantUnits(db, tenantId);
  const own = await db
    .select({ orgUnitId: memberships.orgUnitId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "student")));
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const out = new Set<string>();
  for (const m of own) {
    let id: string | null | undefined = m.orgUnitId;
    while (id && !out.has(id)) {
      out.add(id);
      id = parent.get(id);
    }
  }
  return [...out];
}
