import { and, eq } from "drizzle-orm";
import { median } from "@playcode/core";
import type { Db } from "../db/client";
import { packs, placementApplications, placementDrives } from "../db/schema";
import { notFound } from "../lib/errors";
import { readinessFor } from "./analytics";
import { experienceCounts, readExperiences } from "./experiences";
import { getTenant, tenantToday } from "./tenant";

// Company pages for students: what each company that visited the campus
// looked for, year on year. Built from the institution's own drives: roles,
// packages, rounds, how many registered and how many got offers, and the
// readiness of those who were selected, next to the write-ups seniors left.

type Ctx = { tenantId: string; userId: string; now: Date };
type Drive = typeof placementDrives.$inferSelect;

/** Selection rates are shown only with this many students in the drive, so a small drive's numbers aren't about one person. */
const MIN_FOR_RATE = 5;

const key = (company: string) => company.trim().toLowerCase();
const isOpen = (d: Drive, now: Date) => d.status === "open" && d.registerBy > now;

async function drivesWithApps(db: Db, tenantId: string) {
  const [drives, apps] = await Promise.all([
    db.select().from(placementDrives).where(eq(placementDrives.tenantId, tenantId)),
    db.select().from(placementApplications).where(eq(placementApplications.tenantId, tenantId)),
  ]);
  const byDrive = new Map<string, typeof apps>();
  for (const a of apps) if (a.status !== "withdrawn") (byDrive.get(a.driveId) ?? byDrive.set(a.driveId, []).get(a.driveId)!).push(a);
  return { drives, byDrive };
}

export async function companyList(db: Db, ctx: Ctx) {
  const [{ drives, byDrive }, { counts }] = await Promise.all([drivesWithApps(db, ctx.tenantId), experienceCounts(db, ctx.tenantId)]);
  const groups = new Map<string, Drive[]>();
  for (const d of drives) (groups.get(key(d.company)) ?? groups.set(key(d.company), []).get(key(d.company))!).push(d);
  return {
    companies: [...groups.values()]
      .map((list) => {
        const sorted = [...list].sort((a, b) => b.driveDate.localeCompare(a.driveDate));
        const latest = sorted[0]!;
        const open = sorted.find((d) => isOpen(d, ctx.now));
        const apps = list.flatMap((d) => byDrive.get(d.id) ?? []);
        return {
          company: latest.company,
          companyType: latest.companyType,
          drives: list.length,
          years: [...new Set(list.map((d) => Number(d.driveDate.slice(0, 4))))].sort((a, b) => b - a),
          lastDriveDate: latest.driveDate,
          highestCtc: Math.max(...list.map((d) => d.ctcRupees)),
          offers: apps.filter((a) => a.status === "offered").length,
          experiences: counts[key(latest.company)] ?? 0,
          openDrive: open ? { id: open.id, roleTitle: open.roleTitle, registerBy: open.registerBy } : null,
        };
      })
      .sort((a, b) => Number(Boolean(b.openDrive)) - Number(Boolean(a.openDrive)) || b.lastDriveDate.localeCompare(a.lastDriveDate)),
  };
}

export async function companyPage(db: Db, ctx: Ctx, name: string) {
  const { drives: all, byDrive } = await drivesWithApps(db, ctx.tenantId);
  const drives = all.filter((d) => key(d.company) === key(name)).sort((a, b) => b.driveDate.localeCompare(a.driveDate));
  if (!drives.length) throw notFound("Company");
  const latest = drives[0]!;
  const profile = latest.companyType === "product" ? "product" : "service";
  const tenant = await getTenant(db, ctx.tenantId);
  const [experiences, mineNow, packRows] = await Promise.all([
    readExperiences(db, ctx.tenantId, latest.company),
    readinessFor(db, [ctx.userId], tenantToday(tenant, ctx.now)),
    latest.packId ? db.select({ id: packs.id, title: packs.title }).from(packs).where(eq(packs.id, latest.packId)) : [],
  ]);
  const apps = drives.flatMap((d) => byDrive.get(d.id) ?? []);
  // Readiness of those who got offers, when they registered: a target to aim for.
  const offered = apps.filter((a) => a.status === "offered").map((a) => a.readiness[profile] ?? 0);
  const mine = await db
    .select({ driveId: placementApplications.driveId, status: placementApplications.status })
    .from(placementApplications)
    .where(and(eq(placementApplications.tenantId, ctx.tenantId), eq(placementApplications.userId, ctx.userId)));
  const exp = experiences.companies[0];
  return {
    company: latest.company,
    companyType: latest.companyType,
    readinessProfile: profile,
    drives: drives.map((d) => {
      const list = byDrive.get(d.id) ?? [];
      const offers = list.filter((a) => a.status === "offered").length;
      return {
        id: d.id,
        roleTitle: d.roleTitle,
        driveDate: d.driveDate,
        ctcRupees: d.ctcRupees,
        location: d.location,
        rounds: d.rounds,
        open: isOpen(d, ctx.now),
        registered: list.length,
        offers,
        selectionPct: list.length >= MIN_FOR_RATE && d.status !== "open" ? Math.round((offers / list.length) * 100) : null,
        mine: mine.find((m) => m.driveId === d.id && m.status !== "withdrawn")?.status ?? null,
      };
    }),
    readiness: {
      mine: mineNow.get(ctx.userId)?.[profile] ?? 0,
      // Only with three or more offers, so it isn't one person's score.
      selectedMedian: offered.length >= 3 ? median(offered) : null,
    },
    experiences: exp ? { count: exp.count, averageDifficulty: exp.averageDifficulty, selected: exp.selected } : null,
    pack: packRows[0] ?? null,
  };
}
