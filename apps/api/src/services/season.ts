import { and, eq, inArray, sql } from "drizzle-orm";
import { median, targetProgress } from "@playcode/core";
import type { Db } from "../db/client";
import { placementApplications, placementDrives, placementTargets } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest } from "../lib/errors";
import { batchReport } from "./graduate-outcomes";
import type { AuthContext } from "./scope";
import { tenantUnits } from "./scope";

// The placement season at a glance: for one graduating batch, how many each
// department has placed against the target the placement cell set at the
// start of the year, how many more it needs, when the offers came and which
// companies hired the most. Placed means what the batch report counts: a
// campus offer not declined, or a verified off-campus job.

/** Top-level units (departments), which targets are set for. */
async function departments(db: Db, tenantId: string) {
  return (await tenantUnits(db, tenantId)).filter((u) => !u.parentId).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function seasonTargets(db: Db, tenantId: string, year: number) {
  const rows = await db.select().from(placementTargets).where(and(eq(placementTargets.tenantId, tenantId), eq(placementTargets.graduationYear, year)));
  return {
    institution: rows.find((r) => r.unitId === null)?.targetPct ?? null,
    departments: (await departments(db, tenantId)).map((d) => ({ ...d, targetPct: rows.find((r) => r.unitId === d.id)?.targetPct ?? null })),
  };
}

/** Replace a year's targets; a null target removes it. */
export async function setSeasonTargets(db: Db, auth: { tenantId: string; userId: string }, year: number, input: { institution: number | null; departments: { unitId: string; targetPct: number | null }[] }, now: Date) {
  const known = new Set((await departments(db, auth.tenantId)).map((d) => d.id));
  if (input.departments.some((d) => !known.has(d.unitId))) throw badRequest("Targets are set for departments");
  const values = [{ unitId: null as string | null, targetPct: input.institution }, ...input.departments].filter((t): t is { unitId: string | null; targetPct: number } => t.targetPct !== null);
  await db.transaction(async (tx) => {
    await tx.delete(placementTargets).where(and(eq(placementTargets.tenantId, auth.tenantId), eq(placementTargets.graduationYear, year)));
    if (values.length) await tx.insert(placementTargets).values(values.map((v) => ({ tenantId: auth.tenantId, graduationYear: year, unitId: v.unitId, targetPct: v.targetPct, updatedBy: auth.userId, updatedAt: now })));
  });
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.targets", data: { year, targets: values.length } });
  return seasonTargets(db, auth.tenantId, year);
}

export async function seasonDashboard(db: Db, auth: AuthContext, year: number) {
  const tenantId = auth.tenantId!;
  const [report, targets] = await Promise.all([batchReport(db, auth, year), seasonTargets(db, tenantId, year)]);
  const targetOf = new Map(targets.departments.map((d) => [d.id, d.targetPct]));
  const progress = (placed: number, graduating: number, target: number | null) => (target === null ? null : targetProgress(placed, graduating, target));

  const departmentRows = report.departments.map((d) => {
    const target = d.departmentId ? (targetOf.get(d.departmentId) ?? null) : null;
    return { department: d.department, unitId: d.departmentId, graduating: d.graduating, placed: d.placed, higherStudies: d.higherStudies, medianCtc: d.medianCtc, target, progress: progress(d.placed, d.graduating, target) };
  });

  // Campus offers to this batch, by the month of the drive.
  const ids = report.graduates.map((g) => g.id);
  const offers = ids.length
    ? await db
        .select({ month: sql<string>`to_char(${placementDrives.driveDate}::date, 'YYYY-MM')`, n: sql<number>`count(*)::int` })
        .from(placementApplications)
        .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
        .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.status, "offered"), inArray(placementApplications.userId, ids)))
        .groupBy(sql`1`)
        .orderBy(sql`1`)
    : [];
  let running = 0;
  const byMonth = offers.map((o) => ({ month: o.month, offers: o.n, total: (running += o.n) }));

  // Where the placed graduates went, campus or off campus.
  const hires = new Map<string, { company: string; hired: number; salaries: number[] }>();
  for (const g of report.graduates) {
    if (g.status !== "placed" || !g.where) continue;
    const k = g.where.trim().toLowerCase();
    const h = hires.get(k) ?? hires.set(k, { company: g.where.trim(), hired: 0, salaries: [] }).get(k)!;
    h.hired++;
    if (g.ctcRupees) h.salaries.push(g.ctcRupees);
  }
  const topRecruiters = [...hires.values()]
    .sort((a, b) => b.hired - a.hired || a.company.localeCompare(b.company))
    .slice(0, 10)
    .map((h) => ({ company: h.company, hired: h.hired, medianCtc: median(h.salaries) }));

  const [openDrives] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(placementDrives)
    .where(and(eq(placementDrives.tenantId, tenantId), eq(placementDrives.status, "open")));

  return {
    year,
    totals: { graduating: report.totals.graduating, placed: report.totals.placed, higherStudies: report.totals.higherStudies, medianCtc: report.totals.medianCtc, highestCtc: report.totals.highestCtc, target: targets.institution, progress: progress(report.totals.placed, report.totals.graduating, targets.institution) },
    departments: departmentRows,
    byMonth,
    topRecruiters,
    openDrives: openDrives?.n ?? 0,
    pendingReports: report.pendingReports,
  };
}

