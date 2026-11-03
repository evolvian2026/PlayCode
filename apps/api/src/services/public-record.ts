import { eq, sql } from "drizzle-orm";
import { planHas } from "@playcode/core";
import type { Db } from "../db/client";
import { tenants } from "../db/schema";
import { audit } from "../lib/audit";
import { notFound } from "../lib/errors";
import { effectiveBranding } from "./branding";
import { batchReport, graduationYears } from "./graduate-outcomes";
import { getTenant, tenantToday } from "./tenant";

// The institution's placement record on a public page, if it chooses to
// publish one: for parents, applicants and recruiters, the same figures the
// batch report gives, as totals only. No student is named, and numbers too
// small to hide anyone are left out.

/** Fewer graduates than this in a batch or department and its figures aren't shown. */
export const MIN_PUBLIC_GROUP = 10;
const YEARS_SHOWN = 3;

export async function setPublicRecord(db: Db, auth: { tenantId: string; userId: string }, enabled: boolean) {
  await db
    .update(tenants)
    .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ publicRecord: enabled })}::jsonb` })
    .where(eq(tenants.id, auth.tenantId));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: enabled ? "placements.record_published" : "placements.record_unpublished" });
  const t = await getTenant(db, auth.tenantId);
  return { enabled, slug: t.slug };
}

export async function publicRecordSetting(db: Db, tenantId: string) {
  const t = await getTenant(db, tenantId);
  return { enabled: Boolean(t.settings.publicRecord), slug: t.slug };
}

export async function publicRecord(db: Db, slug: string, now: Date) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
  if (!tenant || !tenant.settings.publicRecord || !planHas(tenant.plan, "placements")) throw notFound("Placement record");
  const today = tenantToday(tenant, now);
  // Batches graduating after this year's July are still in their season.
  const firstOpen = Number(today.slice(0, 4)) + (today.slice(5, 7) >= "07" ? 1 : 0);
  // Read as the institution as a whole: no user, every department.
  const auth = { tenantId: tenant.id, userId: "00000000-0000-0000-0000-000000000000", roles: ["inst_admin" as const] };
  const batches = [];
  for (const year of (await graduationYears(db, tenant.id)).slice(0, YEARS_SHOWN)) {
    const r = await batchReport(db, auth, year);
    const t = r.totals;
    if (t.graduating < MIN_PUBLIC_GROUP) continue;
    const hires = new Map<string, { company: string; n: number }>();
    for (const g of r.graduates) {
      if (g.status !== "placed" || !g.where) continue;
      const k = g.where.trim().toLowerCase();
      (hires.get(k) ?? hires.set(k, { company: g.where.trim(), n: 0 }).get(k)!).n++;
    }
    batches.push({
      year,
      inProgress: year >= firstOpen,
      graduating: t.graduating,
      placed: t.placed,
      placedPct: Math.round((t.placed / t.graduating) * 100),
      higherStudies: t.higherStudies,
      startup: t.startup,
      medianCtc: t.medianCtc,
      highestCtc: t.highestCtc,
      departments: r.departments
        .filter((d) => d.graduating >= MIN_PUBLIC_GROUP)
        .map((d) => ({ department: d.department, graduating: d.graduating, placedPct: Math.round((d.placed / d.graduating) * 100), medianCtc: d.medianCtc })),
      departmentsHidden: r.departments.filter((d) => d.graduating < MIN_PUBLIC_GROUP).length,
      recruiters: [...hires.values()].sort((a, b) => b.n - a.n || a.company.localeCompare(b.company)).map((h) => h.company),
    });
  }
  const branding = await effectiveBranding(db, tenant);
  return { institution: tenant.name, logoUrl: branding.logoUrl, primaryColor: branding.primaryColor, asOf: today, minGroup: MIN_PUBLIC_GROUP, batches };
}
