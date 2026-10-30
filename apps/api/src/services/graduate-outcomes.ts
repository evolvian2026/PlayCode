import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { GRADUATE_STATUSES, graduateStatus, median, OUTCOME_KINDS, type GraduateStatus, type OutcomeKind } from "@playcode/core";
import type { Db } from "../db/client";
import { academicRecords, memberships, placementApplications, placementDrives, studentOutcomes, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Graduate outcomes beyond campus drives. Students report a job found off
// campus, an admission for higher studies, a qualifying exam or a startup; the
// placement cell checks the offer letter or admission letter and verifies it.
// Only verified reports count. The batch report then gives, for one
// graduating year, how many were placed, went on to higher studies or started
// a company, with salaries: the figures NIRF and NAAC ask for.

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof studentOutcomes.$inferSelect;

export interface OutcomeInput {
  kind: OutcomeKind;
  organisation: string;
  detail: string;
  ctcRupees: number | null;
  outcomeDate: string;
}

const view = (o: Row) => ({
  id: o.id,
  kind: o.kind,
  kindLabel: OUTCOME_KINDS[o.kind].label,
  organisation: o.organisation,
  detail: o.detail,
  ctcRupees: o.ctcRupees,
  outcomeDate: o.outcomeDate,
  status: o.status,
  reviewNote: o.reviewNote,
  updatedAt: o.updatedAt,
});

function clean(input: OutcomeInput, today: string): OutcomeInput {
  if (input.outcomeDate > today) throw badRequest("The date can't be in the future");
  if (input.kind === "job" && !input.ctcRupees) throw badRequest("Enter the offered CTC");
  return { ...input, organisation: input.organisation.trim(), detail: input.detail.trim(), ctcRupees: input.kind === "job" ? input.ctcRupees : null };
}

// ---------- Students ----------

/** A student's own reports, and the campus offers already on record (which need no report). */
export async function myOutcomes(db: Db, ctx: Ctx) {
  const [rows, campus] = await Promise.all([
    db.select().from(studentOutcomes).where(and(eq(studentOutcomes.tenantId, ctx.tenantId), eq(studentOutcomes.userId, ctx.userId))).orderBy(desc(studentOutcomes.outcomeDate)),
    db
      .select({ company: placementDrives.company, roleTitle: placementDrives.roleTitle, ctcRupees: placementApplications.offerCtcRupees, driveDate: placementDrives.driveDate })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .where(and(eq(placementApplications.tenantId, ctx.tenantId), eq(placementApplications.userId, ctx.userId), eq(placementApplications.status, "offered"), sql`${placementApplications.joiningStatus} is distinct from 'revoked'`)),
  ]);
  return { outcomes: rows.map(view), campusOffers: campus };
}

export async function reportOutcome(db: Db, ctx: Ctx, input: OutcomeInput) {
  const tenant = await getTenant(db, ctx.tenantId);
  const mine = await db.select({ id: studentOutcomes.id }).from(studentOutcomes).where(and(eq(studentOutcomes.tenantId, ctx.tenantId), eq(studentOutcomes.userId, ctx.userId)));
  if (mine.length >= 20) throw badRequest("That's a lot of reports: ask your placement cell to tidy up the old ones first");
  const [o] = await db
    .insert(studentOutcomes)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, ...clean(input, tenantToday(tenant, ctx.now)), createdAt: ctx.now, updatedAt: ctx.now })
    .returning();
  return view(o!);
}

async function loadMine(db: Db, ctx: Ctx, id: string) {
  const [o] = await db.select().from(studentOutcomes).where(and(eq(studentOutcomes.id, id), eq(studentOutcomes.tenantId, ctx.tenantId)));
  if (!o || o.userId !== ctx.userId) throw notFound("Report");
  return o;
}

/** Changing a report sends it back to the placement cell, even if it was verified. */
export async function updateOutcome(db: Db, ctx: Ctx, id: string, input: OutcomeInput) {
  await loadMine(db, ctx, id);
  const tenant = await getTenant(db, ctx.tenantId);
  const [o] = await db
    .update(studentOutcomes)
    .set({ ...clean(input, tenantToday(tenant, ctx.now)), status: "pending", reviewNote: null, reviewedBy: null, reviewedAt: null, updatedAt: ctx.now })
    .where(eq(studentOutcomes.id, id))
    .returning();
  return view(o!);
}

/** Students can withdraw a report until it's verified; after that it's part of the institution's record. */
export async function deleteOutcome(db: Db, ctx: Ctx, id: string) {
  const o = await loadMine(db, ctx, id);
  if (o.status === "verified") throw conflict("outcome_verified", "This is verified. Ask your placement cell if it needs to be removed.");
  await db.delete(studentOutcomes).where(eq(studentOutcomes.id, id));
  return { ok: true };
}

// ---------- Placement cell ----------

async function studentsInScope(db: Db, auth: AuthContext) {
  return new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth), { graduated: true }));
}

export async function outcomeQueue(db: Db, auth: AuthContext, status: Row["status"]) {
  const scope = await studentsInScope(db, auth);
  const rows = (
    await db
      .select({ o: studentOutcomes, name: users.name, rollNo: users.rollNo })
      .from(studentOutcomes)
      .innerJoin(users, eq(users.id, studentOutcomes.userId))
      .where(and(eq(studentOutcomes.tenantId, auth.tenantId!), eq(studentOutcomes.status, status)))
      .orderBy(status === "pending" ? studentOutcomes.updatedAt : desc(studentOutcomes.updatedAt))
  ).filter((r) => scope.has(r.o.userId));
  return { outcomes: rows.slice(0, 200).map((r) => ({ ...view(r.o), student: { id: r.o.userId, name: r.name, rollNo: r.rollNo } })), total: rows.length };
}

export async function reviewOutcome(db: Db, auth: AuthContext, id: string, decision: { verify: boolean; note: string | null }, now: Date) {
  const [o] = await db.select().from(studentOutcomes).where(and(eq(studentOutcomes.id, id), eq(studentOutcomes.tenantId, auth.tenantId!)));
  if (!o || !(await studentsInScope(db, auth)).has(o.userId)) throw notFound("Report");
  if (!decision.verify && !decision.note?.trim()) throw badRequest("Tell the student what's missing");
  await db
    .update(studentOutcomes)
    .set({ status: decision.verify ? "verified" : "rejected", reviewNote: decision.verify ? null : decision.note!.trim(), reviewedBy: auth.userId, reviewedAt: now })
    .where(eq(studentOutcomes.id, o.id));
  await enqueue(db, [
    {
      tenantId: o.tenantId,
      userId: o.userId,
      template: "placement",
      title: decision.verify ? `${o.organisation}: verified by your placement cell` : `${o.organisation}: your placement cell needs more`,
      body: decision.verify ? "It now counts in your batch's results. Congratulations!" : decision.note!.trim(),
      link: appLink("/play/outcomes"),
      dedupeKey: `outcome:${o.id}:${o.updatedAt.getTime()}:${decision.verify ? "verified" : "rejected"}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: o.tenantId, actorId: auth.userId, action: decision.verify ? "outcome.verify" : "outcome.reject", target: o.id });
  return { ok: true };
}

// ---------- Batch report ----------

/** Graduating years on record, newest first. */
export async function graduationYears(db: Db, tenantId: string) {
  const rows = await db.selectDistinct({ year: academicRecords.graduationYear }).from(academicRecords).where(eq(academicRecords.tenantId, tenantId));
  return rows.map((r) => r.year).filter((y): y is number => y !== null).sort((a, b) => b - a);
}

interface Graduate {
  id: string;
  name: string;
  rollNo: string | null;
  department: string;
  /** The department's unit, if the student is in one. */
  departmentId: string | null;
  status: GraduateStatus;
  /** Best offer (campus or verified off-campus), annual CTC in rupees. */
  ctcRupees: number | null;
  where: string;
  campus: boolean;
  exams: string[];
}

/**
 * Outcomes of the students graduating in a year (by their academic record),
 * per department. Each graduate counts once; only verified reports count, and
 * the report says how many are still waiting.
 */
export async function batchReport(db: Db, auth: AuthContext, year: number) {
  const tenant = await getTenant(db, auth.tenantId!);
  const scope = await studentsInScope(db, auth);
  const ids = (await db.select({ userId: academicRecords.userId }).from(academicRecords).where(and(eq(academicRecords.tenantId, tenant.id), eq(academicRecords.graduationYear, year)))).map((r) => r.userId).filter((id) => scope.has(id));
  const empty = ids.length === 0;
  const [people, offers, reports, member, units] = await Promise.all([
    empty ? [] : db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)),
    empty
      ? []
      : db
          .select({ userId: placementApplications.userId, ctc: placementApplications.offerCtcRupees, company: placementDrives.company, decision: placementApplications.decision })
          .from(placementApplications)
          .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
          // A withdrawn offer isn't a placement.
          .where(and(eq(placementApplications.tenantId, tenant.id), eq(placementApplications.status, "offered"), sql`${placementApplications.joiningStatus} is distinct from 'revoked'`, inArray(placementApplications.userId, ids))),
    empty ? [] : db.select().from(studentOutcomes).where(and(eq(studentOutcomes.tenantId, tenant.id), inArray(studentOutcomes.userId, ids))),
    empty ? [] : db.select({ userId: memberships.userId, unitId: memberships.orgUnitId }).from(memberships).where(and(eq(memberships.tenantId, tenant.id), eq(memberships.role, "student"), inArray(memberships.userId, ids))),
    tenantUnits(db, tenant.id),
  ]);

  // Department: the top-level unit a student belongs to.
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const name = new Map(units.map((u) => [u.id, u.name]));
  const rootOf = (id: string) => {
    let cur = id;
    while (parent.get(cur)) cur = parent.get(cur)!;
    return cur;
  };
  const dept = new Map<string, string>();
  for (const m of member) if (m.unitId) dept.set(m.userId, rootOf(m.unitId));

  const verified = reports.filter((r) => r.status === "verified");
  const graduates: Graduate[] = people.map((p) => {
    // A declined offer isn't where the graduate went.
    const campus = offers.filter((o) => o.userId === p.id && o.decision !== "declined");
    const jobs = verified.filter((r) => r.userId === p.id && r.kind === "job");
    const study = verified.find((r) => r.userId === p.id && r.kind === "higher_studies");
    const startup = verified.find((r) => r.userId === p.id && r.kind === "startup");
    const status = graduateStatus({ offer: campus.length + jobs.length > 0, higherStudies: Boolean(study), startup: Boolean(startup) });
    // The offer they accepted, else the best one.
    const allOffers = [...campus.map((o) => ({ ctc: o.ctc ?? 0, where: o.company, campus: true, accepted: o.decision === "accepted" })), ...jobs.map((j) => ({ ctc: j.ctcRupees ?? 0, where: j.organisation, campus: false, accepted: false }))].sort(
      (a, b) => Number(b.accepted) - Number(a.accepted) || b.ctc - a.ctc,
    );
    const best = allOffers[0];
    return {
      id: p.id,
      name: p.name,
      rollNo: p.rollNo,
      department: name.get(dept.get(p.id) ?? "") ?? "Other",
      departmentId: dept.get(p.id) ?? null,
      status,
      ctcRupees: status === "placed" && best?.ctc ? best.ctc : null,
      where: status === "placed" ? best!.where : status === "higher_studies" ? `${study!.organisation}${study!.detail ? `, ${study!.detail}` : ""}` : status === "startup" ? startup!.organisation : "",
      campus: status === "placed" && campus.length > 0,
      exams: verified.filter((r) => r.userId === p.id && r.kind === "exam").map((r) => r.organisation),
    };
  });
  graduates.sort((a, b) => a.department.localeCompare(b.department) || (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));

  const summarise = (list: Graduate[]) => {
    const placed = list.filter((g) => g.status === "placed");
    const salaries = placed.map((g) => g.ctcRupees).filter((c): c is number => c !== null);
    const count = (s: GraduateStatus) => list.filter((g) => g.status === s).length;
    return {
      graduating: list.length,
      placed: placed.length,
      placedOnCampus: placed.filter((g) => g.campus).length,
      placedOffCampus: placed.filter((g) => !g.campus).length,
      higherStudies: count("higher_studies"),
      startup: count("startup"),
      notKnown: count("not_known"),
      medianCtc: median(salaries),
      highestCtc: salaries.length ? Math.max(...salaries) : null,
    };
  };
  const departments = [...new Set(graduates.map((g) => g.department))].map((d) => {
    const list = graduates.filter((g) => g.department === d);
    return { department: d, departmentId: list[0]!.departmentId, ...summarise(list) };
  });
  const examCounts = new Map<string, number>();
  for (const g of graduates) for (const e of new Set(g.exams)) examCounts.set(e, (examCounts.get(e) ?? 0) + 1);

  return {
    institution: tenant.name,
    year,
    departments,
    totals: summarise(graduates),
    exams: [...examCounts].map(([exam, students]) => ({ exam, students })).sort((a, b) => b.students - a.students || a.exam.localeCompare(b.exam)),
    pendingReports: reports.filter((r) => r.status === "pending").length,
    graduates,
  };
}

const csvCell = (v: unknown) => {
  const t = String(v ?? "");
  return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
};

export function batchCsv(r: Awaited<ReturnType<typeof batchReport>>): string {
  const lakhs = (v: number | null) => (v === null ? "" : Math.round(v / 1000) / 100);
  const rows: unknown[][] = [
    ["Graduate outcomes", r.institution, `Graduating in ${r.year}`],
    [],
    ["Department", "Graduating", "Placed", "Placed on campus", "Placed off campus", "Higher studies", "Entrepreneurship", "Not known", "Median salary (LPA)", "Highest salary (LPA)"],
    ...[...r.departments, { department: "Total", ...r.totals }].map((d) => [d.department, d.graduating, d.placed, d.placedOnCampus, d.placedOffCampus, d.higherStudies, d.startup, d.notKnown, lakhs(d.medianCtc), lakhs(d.highestCtc)]),
    [],
    ["Qualifying exam", "Students"],
    ...r.exams.map((e) => [e.exam, e.students]),
    [],
    ["Roll no", "Name", "Department", "Outcome", "Where", "On campus", "Salary (LPA)", "Exams cleared"],
    ...r.graduates.map((g) => [g.rollNo, g.name, g.department, GRADUATE_STATUSES[g.status], g.where, g.status === "placed" ? (g.campus ? "Yes" : "No") : "", lakhs(g.ctcRupees), g.exams.join("; ")]),
  ];
  if (r.pendingReports) rows.splice(1, 0, [`${r.pendingReports} reports waiting for verification are not counted`]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

