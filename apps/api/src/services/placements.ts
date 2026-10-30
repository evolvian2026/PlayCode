import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import {
  checkEligibility,
  DEFAULT_PLACEMENT_POLICY,
  ENGAGEMENT_BANDS,
  engagementBand,
  formatLpa,
  median,
  OFFER_TIERS,
  offerTier,
  readinessBand,
  type AcademicRecord,
  type OfferTier,
  type PlacementPolicy,
  type CompanyType,
  type EngagementBand,
  type PlacementCriteria,
} from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { academicRecords, assessments, driveRoundTests, driveSchedules, driveSlots, memberships, packs, placementApplications, placementDrives, responses, tenants, users, type ApplicationStatus } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { readinessFor } from "./analytics";
import { appLink, enqueue } from "./notifications";
import { descendants, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits } from "./scope";
import { getTenant, tenantToday } from "./tenant";
import { mySlots } from "./drive-schedules";
import { updatesFor } from "./drive-day";
import { attendanceFor } from "./training";
import { emitAndDeliver } from "./webhooks";

// Campus placements. The placement cell records each company's drive with its
// eligibility rules and selection rounds; eligible students register from the
// app; the cell moves applicants through the rounds and records offers.
// Registration snapshots the student's readiness and recent practice, so the
// outcome report can show how practice before applying relates to results.

const DAY_MS = 86_400_000;

type DriveRow = typeof placementDrives.$inferSelect;

// ---------- Academic records ----------

export interface RecordRow {
  /** Roll number or email. */
  key: string;
  cgpa: number | null;
  backlogs: number | null;
  tenthPct: number | null;
  twelfthPct: number | null;
  graduationYear: number | null;
}

/** "roll_no or email, cgpa, backlogs, class 10 %, class 12 %, graduation year"; blank cells stay unknown. */
export function parseRecordCsv(csv: string): { rows: RecordRow[]; errors: string[] } {
  const rows: RecordRow[] = [];
  const errors: string[] = [];
  const num = (v: string | undefined, min: number, max: number, int: boolean, what: string, line: number): number | null => {
    const t = (v ?? "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
      errors.push(`Line ${line}: ${what} "${t}" should be ${int ? "a whole number" : "a number"} from ${min} to ${max}`);
      return null;
    }
    return n;
  };
  csv.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /^(roll|email|student)/i.test(cells[0] ?? "") && !/\d/.test(cells[1] ?? "")) return; // header
    const n = errors.length;
    const row: RecordRow = {
      key: (cells[0] ?? "").toLowerCase(),
      cgpa: num(cells[1], 0, 10, false, "CGPA", i + 1),
      backlogs: num(cells[2], 0, 60, true, "Backlogs", i + 1),
      tenthPct: num(cells[3], 0, 100, false, "Class 10 %", i + 1),
      twelfthPct: num(cells[4], 0, 100, false, "Class 12 %", i + 1),
      graduationYear: num(cells[5], 2000, 2100, true, "Graduation year", i + 1),
    };
    if (!row.key) errors.push(`Line ${i + 1}: roll number or email is missing`);
    else if (errors.length === n) rows.push(row);
  });
  return { rows, errors };
}

/** Upsert academic records for the tenant's students, matched by roll number or email. */
export async function importRecords(db: Db, args: { tenantId: string; actorId: string; rows: RecordRow[]; now: Date }) {
  const people = await db.select({ id: users.id, email: users.email, rollNo: users.rollNo }).from(users).where(and(eq(users.tenantId, args.tenantId), eq(users.status, "active")));
  const byKey = new Map<string, string>();
  for (const p of people) {
    byKey.set(p.email.toLowerCase(), p.id);
    if (p.rollNo) byKey.set(p.rollNo.toLowerCase(), p.id);
  }
  const notFound: string[] = [];
  let updated = 0;
  for (const r of args.rows) {
    const userId = byKey.get(r.key);
    if (!userId) {
      notFound.push(r.key);
      continue;
    }
    const values = { cgpa: r.cgpa, backlogs: r.backlogs, tenthPct: r.tenthPct, twelfthPct: r.twelfthPct, graduationYear: r.graduationYear, updatedBy: args.actorId, updatedAt: args.now };
    await db
      .insert(academicRecords)
      .values({ userId, tenantId: args.tenantId, ...values })
      .onConflictDoUpdate({ target: academicRecords.userId, set: values });
    updated++;
  }
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "placements.records_import", data: { updated, notFound: notFound.length } });
  return { updated, notFound };
}

async function recordsFor(db: DbOrTx, userIds: string[]): Promise<Map<string, AcademicRecord>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.select().from(academicRecords).where(inArray(academicRecords.userId, userIds));
  return new Map(rows.map((r) => [r.userId, { cgpa: r.cgpa, backlogs: r.backlogs, tenthPct: r.tenthPct, twelfthPct: r.twelfthPct, graduationYear: r.graduationYear }]));
}

// ---------- Placement policy ----------

export function policyOf(tenant: { settings: { placementPolicy?: Partial<PlacementPolicy> } }): PlacementPolicy {
  return { ...DEFAULT_PLACEMENT_POLICY, ...tenant.settings.placementPolicy };
}

export async function placementPolicy(db: DbOrTx, tenantId: string) {
  return policyOf(await getTenant(db, tenantId));
}

export async function setPlacementPolicy(db: Db, args: { tenantId: string; actorId: string; policy: PlacementPolicy }) {
  if (args.policy.superDreamFromRupees <= args.policy.dreamFromRupees) throw badRequest("Super dream has to start above Dream");
  await db
    .update(tenants)
    .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ placementPolicy: args.policy })}::jsonb` })
    .where(eq(tenants.id, args.tenantId));
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "placements.policy", data: { ...args.policy } });
  return args.policy;
}

/** Offers each student holds, by drive (declined ones too: an offer made still counts under the policy; withdrawn ones don't). */
async function offersFor(db: DbOrTx, tenantId: string, userIds: string[]) {
  const out = new Map<string, { driveId: string; ctcRupees: number }[]>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: placementApplications.userId, driveId: placementApplications.driveId, ctc: placementApplications.offerCtcRupees, driveCtc: placementDrives.ctcRupees })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    // An offer the company withdrew no longer counts.
    .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.status, "offered"), sql`${placementApplications.joiningStatus} is distinct from 'revoked'`, inArray(placementApplications.userId, userIds)));
  for (const r of rows) (out.get(r.userId) ?? out.set(r.userId, []).get(r.userId)!).push({ driveId: r.driveId, ctcRupees: r.ctc ?? r.driveCtc });
  return out;
}

/** Drives each student registered for and didn't turn up to (an interview slot marked absent, not excused). */
async function noShowsFor(db: DbOrTx, tenantId: string, userIds: string[]) {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const rows = await db
    .selectDistinct({ userId: driveSlots.userId, driveId: driveSchedules.driveId })
    .from(driveSlots)
    .innerJoin(driveSchedules, eq(driveSchedules.id, driveSlots.scheduleId))
    .where(and(eq(driveSchedules.tenantId, tenantId), eq(driveSlots.status, "no_show"), inArray(driveSlots.userId, userIds)));
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  return out;
}

const tiersOf = (offers: { driveId: string; ctcRupees: number }[] | undefined, policy: PlacementPolicy, exceptDrive: string): OfferTier[] =>
  (offers ?? []).filter((o) => o.driveId !== exceptDrive).map((o) => offerTier(o.ctcRupees, policy));

/** Days with at least one answer in the 60 days before `at`, in the tenant's time zone. */
async function activeDays(db: DbOrTx, userId: string, at: Date, timeZone: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct to_char(${responses.createdAt} at time zone ${timeZone}, 'YYYY-MM-DD'))::int` })
    .from(responses)
    .where(and(eq(responses.userId, userId), gte(responses.createdAt, new Date(at.getTime() - 60 * DAY_MS)), lt(responses.createdAt, at)));
  return row?.n ?? 0;
}

// ---------- Drives ----------

export interface NewDrive {
  company: string;
  companyType: CompanyType;
  roleTitle: string;
  description: string;
  ctcRupees: number;
  location: string;
  driveDate: string;
  registerBy: Date;
  criteria: PlacementCriteria;
  rounds: string[];
  packId: string | null;
}

/** Students the drive's rules let in (ignoring whether they registered). */
async function eligibleStudents(db: DbOrTx, drive: DriveRow, now: Date): Promise<string[]> {
  return studentsEligible(db, drive.tenantId, drive.criteria, { driveId: drive.id, ctcRupees: drive.ctcRupees, now });
}

/**
 * Students a set of rules lets in, by the same checks as a drive: for drives,
 * and for openings found elsewhere (`ctcRupees` null leaves the offer tiers out).
 */
export async function studentsEligible(db: DbOrTx, tenantId: string, criteria: PlacementCriteria, opts: { driveId: string | null; ctcRupees: number | null; now: Date }): Promise<string[]> {
  const units = await tenantUnits(db, tenantId);
  const pool = await studentIdsInUnits(db, tenantId, criteria.unitIds.length ? descendants(units, criteria.unitIds) : units.map((u) => u.id));
  const policy = await placementPolicy(db, tenantId);
  const [records, offers, attendance, noShows] = await Promise.all([
    recordsFor(db, pool),
    offersFor(db, tenantId, pool),
    criteria.minAttendancePct != null ? attendanceFor(db, tenantId, pool, opts.now) : new Map<string, { pct: number | null }>(),
    policy.maxNoShows != null ? noShowsFor(db, tenantId, pool) : new Map<string, number>(),
  ]);
  return pool.filter((id) => {
    const held = tiersOf(offers.get(id), policy, opts.driveId ?? "");
    return checkEligibility(criteria, records.get(id) ?? null, { inUnits: true, placed: held.length > 0, attendancePct: attendance.get(id)?.pct ?? null, policy, offers: held, driveCtcRupees: opts.ctcRupees ?? undefined, noShows: noShows.get(id) ?? 0 }).eligible;
  });
}

/** One student's standing, to check any number of drives or openings against. */
export async function eligibilityChecker(db: DbOrTx, tenantId: string, userId: string, now: Date) {
  const [record, units, offers, attendance, policy, noShows] = await Promise.all([
    recordsFor(db, [userId]).then((m) => m.get(userId) ?? null),
    studentUnitIdsWithAncestors(db, tenantId, userId),
    offersFor(db, tenantId, [userId]).then((m) => m.get(userId)),
    attendanceFor(db, tenantId, [userId], now).then((m) => m.get(userId)),
    placementPolicy(db, tenantId),
    noShowsFor(db, tenantId, [userId]).then((m) => m.get(userId) ?? 0),
  ]);
  const mine = new Set(units);
  return (criteria: PlacementCriteria, ctcRupees: number | null) => {
    const held = tiersOf(offers, policy, "");
    const inUnits = criteria.unitIds.length === 0 || criteria.unitIds.some((u) => mine.has(u));
    return checkEligibility(criteria, record, { inUnits, placed: held.length > 0, attendancePct: attendance?.pct ?? null, policy, offers: held, driveCtcRupees: ctcRupees ?? undefined, noShows });
  };
}

export async function createDrive(db: Db, args: NewDrive & { tenantId: string; actorId: string; now: Date }) {
  if (args.rounds.length === 0) throw badRequest("Add at least one selection round");
  if (args.registerBy <= args.now) throw badRequest("The registration deadline must be in the future");
  const units = new Set((await tenantUnits(db, args.tenantId)).map((u) => u.id));
  if (args.criteria.unitIds.some((u) => !units.has(u))) throw badRequest("Unknown branch or batch");
  if (args.packId) {
    const [pack] = await db.select({ id: packs.id, tenantId: packs.tenantId }).from(packs).where(eq(packs.id, args.packId));
    if (!pack || (pack.tenantId && pack.tenantId !== args.tenantId)) throw badRequest("Unknown mission pack");
  }
  const { tenantId, actorId, now, ...fields } = args;
  const [drive] = await db.insert(placementDrives).values({ ...fields, tenantId, createdBy: actorId }).returning();
  await audit(db, { tenantId, actorId, action: "placements.drive_create", target: drive!.id, data: { company: args.company } });
  // Tell every eligible student, in the app and on WhatsApp where set up.
  const eligible = await eligibleStudents(db, drive!, now);
  const deadline = args.registerBy.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: (await getTenant(db, tenantId)).timeZone });
  await enqueue(
    db,
    eligible.map((userId) => ({
      tenantId,
      userId,
      template: "placement" as const,
      title: `${args.company} is hiring: ${args.roleTitle}`,
      body: `${formatLpa(args.ctcRupees)}. You are eligible. Register by ${deadline}.`,
      link: appLink("/play/placements"),
      dedupeKey: `placement-open:${drive!.id}:${userId}`,
      sentBy: actorId,
    })),
  );
  return { drive: drive!, notified: eligible.length };
}

async function loadDrive(db: DbOrTx, tenantId: string, id: string) {
  const [drive] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, id), eq(placementDrives.tenantId, tenantId)));
  if (!drive) throw notFound("Placement drive");
  return drive;
}

export async function setDriveStatus(db: Db, args: { tenantId: string; actorId: string; id: string; status: DriveRow["status"] }) {
  await loadDrive(db, args.tenantId, args.id);
  await db.update(placementDrives).set({ status: args.status }).where(eq(placementDrives.id, args.id));
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "placements.drive_status", target: args.id, data: { status: args.status } });
}

const active = (status: ApplicationStatus) => status !== "withdrawn";

export async function listDrives(db: DbOrTx, tenantId: string) {
  const policy = await placementPolicy(db, tenantId);
  const drives = await db.select().from(placementDrives).where(eq(placementDrives.tenantId, tenantId)).orderBy(desc(placementDrives.driveDate));
  const apps = drives.length
    ? await db.select({ driveId: placementApplications.driveId, status: placementApplications.status }).from(placementApplications).where(eq(placementApplications.tenantId, tenantId))
    : [];
  return drives.map((d) => {
    const mine = apps.filter((a) => a.driveId === d.id && active(a.status));
    return {
      id: d.id,
      company: d.company,
      companyType: d.companyType,
      roleTitle: d.roleTitle,
      ctcRupees: d.ctcRupees,
      driveDate: d.driveDate,
      registerBy: d.registerBy,
      status: d.status,
      rounds: d.rounds.length,
      tier: policy.tiers ? offerTier(d.ctcRupees, policy) : null,
      registered: mine.length,
      offers: mine.filter((a) => a.status === "offered").length,
    };
  });
}

/** Readiness profile that fits the company: product companies test DSA harder. */
const profileFor = (type: CompanyType) => (type === "product" ? "product" : "service");

export async function driveDetail(db: Db, tenantId: string, id: string, now: Date) {
  const drive = await loadDrive(db, tenantId, id);
  const apps = await db.select().from(placementApplications).where(eq(placementApplications.driveId, id));
  const ids = apps.map((a) => a.userId);
  const [people, records, units, eligible] = await Promise.all([
    ids.length ? db.select({ id: users.id, name: users.name, email: users.email, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [],
    recordsFor(db, ids),
    tenantUnits(db, tenantId),
    eligibleStudents(db, drive, now),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const profile = profileFor(drive.companyType);
  const applicants = apps
    .map((a) => {
      const u = people.find((p) => p.id === a.userId)!;
      return {
        userId: a.userId,
        name: u.name,
        email: u.email,
        rollNo: u.rollNo,
        record: records.get(a.userId) ?? null,
        status: a.status,
        roundsCleared: a.roundsCleared,
        offerCtcRupees: a.offerCtcRupees,
        decision: a.status === "offered" ? (a.decision ?? null) : null,
        decideBy: a.status === "offered" ? a.decideBy : null,
        registeredAt: a.createdAt,
        readinessAtRegistration: a.readiness[profile] ?? 0,
        activeDays60: a.activeDays60,
      };
    })
    .sort((a, b) => b.roundsCleared - a.roundsCleared || a.name.localeCompare(b.name));
  const registered = new Set(apps.filter((a) => active(a.status)).map((a) => a.userId));
  return {
    drive: { ...drive, criteria: { ...drive.criteria, units: drive.criteria.unitIds.map((u) => ({ id: u, name: unitName.get(u) ?? "" })) } },
    readinessProfile: profile,
    summary: {
      // Everyone who registered was eligible then, even if an offer elsewhere has since ruled them out.
      eligible: new Set([...eligible, ...registered]).size,
      registered: registered.size,
      notRegistered: eligible.filter((id) => !registered.has(id)).length,
      perRound: drive.rounds.map((name, i) => ({ name, cleared: apps.filter((a) => active(a.status) && a.roundsCleared > i).length })),
      offers: apps.filter((a) => a.status === "offered").length,
    },
    applicants,
  };
}

export function driveCsv(detail: Awaited<ReturnType<typeof driveDetail>>, profileLinks: Map<string, string> = new Map()): string {
  const esc = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const header = ["name", "roll_no", "email", "cgpa", "backlogs", "class_10", "class_12", "graduation_year", "status", "rounds_cleared", "offer_ctc", "profile_url"];
  return [
    header.join(","),
    ...detail.applicants
      .filter((a) => a.status !== "withdrawn")
      .map((a) =>
        [a.name, a.rollNo, a.email, a.record?.cgpa, a.record?.backlogs, a.record?.tenthPct, a.record?.twelfthPct, a.record?.graduationYear, a.status, a.roundsCleared, a.offerCtcRupees, profileLinks.get(a.userId)]
          .map(esc)
          .join(","),
      ),
  ].join("\n");
}

export type ApplicationAction = "advance" | "reject" | "offer" | "reset";

/** Move applicants through the selection: clear the next round, reject, make an offer, or undo back to registered. */
export async function updateApplications(db: Db, args: { tenantId: string; actorId: string; driveId: string; userIds: string[]; action: ApplicationAction; ctcRupees?: number; now: Date }) {
  const drive = await loadDrive(db, args.tenantId, args.driveId);
  const policy = await placementPolicy(db, args.tenantId);
  const apps = await db
    .select()
    .from(placementApplications)
    .where(and(eq(placementApplications.driveId, drive.id), inArray(placementApplications.userId, args.userIds), ne(placementApplications.status, "withdrawn")));
  if (apps.length !== args.userIds.length) throw badRequest("Some students have not registered for this drive");
  const notes: Parameters<typeof enqueue>[1] = [];
  for (const a of apps) {
    let set: Partial<typeof placementApplications.$inferInsert>;
    if (args.action === "advance") {
      if (a.status === "rejected" || a.status === "offered") throw badRequest("Only students still in the selection can clear a round");
      if (a.roundsCleared >= drive.rounds.length) throw badRequest("Every round is already cleared; record an offer instead");
      set = { status: "shortlisted", roundsCleared: a.roundsCleared + 1 };
      const next = drive.rounds[a.roundsCleared + 1];
      notes.push({
        tenantId: args.tenantId,
        userId: a.userId,
        template: "placement",
        title: `${drive.company}: you cleared ${drive.rounds[a.roundsCleared]}`,
        body: next ? `Next round: ${next}. Practise to be ready.` : "You have cleared every round. The result comes next.",
        link: appLink("/play/placements"),
        dedupeKey: `placement-round:${drive.id}:${a.userId}:${a.roundsCleared + 1}`,
        sentBy: args.actorId,
      });
    } else if (args.action === "reject") {
      set = { status: "rejected" };
    } else if (args.action === "offer") {
      // A repeated offer (say, a corrected CTC) keeps the student's answer and deadline.
      set =
        a.status === "offered"
          ? { offerCtcRupees: args.ctcRupees ?? drive.ctcRupees }
          : { status: "offered", offerCtcRupees: args.ctcRupees ?? drive.ctcRupees, roundsCleared: drive.rounds.length, decision: null, decidedAt: null, decideBy: new Date(args.now.getTime() + policy.decisionDays * DAY_MS) };
      notes.push({
        tenantId: args.tenantId,
        userId: a.userId,
        template: "placement",
        title: `Congratulations! ${drive.company} has made you an offer`,
        body: `${drive.roleTitle}, ${formatLpa(args.ctcRupees ?? drive.ctcRupees)}. Accept or decline it in the app within ${policy.decisionDays} day${policy.decisionDays === 1 ? "" : "s"}.`,
        link: appLink("/play/placements"),
        dedupeKey: `placement-offer:${drive.id}:${a.userId}`,
        sentBy: args.actorId,
      });
    } else {
      set = { status: "registered", roundsCleared: 0, offerCtcRupees: null, decision: null, decidedAt: null, decideBy: null };
    }
    await db
      .update(placementApplications)
      .set({ ...set, updatedAt: args.now })
      .where(and(eq(placementApplications.driveId, drive.id), eq(placementApplications.userId, a.userId)));
    if (args.action === "offer" && a.status !== "offered") {
      emitAndDeliver(db, args.tenantId, "placement.offered", { driveId: drive.id, company: drive.company, role: drive.roleTitle, userId: a.userId, ctcRupees: args.ctcRupees ?? drive.ctcRupees }, args.now);
    }
  }
  await enqueue(db, notes);
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: `placements.${args.action}`, target: drive.id, data: { students: args.userIds.length } });
  return { updated: apps.length };
}

// ---------- Students ----------

export async function studentPlacements(db: Db, ctx: { tenantId: string; userId: string; now: Date }) {
  const [record, mine, units, offers, attendance, policy, slots, noShows, tests, updates] = await Promise.all([
    recordsFor(db, [ctx.userId]).then((m) => m.get(ctx.userId) ?? null),
    db.select().from(placementApplications).where(and(eq(placementApplications.tenantId, ctx.tenantId), eq(placementApplications.userId, ctx.userId))),
    studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId),
    offersFor(db, ctx.tenantId, [ctx.userId]).then((m) => m.get(ctx.userId)),
    attendanceFor(db, ctx.tenantId, [ctx.userId], ctx.now).then((m) => m.get(ctx.userId)!),
    placementPolicy(db, ctx.tenantId),
    mySlots(db, ctx.tenantId, ctx.userId),
    noShowsFor(db, ctx.tenantId, [ctx.userId]).then((m) => m.get(ctx.userId) ?? 0),
    // Drive rounds run as PlayCode tests.
    db
      .select({ driveId: driveRoundTests.driveId, round: driveRoundTests.round, id: assessments.id, title: assessments.title, openAt: assessments.openAt, closeAt: assessments.closeAt })
      .from(driveRoundTests)
      .innerJoin(assessments, eq(assessments.id, driveRoundTests.assessmentId))
      .where(eq(driveRoundTests.tenantId, ctx.tenantId)),
    updatesFor(db, ctx.tenantId, ctx.userId),
  ]);
  const myUnits = new Set(units);
  const drives = await db.select().from(placementDrives).where(eq(placementDrives.tenantId, ctx.tenantId)).orderBy(placementDrives.driveDate);
  const packTitles = new Map((await db.select({ id: packs.id, title: packs.title }).from(packs)).map((p) => [p.id, p.title]));
  const out = [];
  for (const d of drives) {
    const app = mine.find((a) => a.driveId === d.id);
    const open = d.status === "open" && d.registerBy > ctx.now;
    // Students see open drives, and any drive they registered for.
    if (!open && !(app && active(app.status))) continue;
    const inUnits = d.criteria.unitIds.length === 0 || d.criteria.unitIds.some((u) => myUnits.has(u));
    // Their own offer doesn't count against a drive they're already in.
    const held = tiersOf(offers, policy, d.id);
    const eligibility = checkEligibility(d.criteria, record, { inUnits, placed: held.length > 0, attendancePct: attendance.pct, policy, offers: held, driveCtcRupees: d.ctcRupees, noShows });
    out.push({
      id: d.id,
      company: d.company,
      companyType: d.companyType,
      roleTitle: d.roleTitle,
      description: d.description,
      ctcRupees: d.ctcRupees,
      location: d.location,
      driveDate: d.driveDate,
      registerBy: d.registerBy,
      rounds: d.rounds,
      offerDetails: d.offerDetails,
      pack: d.packId ? { id: d.packId, title: packTitles.get(d.packId) ?? d.packId } : null,
      readinessProfile: profileFor(d.companyType),
      open,
      tier: policy.tiers ? offerTier(d.ctcRupees, policy) : null,
      eligibility,
      application:
        app && active(app.status)
          ? {
              status: app.status,
              roundsCleared: app.roundsCleared,
              offerCtcRupees: app.offerCtcRupees,
              decision: app.status === "offered" ? (app.decision ?? null) : null,
              decideBy: app.status === "offered" ? app.decideBy : null,
              joining: app.status === "offered" && app.decision === "accepted" ? { status: app.joiningStatus, joiningDate: app.joiningDate, note: app.joiningNote } : null,
              slots: slots.get(d.id) ?? [],
              updates: updates.get(d.id) ?? [],
              // The test for the round they're waiting for, if it's taken on PlayCode.
              test:
                app.status === "registered" || app.status === "shortlisted"
                  ? (tests.filter((x) => x.driveId === d.id && x.round === app.roundsCleared).map(({ id, title, openAt, closeAt }) => ({ id, title, openAt, closeAt, round: d.rounds[app.roundsCleared] ?? "" }))[0] ?? null)
                  : null,
            }
          : null,
    });
  }
  return {
    record,
    attendance,
    policy: policy.tiers ? { tiers: OFFER_TIERS, dreamFromRupees: policy.dreamFromRupees, superDreamFromRupees: policy.superDreamFromRupees, maxOffers: policy.maxOffers } : null,
    /** Drives missed, and how many the policy allows (null when the rule is off). */
    noShows: { count: noShows, max: policy.maxNoShows },
    drives: out,
  };
}

export async function register(db: Db, ctx: { tenantId: string; userId: string; driveId: string; now: Date }) {
  const drive = await loadDrive(db, ctx.tenantId, ctx.driveId);
  if (drive.status !== "open" || drive.registerBy <= ctx.now) throw badRequest("Registration for this drive has closed");
  const view = (await studentPlacements(db, ctx)).drives.find((d) => d.id === drive.id)!;
  if (view.application) throw conflict("already_registered", "You have already registered for this drive");
  if (!view.eligibility.eligible) throw badRequest(`You are not eligible: ${view.eligibility.reasons.join("; ")}`);
  const tenant = await getTenant(db, ctx.tenantId);
  const readiness = (await readinessFor(db, [ctx.userId], tenantToday(tenant, ctx.now))).get(ctx.userId) ?? {};
  const values = { status: "registered" as const, roundsCleared: 0, offerCtcRupees: null, readiness, activeDays60: await activeDays(db, ctx.userId, ctx.now, tenant.timeZone), createdAt: ctx.now, updatedAt: ctx.now };
  await db
    .insert(placementApplications)
    .values({ driveId: drive.id, userId: ctx.userId, tenantId: ctx.tenantId, ...values })
    .onConflictDoUpdate({ target: [placementApplications.driveId, placementApplications.userId], set: values });
}

export async function withdraw(db: Db, ctx: { tenantId: string; userId: string; driveId: string; now: Date }) {
  const drive = await loadDrive(db, ctx.tenantId, ctx.driveId);
  const [app] = await db.select().from(placementApplications).where(and(eq(placementApplications.driveId, drive.id), eq(placementApplications.userId, ctx.userId)));
  if (!app || app.status === "withdrawn") throw notFound("Registration");
  if (app.status !== "registered" || drive.registerBy <= ctx.now) throw badRequest("You can only withdraw before registration closes and before the selection starts");
  await db.update(placementApplications).set({ status: "withdrawn", updatedAt: ctx.now }).where(and(eq(placementApplications.driveId, drive.id), eq(placementApplications.userId, ctx.userId)));
}

/**
 * A student accepts or declines an offer before its deadline. Only one offer
 * can be accepted: accepting declines the other offers still waiting for an
 * answer, and a decision is final (the placement cell can reset it).
 */
export async function decideOffer(db: Db, ctx: { tenantId: string; userId: string; driveId: string; accept: boolean; now: Date }) {
  const drive = await loadDrive(db, ctx.tenantId, ctx.driveId);
  const mine = await db.select().from(placementApplications).where(and(eq(placementApplications.tenantId, ctx.tenantId), eq(placementApplications.userId, ctx.userId), eq(placementApplications.status, "offered")));
  const app = mine.find((a) => a.driveId === drive.id);
  if (!app) throw notFound("Offer");
  if (app.decision) throw conflict("decided", `You have already ${app.decision} this offer. Talk to your placement cell to change it.`);
  if (app.decideBy && app.decideBy <= ctx.now) throw badRequest("The time to answer this offer has passed");
  const where = (driveId: string) => and(eq(placementApplications.driveId, driveId), eq(placementApplications.userId, ctx.userId));
  if (ctx.accept) {
    const accepted = mine.find((a) => a.decision === "accepted" && a.joiningStatus !== "revoked");
    if (accepted) throw conflict("accepted_elsewhere", "You have already accepted another offer");
    for (const other of mine.filter((a) => a.driveId !== drive.id && !a.decision)) await db.update(placementApplications).set({ decision: "declined", decidedAt: ctx.now }).where(where(other.driveId));
  }
  await db.update(placementApplications).set({ decision: ctx.accept ? "accepted" : "declined", decidedAt: ctx.now }).where(where(drive.id));
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: ctx.accept ? "placements.offer_accept" : "placements.offer_decline", target: drive.id });
}

/**
 * Hourly: remind students of offers due for an answer within a day, and take
 * undecided offers past their deadline as accepted (the best one first; any
 * others then as declined, since only one can be accepted).
 */
export async function settleOffers(db: Db, now: Date) {
  const waiting = await db
    .select({ a: placementApplications, company: placementDrives.company })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.status, "offered"), sql`${placementApplications.decision} is null`, sql`${placementApplications.decideBy} is not null`));
  let reminded = 0;
  let settled = 0;
  const soon = waiting.filter(({ a }) => a.decideBy! > now && a.decideBy!.getTime() - now.getTime() <= DAY_MS);
  reminded += await enqueue(
    db,
    soon.map(({ a, company }) => ({
      tenantId: a.tenantId,
      userId: a.userId,
      template: "placement" as const,
      title: `Answer your ${company} offer by tomorrow`,
      body: "Accept or decline it in the app. If you don't answer, it's taken as accepted.",
      link: appLink("/play/placements"),
      dedupeKey: `offer-remind:${a.driveId}:${a.userId}`,
    })),
  );
  const due = waiting.filter(({ a }) => a.decideBy! <= now).sort((x, y) => (y.a.offerCtcRupees ?? 0) - (x.a.offerCtcRupees ?? 0));
  for (const { a, company } of due) {
    const accepted = await db
      .select({ id: placementApplications.driveId })
      .from(placementApplications)
      .where(and(eq(placementApplications.tenantId, a.tenantId), eq(placementApplications.userId, a.userId), eq(placementApplications.status, "offered"), eq(placementApplications.decision, "accepted")));
    const decision = accepted.length ? "declined" : "accepted";
    await db.update(placementApplications).set({ decision, decidedAt: now }).where(and(eq(placementApplications.driveId, a.driveId), eq(placementApplications.userId, a.userId)));
    await enqueue(db, [
      {
        tenantId: a.tenantId,
        userId: a.userId,
        template: "placement",
        title: decision === "accepted" ? `Your ${company} offer is taken as accepted` : `Your ${company} offer is taken as declined`,
        body: decision === "accepted" ? "You didn't answer in time. Talk to your placement cell if that's wrong." : "You had already accepted another offer.",
        link: appLink("/play/placements"),
        dedupeKey: `offer-settled:${a.driveId}:${a.userId}`,
      },
    ]);
    settled++;
  }
  return { reminded, settled };
}

// ---------- Outcomes ----------

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/**
 * Placement results for the students in the given units (all students when
 * none are given): how many took part, how many were placed, salaries, and the
 * outcome proof: placement rate by how much students practised before
 * applying, and selection rate by readiness when they applied.
 */
export async function outcomes(db: Db, tenantId: string, unitIds: string[] | null) {
  const units = await tenantUnits(db, tenantId);
  const students = await studentIdsInUnits(db, tenantId, unitIds?.length ? descendants(units, unitIds) : units.map((u) => u.id));
  const studentSet = new Set(students);
  const drives = await db.select().from(placementDrives).where(eq(placementDrives.tenantId, tenantId));
  const driveById = new Map(drives.map((d) => [d.id, d]));
  const apps = (await db.select().from(placementApplications).where(eq(placementApplications.tenantId, tenantId))).filter((a) => studentSet.has(a.userId) && active(a.status));

  const byStudent = new Map<string, typeof apps>();
  for (const a of apps) (byStudent.get(a.userId) ?? byStudent.set(a.userId, []).get(a.userId)!).push(a);
  const bestOffer = new Map<string, number>();
  for (const a of apps) if (a.status === "offered") bestOffer.set(a.userId, Math.max(bestOffer.get(a.userId) ?? 0, a.offerCtcRupees ?? 0));

  // Each student's band comes from their first registration: practice before any result was known.
  const bandOf = new Map<string, EngagementBand>();
  for (const [userId, list] of byStudent) {
    const first = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
    bandOf.set(userId, engagementBand(first.activeDays60));
  }
  const byEngagement = ENGAGEMENT_BANDS.map((b) => {
    const ids = [...bandOf].filter(([, band]) => band === b.id).map(([id]) => id);
    const placed = ids.filter((id) => bestOffer.has(id)).length;
    return { ...b, students: ids.length, placed, placedPct: pct(placed, ids.length) };
  });

  // Per application: was the student selected, by their readiness for that kind of company when they applied?
  const decided = apps.filter((a) => a.status === "offered" || a.status === "rejected");
  const byReadiness = (["ready", "almost", "building", "at_risk"] as const).map((band) => {
    const list = decided.filter((a) => readinessBand(a.readiness[profileFor(driveById.get(a.driveId)!.companyType)] ?? 0) === band);
    const offers = list.filter((a) => a.status === "offered").length;
    return { band, applications: list.length, offers, offerPct: pct(offers, list.length) };
  });

  // Departments: the top-level unit each student belongs to.
  const studentUnits = students.length
    ? await db
        .select({ userId: memberships.userId, orgUnitId: memberships.orgUnitId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.userId, students)))
    : [];
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const rootOf = (id: string) => {
    let cur = id;
    while (parent.get(cur)) cur = parent.get(cur)!;
    return cur;
  };
  const deptOf = new Map<string, string>();
  for (const m of studentUnits) if (m.orgUnitId) deptOf.set(m.userId, rootOf(m.orgUnitId));
  const departments = units
    .filter((u) => !u.parentId)
    .map((u) => {
      const ids = students.filter((s) => deptOf.get(s) === u.id);
      const took = ids.filter((id) => byStudent.has(id)).length;
      const placed = ids.filter((id) => bestOffer.has(id)).length;
      return { id: u.id, name: u.name, students: ids.length, registered: took, placed, placedPct: pct(placed, took) };
    })
    .filter((d) => d.students > 0);

  const companies = drives
    .map((d) => {
      const list = apps.filter((a) => a.driveId === d.id);
      return { id: d.id, company: d.company, roleTitle: d.roleTitle, driveDate: d.driveDate, ctcRupees: d.ctcRupees, registered: list.length, offers: list.filter((a) => a.status === "offered").length };
    })
    .filter((c) => c.registered > 0)
    .sort((a, b) => b.driveDate.localeCompare(a.driveDate));

  const offers = [...bestOffer.values()];
  const regular = byEngagement.find((b) => b.id === "regular")!;
  const others = [...bandOf].filter(([, band]) => band !== "regular").map(([id]) => id);
  const othersPlaced = others.filter((id) => bestOffer.has(id)).length;
  return {
    students: students.length,
    registered: byStudent.size,
    placed: bestOffer.size,
    placedPct: pct(bestOffer.size, byStudent.size),
    offers: apps.filter((a) => a.status === "offered").length,
    ctc: { highest: offers.length ? Math.max(...offers) : null, median: median(offers), average: offers.length ? Math.round(offers.reduce((a, b) => a + b, 0) / offers.length) : null },
    byEngagement,
    byReadiness,
    /** Regular practisers against everyone else who took part (only with at least 5 students in each group). */
    headline: regular.students >= 5 && others.length >= 5 ? { regularPct: regular.placedPct, othersPct: pct(othersPlaced, others.length) } : null,
    departments,
    companies,
  };
}

/** One row per student who took part, for the placement cell's records. */
export async function outcomesCsv(db: Db, tenantId: string): Promise<string> {
  const apps = (await db.select().from(placementApplications).where(eq(placementApplications.tenantId, tenantId))).filter((a) => active(a.status));
  const ids = [...new Set(apps.map((a) => a.userId))];
  const [people, records] = await Promise.all([ids.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo, email: users.email }).from(users).where(inArray(users.id, ids)) : [], recordsFor(db, ids)]);
  const drives = new Map((await db.select({ id: placementDrives.id, company: placementDrives.company }).from(placementDrives).where(eq(placementDrives.tenantId, tenantId))).map((d) => [d.id, d.company]));
  const esc = (v: unknown) => {
    const t = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const lines = ["name,roll_no,email,cgpa,drives_registered,offers,best_offer_ctc,companies_with_offers,practice_days_before_first_registration"];
  for (const p of people.sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = apps.filter((a) => a.userId === p.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const offered = mine.filter((a) => a.status === "offered");
    lines.push(
      [p.name, p.rollNo, p.email, records.get(p.id)?.cgpa, mine.length, offered.length, offered.length ? Math.max(...offered.map((a) => a.offerCtcRupees ?? 0)) : "", offered.map((a) => drives.get(a.driveId)).join("; "), mine[0]!.activeDays60]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}
