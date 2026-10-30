import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { addDays, DRIVE_ROUND_DAYS, localDate, ON_DUTY_DAYS_AHEAD, ON_DUTY_DAYS_BACK, ON_DUTY_PARTS, onDutyDateError, onDutyRef, partsOverlap, type OnDutyPart, type OnDutyReason } from "@playcode/core";
import type { Db } from "../db/client";
import { driveCheckIns, memberships, onDutyRequests, openingResponses, placementApplications, placementDrives, placementOpenings, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { effectiveBranding } from "./branding";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// On duty. A student misses class for a campus drive, an off-campus
// interview or a placement event; they ask, the placement cell approves (or
// it's approved at once when they reported at the drive desk that day), the
// class teacher sees who is on duty on a day, and the student downloads a
// letter.

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof onDutyRequests.$inferSelect;

export interface OnDutyInput {
  date: string;
  part: OnDutyPart;
  reason: OnDutyReason;
  driveId: string | null;
  openingId: string | null;
  /** For "other": what it is. */
  purpose: string;
  detail: string;
}

const view = (r: Row, today: string) => ({
  id: r.id,
  ref: onDutyRef(r.id),
  date: r.date,
  part: r.part,
  partLabel: ON_DUTY_PARTS[r.part],
  reason: r.reason,
  purpose: r.purpose,
  detail: r.detail,
  status: r.status,
  note: r.note,
  decidedAt: r.decidedAt,
  canCancel: r.status === "pending" || (r.status === "approved" && r.date >= today),
});

// ---------- Students ----------

export async function myOnDuty(db: Db, ctx: Ctx) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const from = addDays(today, -ON_DUTY_DAYS_BACK);
  const to = addDays(today, ON_DUTY_DAYS_AHEAD);
  const [rows, drives, openings] = await Promise.all([
    db.select().from(onDutyRequests).where(eq(onDutyRequests.userId, ctx.userId)).orderBy(asc(onDutyRequests.date)),
    // Drives they registered for whose day (or later rounds) falls in the window.
    db
      .select({ id: placementDrives.id, company: placementDrives.company, roleTitle: placementDrives.roleTitle, driveDate: placementDrives.driveDate })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .where(and(eq(placementApplications.userId, ctx.userId), ne(placementApplications.status, "withdrawn"), gte(placementDrives.driveDate, addDays(from, -DRIVE_ROUND_DAYS)), lte(placementDrives.driveDate, to)))
      .orderBy(asc(placementDrives.driveDate)),
    // Openings they said they applied to, not long closed.
    db
      .select({ id: placementOpenings.id, company: placementOpenings.company, roleTitle: placementOpenings.roleTitle })
      .from(openingResponses)
      .innerJoin(placementOpenings, eq(placementOpenings.id, openingResponses.openingId))
      .where(and(eq(openingResponses.userId, ctx.userId), eq(openingResponses.response, "applied"), gte(placementOpenings.closesOn, addDays(today, -60))))
      .orderBy(asc(placementOpenings.company)),
  ]);
  return {
    today,
    window: { from, to },
    upcoming: rows.filter((r) => r.date >= today && r.status !== "cancelled").map((r) => view(r, today)),
    past: rows
      .filter((r) => r.date < today && r.status !== "cancelled")
      .reverse()
      .slice(0, 20)
      .map((r) => view(r, today)),
    drives,
    openings,
  };
}

export async function askOnDuty(db: Db, ctx: Ctx, input: OnDutyInput) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  let purpose: string;
  let driveId: string | null = null;
  let openingId: string | null = null;
  let driveDate: string | undefined;
  if (input.reason === "drive") {
    const [d] = await db
      .select({ id: placementDrives.id, company: placementDrives.company, roleTitle: placementDrives.roleTitle, driveDate: placementDrives.driveDate, status: placementApplications.status })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .where(and(eq(placementApplications.userId, ctx.userId), eq(placementApplications.driveId, input.driveId ?? "00000000-0000-0000-0000-000000000000")));
    if (!d || d.status === "withdrawn") throw badRequest("Choose a drive you registered for");
    purpose = `${d.company} campus drive (${d.roleTitle})`;
    driveId = d.id;
    driveDate = d.driveDate;
  } else if (input.reason === "opening") {
    const [o] = await db
      .select({ id: placementOpenings.id, company: placementOpenings.company, roleTitle: placementOpenings.roleTitle })
      .from(openingResponses)
      .innerJoin(placementOpenings, eq(placementOpenings.id, openingResponses.openingId))
      .where(and(eq(openingResponses.userId, ctx.userId), eq(openingResponses.openingId, input.openingId ?? "00000000-0000-0000-0000-000000000000"), eq(openingResponses.response, "applied")));
    if (!o) throw badRequest("Choose an opening you applied to");
    purpose = `${o.company} off-campus selection (${o.roleTitle})`;
    openingId = o.id;
  } else {
    purpose = input.purpose.trim();
    if (purpose.length < 5) throw badRequest("Say what it's for, like the hackathon or interview and where");
  }
  const err = onDutyDateError(input.date, today, driveDate);
  if (err) throw badRequest(err);

  const sameDay = await db
    .select()
    .from(onDutyRequests)
    .where(and(eq(onDutyRequests.userId, ctx.userId), eq(onDutyRequests.date, input.date), inArray(onDutyRequests.status, ["pending", "approved"])));
  if (sameDay.some((r) => partsOverlap(r.part, input.part))) throw conflict("on_duty_exists", "You've already asked for on duty then");

  // Reporting at the drive desk that day is proof enough: no need to wait.
  let checkedIn = false;
  if (driveId) {
    const [c] = await db.select().from(driveCheckIns).where(and(eq(driveCheckIns.driveId, driveId), eq(driveCheckIns.userId, ctx.userId)));
    checkedIn = Boolean(c && localDate(c.reportedAt, tenant.timeZone) === input.date);
  }
  await db.insert(onDutyRequests).values({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    date: input.date,
    part: input.part,
    reason: input.reason,
    driveId,
    openingId,
    purpose,
    detail: input.detail.trim(),
    status: checkedIn ? "approved" : "pending",
    note: checkedIn ? "Reported at the drive desk" : null,
    decidedAt: checkedIn ? ctx.now : null,
    createdAt: ctx.now,
  });
  return myOnDuty(db, ctx);
}

export async function cancelOnDuty(db: Db, ctx: Ctx, id: string) {
  const [r] = await db.select().from(onDutyRequests).where(and(eq(onDutyRequests.id, id), eq(onDutyRequests.userId, ctx.userId)));
  if (!r) throw notFound("Request");
  const today = tenantToday(await getTenant(db, ctx.tenantId), ctx.now);
  if (!view(r, today).canCancel) throw badRequest("This can't be called off now");
  await db.update(onDutyRequests).set({ status: "cancelled" }).where(eq(onDutyRequests.id, id));
  return myOnDuty(db, ctx);
}

// ---------- Placement cell and class teachers ----------

async function studentsInScope(db: Db, auth: AuthContext) {
  const tenantId = auth.tenantId!;
  return describeStudents(db, tenantId, await studentIdsInUnits(db, tenantId, await scopedUnitIds(db, auth)));
}

/** Name, roll number and section for each student. */
async function describeStudents(db: Db, tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; rollNo: string | null; unit: string | null }>();
  const units = await tenantUnits(db, tenantId);
  const [people, unitRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)),
    db.select({ userId: memberships.userId, unitId: memberships.orgUnitId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, ids))),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return new Map(
    people.map((p) => {
      const unit = unitRows.find((u) => u.userId === p.id)?.unitId;
      return [p.id, { name: p.name, rollNo: p.rollNo, unit: unit ? (unitName.get(unit) ?? null) : null }];
    }),
  );
}

/** Requests waiting for the placement cell, oldest day first, with what backs each up. */
export async function onDutyQueue(db: Db, auth: AuthContext) {
  const students = await studentsInScope(db, auth);
  const rows = (await db.select().from(onDutyRequests).where(and(eq(onDutyRequests.tenantId, auth.tenantId!), eq(onDutyRequests.status, "pending"))).orderBy(asc(onDutyRequests.date), asc(onDutyRequests.createdAt))).filter((r) =>
    students.has(r.userId),
  );
  const driveIds = [...new Set(rows.flatMap((r) => (r.driveId ? [r.driveId] : [])))];
  const [apps, checkIns] = driveIds.length
    ? await Promise.all([
        db.select().from(placementApplications).where(inArray(placementApplications.driveId, driveIds)),
        db.select().from(driveCheckIns).where(inArray(driveCheckIns.driveId, driveIds)),
      ])
    : [[], []];
  return {
    requests: rows.map((r) => {
      const app = r.driveId ? apps.find((a) => a.driveId === r.driveId && a.userId === r.userId) : undefined;
      return {
        ...view(r, ""),
        driveId: r.driveId,
        student: { id: r.userId, ...students.get(r.userId)! },
        evidence:
          r.reason === "drive"
            ? { registered: Boolean(app && app.status !== "withdrawn"), applicationStatus: app?.status ?? null, roundsCleared: app?.roundsCleared ?? 0, reportedAtDesk: checkIns.some((c) => c.driveId === r.driveId && c.userId === r.userId) }
            : r.reason === "opening"
              ? { applied: true }
              : null,
      };
    }),
  };
}

export async function decideOnDuty(db: Db, auth: AuthContext, ids: string[], decision: { approve: boolean; note: string | null }, now: Date) {
  if (!decision.approve && !decision.note?.trim()) throw badRequest("Say why, so the student knows");
  const students = await studentsInScope(db, auth);
  const rows = (await db.select().from(onDutyRequests).where(and(eq(onDutyRequests.tenantId, auth.tenantId!), inArray(onDutyRequests.id, ids), eq(onDutyRequests.status, "pending")))).filter((r) => students.has(r.userId));
  if (!rows.length) throw notFound("Request");
  await db
    .update(onDutyRequests)
    .set({ status: decision.approve ? "approved" : "rejected", note: decision.approve ? null : decision.note!.trim(), decidedBy: auth.userId, decidedAt: now })
    .where(inArray(
      onDutyRequests.id,
      rows.map((r) => r.id),
    ));
  await enqueue(
    db,
    rows.map((r) => ({
      tenantId: r.tenantId,
      userId: r.userId,
      template: "placement",
      title: decision.approve ? `On duty approved for ${r.date}` : `On duty not approved for ${r.date}`,
      body: decision.approve ? `${r.purpose}. Download the letter for your class teacher if they ask for it.` : decision.note!.trim(),
      link: appLink("/play/on-duty"),
      dedupeKey: `on-duty:${r.id}:${decision.approve ? "approved" : "rejected"}`,
      sentBy: auth.userId,
    })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId!, actorId: auth.userId, action: decision.approve ? "on_duty.approve" : "on_duty.reject", target: rows.map((r) => r.id).join(",") });
  return { decided: rows.length };
}

/** Who is on duty between two days (at most a month), for class teachers marking attendance. */
export async function onDutyRoster(db: Db, auth: AuthContext, from: string, to: string) {
  if (to < from) throw badRequest("The end comes before the start");
  if (addDays(from, 31) < to) throw badRequest("Choose a month or less");
  const students = await studentsInScope(db, auth);
  const rows = (
    await db
      .select()
      .from(onDutyRequests)
      .where(and(eq(onDutyRequests.tenantId, auth.tenantId!), eq(onDutyRequests.status, "approved"), gte(onDutyRequests.date, from), lte(onDutyRequests.date, to)))
  ).filter((r) => students.has(r.userId));
  const entries = rows
    .map((r) => ({ id: r.id, ref: onDutyRef(r.id), date: r.date, part: r.part, partLabel: ON_DUTY_PARTS[r.part], purpose: r.purpose, student: { id: r.userId, ...students.get(r.userId)! } }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.student.unit ?? "").localeCompare(b.student.unit ?? "") || (a.student.rollNo ?? a.student.name).localeCompare(b.student.rollNo ?? b.student.name, "en", { numeric: true }));
  return { from, to, entries };
}

export function rosterCsv(r: Awaited<ReturnType<typeof onDutyRoster>>): string {
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  return [["date", "part", "roll_no", "name", "section", "purpose", "reference"].join(","), ...r.entries.map((e) => [e.date, e.partLabel, e.student.rollNo, e.student.name, e.student.unit, e.purpose, e.ref].map(cell).join(","))].join("\n");
}

/** The letter for an approved request: what the student shows a teacher who asks. */
export async function onDutyLetter(db: Db, ctx: Ctx, id: string): Promise<{ filename: string; pdf: Buffer }> {
  const [r] = await db.select().from(onDutyRequests).where(and(eq(onDutyRequests.id, id), eq(onDutyRequests.userId, ctx.userId)));
  if (!r || r.status !== "approved") throw notFound("Approved request");
  const tenant = await getTenant(db, ctx.tenantId);
  const [students, approver, branding] = await Promise.all([
    describeStudents(db, ctx.tenantId, [r.userId]),
    r.decidedBy ? db.select({ name: users.name }).from(users).where(eq(users.id, r.decidedBy)) : Promise.resolve([]),
    effectiveBranding(db, tenant),
  ]);
  const student = students.get(r.userId)!;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const ref = onDutyRef(r.id);

  const doc = new PDFDocument({ size: "A4", margin: 64, info: { Title: `On duty ${ref}`, Author: tenant.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 128;
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111").text(tenant.name, { width });
  doc.font("Helvetica").fontSize(10).fillColor("#555").text("Training and Placement Cell", { width });
  doc.moveDown(1.5);
  doc.fontSize(10).fillColor("#111").text(`Reference: ${ref}`, { width, continued: true }).text(`Date: ${fmt(localDate(r.decidedAt ?? r.createdAt, tenant.timeZone))}`, { align: "right" });
  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(13).text("On duty", { width });
  doc.moveDown(0.8);
  const who = `${student.name}${student.rollNo ? ` (${student.rollNo})` : ""}${student.unit ? `, ${student.unit}` : ""}`;
  const when = r.part === "full" ? `on ${fmt(r.date)}` : `on the ${r.part} of ${fmt(r.date)}`;
  // Letters are often downloaded before the day, so the tense follows the date.
  const verb = r.date < localDate(ctx.now, tenant.timeZone) ? "was" : "is";
  doc.font("Helvetica").fontSize(11).text(`This is to certify that ${who} ${verb} on duty ${when}, for the ${r.purpose}, with the approval of the Training and Placement Cell.${r.detail ? ` Details: ${r.detail}.` : ""}`, { width, lineGap: 3 });
  doc.moveDown(0.8);
  doc.text("The student may be marked present for the classes missed.", { width, lineGap: 3 });
  doc.moveDown(3);
  doc.font("Helvetica-Bold").text(approver[0]?.name ?? "Training and Placement Cell", { width });
  doc.font("Helvetica").fontSize(10).fillColor("#555").text(approver[0] ? "Training and Placement Cell" : "Approved when the student reported at the drive desk", { width });
  doc.moveDown(2);
  doc.fontSize(8).text(`Issued through ${branding.appName}. Staff can confirm this reference under On duty in the console: ${appLink("/console/on-duty")}`, { width });
  doc.end();
  return { filename: `on-duty-${r.date}-${ref}.pdf`, pdf: await done };
}
