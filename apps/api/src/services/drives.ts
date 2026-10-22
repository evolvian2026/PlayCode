import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { assessmentAttempts, assessments, driveCandidates, drives, orgUnits, tenants, users, type CandidateStatus } from "../db/schema";
import { audit } from "../lib/audit";
import { signToken } from "../lib/auth";
import { conflict, notFound } from "../lib/errors";
import { resolveSections, sweepExpired, type SectionInput } from "./assessments";
import { effectiveBranding } from "./branding";
import { certificateCode } from "./certificates";
import { recordConsent } from "./privacy";
import { importStudents, type StudentRow } from "./students";
import { emitAndDeliver } from "./webhooks";

// Hiring drives: a company's proctored test plus a candidate pipeline. Each
// drive gets its own org unit; candidates (who sign up through the drive's
// public link or are imported) are students in that unit, so the existing
// exam room, proctoring, plagiarism checks and results all apply unchanged.

type DriveRow = typeof drives.$inferSelect;

export interface NewDrive {
  title: string;
  roleTitle: string;
  description: string;
  durationMinutes: number;
  openAt: Date;
  closeAt: Date;
  proctorLevel: 1 | 2;
  cutoffPct?: number | null;
  sections: SectionInput[];
}

export async function createDrive(db: Db, args: NewDrive & { tenantId: string; actorId: string; packQuestionIds: (id: string) => Promise<string[]> }) {
  const sections = await resolveSections(db, args.tenantId, args.sections, args.packQuestionIds);
  return db.transaction(async (tx) => {
    const [unit] = await tx.insert(orgUnits).values({ tenantId: args.tenantId, name: `Drive: ${args.title}`, kind: "batch", parentId: null }).returning();
    const [assessment] = await tx
      .insert(assessments)
      .values({
        tenantId: args.tenantId,
        title: `${args.title} (${args.roleTitle})`,
        instructions: args.description,
        proctorLevel: args.proctorLevel,
        durationMinutes: args.durationMinutes,
        openAt: args.openAt,
        closeAt: args.closeAt,
        sections,
        orgUnitIds: [unit!.id],
        releasePolicy: "manual",
        createdBy: args.actorId,
      })
      .returning();
    const [drive] = await tx
      .insert(drives)
      .values({
        tenantId: args.tenantId,
        title: args.title,
        roleTitle: args.roleTitle,
        description: args.description,
        orgUnitId: unit!.id,
        assessmentId: assessment!.id,
        inviteCode: certificateCode().slice(0, 8).toLowerCase(),
        cutoffPct: args.cutoffPct ?? null,
        createdBy: args.actorId,
      })
      .returning();
    await audit(tx, { tenantId: args.tenantId, actorId: args.actorId, action: "drive.create", target: drive!.id, data: { title: args.title } });
    return drive!;
  });
}

export async function getDrive(db: Db, tenantId: string, id: string): Promise<DriveRow> {
  const [d] = await db.select().from(drives).where(and(eq(drives.id, id), eq(drives.tenantId, tenantId)));
  if (!d) throw notFound("Drive");
  return d;
}

export async function listDrives(db: Db, tenantId: string) {
  const rows = await db.select({ d: drives, a: assessments }).from(drives).innerJoin(assessments, eq(assessments.id, drives.assessmentId)).where(eq(drives.tenantId, tenantId)).orderBy(desc(drives.createdAt));
  if (rows.length === 0) return [];
  const cands = await db.select().from(driveCandidates).where(inArray(driveCandidates.driveId, rows.map((r) => r.d.id)));
  const attempts = await db
    .select({ assessmentId: assessmentAttempts.assessmentId, status: assessmentAttempts.status })
    .from(assessmentAttempts)
    .where(inArray(assessmentAttempts.assessmentId, rows.map((r) => r.a.id)));
  return rows.map(({ d, a }) => {
    const mine = cands.filter((c) => c.driveId === d.id);
    return {
      id: d.id,
      title: d.title,
      roleTitle: d.roleTitle,
      status: d.status,
      inviteCode: d.inviteCode,
      openAt: a.openAt,
      closeAt: a.closeAt,
      candidates: mine.length,
      tested: attempts.filter((x) => x.assessmentId === a.id && x.status !== "in_progress").length,
      shortlisted: mine.filter((c) => c.status === "shortlisted" || c.status === "hired").length,
    };
  });
}

/** The candidate pipeline: everyone in the drive with their test result, best first. */
export async function driveDetail(db: Db, tenantId: string, id: string, now: Date) {
  const d = await getDrive(db, tenantId, id);
  const [a] = await db.select().from(assessments).where(eq(assessments.id, d.assessmentId));
  await sweepExpired(db, a!.id, now);
  const cands = await db
    .select({ c: driveCandidates, u: users })
    .from(driveCandidates)
    .innerJoin(users, eq(users.id, driveCandidates.userId))
    .where(eq(driveCandidates.driveId, d.id));
  const attempts = await db.select().from(assessmentAttempts).where(eq(assessmentAttempts.assessmentId, a!.id));
  const rows = cands.map(({ c, u }) => {
    const at = attempts.find((x) => x.userId === u.id);
    const score = at?.score != null ? at.score / 100 : null;
    const max = at?.maxScore != null ? at.maxScore / 100 : null;
    const pct = score !== null && max ? Math.round((score / max) * 100) : null;
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      college: c.college,
      source: c.source,
      status: c.status,
      notes: c.notes,
      appliedAt: c.createdAt,
      test: at ? (at.status === "in_progress" ? "in_progress" : "submitted") : "not_started",
      attemptId: at?.id ?? null,
      score,
      maxScore: max,
      scorePct: pct,
      meetsCutoff: pct !== null && d.cutoffPct !== null ? pct >= d.cutoffPct : null,
      riskScore: at?.riskScore ?? null,
      similarityPct: at?.maxSimilarity ?? null,
    };
  });
  rows.sort((x, y) => (y.scorePct ?? -1) - (x.scorePct ?? -1) || x.name.localeCompare(y.name));
  return {
    drive: { ...d, assessment: { id: a!.id, title: a!.title, openAt: a!.openAt, closeAt: a!.closeAt, durationMinutes: a!.durationMinutes, proctorLevel: a!.proctorLevel } },
    candidates: rows,
  };
}

export async function setCandidateStatus(db: Db, args: { tenantId: string; actorId: string; driveId: string; userId: string; status: CandidateStatus; notes?: string | null; now: Date }) {
  const d = await getDrive(db, args.tenantId, args.driveId);
  const [row] = await db
    .update(driveCandidates)
    .set({ status: args.status, ...(args.notes !== undefined ? { notes: args.notes } : {}), updatedAt: args.now })
    .where(and(eq(driveCandidates.driveId, d.id), eq(driveCandidates.userId, args.userId)))
    .returning();
  if (!row) throw notFound("Candidate");
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "drive.candidate_status", target: args.userId, data: { driveId: d.id, status: args.status } });
  emitAndDeliver(db, args.tenantId, "candidate.status_changed", { driveId: d.id, userId: args.userId, status: args.status }, args.now);
  return row;
}

async function addCandidates(db: Db, d: DriveRow, args: { actorId: string; rows: (StudentRow & { college?: string | null })[]; password?: string; source: "link" | "imported"; now: Date }) {
  const result = await importStudents(db, { tenantId: d.tenantId, actorId: args.actorId, unitId: d.orgUnitId, rows: args.rows, defaultPassword: args.password, now: args.now });
  for (const c of result.created) {
    const college = args.rows.find((r) => r.email.toLowerCase() === c.email)?.college ?? null;
    await db.insert(driveCandidates).values({ driveId: d.id, userId: c.id, source: args.source, college }).onConflictDoNothing();
    emitAndDeliver(db, d.tenantId, "candidate.registered", { driveId: d.id, userId: c.id, name: c.name, email: c.email, college, source: args.source }, args.now);
  }
  return result;
}

export async function importCandidates(db: Db, args: { tenantId: string; actorId: string; driveId: string; rows: StudentRow[]; now: Date }) {
  const d = await getDrive(db, args.tenantId, args.driveId);
  return addCandidates(db, d, { actorId: args.actorId, rows: args.rows, source: "imported", now: args.now });
}

/** What the public apply page shows. */
export async function publicDrive(db: Db, code: string, now: Date) {
  const [row] = await db
    .select({ d: drives, a: assessments, t: tenants })
    .from(drives)
    .innerJoin(assessments, eq(assessments.id, drives.assessmentId))
    .innerJoin(tenants, eq(tenants.id, drives.tenantId))
    .where(eq(drives.inviteCode, code.toLowerCase()));
  if (!row) throw notFound("Drive");
  return {
    row,
    view: {
      title: row.d.title,
      roleTitle: row.d.roleTitle,
      description: row.d.description,
      company: row.t.name,
      branding: await effectiveBranding(db, row.t),
      durationMinutes: row.a.durationMinutes,
      proctorLevel: row.a.proctorLevel,
      openAt: row.a.openAt,
      closeAt: row.a.closeAt,
      accepting: row.d.status === "open" && now < row.a.closeAt,
    },
  };
}

/** Candidate self-registration through the public link. Returns a sign-in token. */
export async function applyToDrive(db: Db, code: string, input: { name: string; email: string; password: string; phone?: string | null; college?: string | null }, now: Date) {
  const { row, view } = await publicDrive(db, code, now);
  if (!view.accepting) throw conflict("closed", "This drive is not accepting applications");
  const result = await addCandidates(db, row.d, {
    actorId: row.d.createdBy,
    rows: [{ name: input.name, email: input.email, rollNo: null, phone: input.phone ?? null, college: input.college ?? null }],
    password: input.password,
    source: "link",
    now,
  });
  const created = result.created[0];
  if (!created) throw conflict("email_taken", "This email already has a PlayCode account. Use another email, or ask the recruiter to add your existing account.");
  await recordConsent(db, { tenantId: row.d.tenantId, userId: created.id, purpose: "privacy_notice", granted: true, source: "drive_apply", now });
  const token = await signToken({ sub: created.id, tenantId: row.d.tenantId, roles: ["student"] });
  return { token, assessmentId: row.d.assessmentId };
}

export function candidatesCsv(rows: Awaited<ReturnType<typeof driveDetail>>["candidates"]): string {
  // Candidates type their own names, so neutralise spreadsheet formulas (=, +, -, @).
  const esc = (v: unknown) => {
    const text = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  const header = ["name", "email", "phone", "college", "status", "test", "score", "max_score", "score_pct", "risk_score", "code_similarity_pct", "applied_at"];
  return [
    header.join(","),
    ...rows.map((r) => [r.name, r.email, r.phone, r.college, r.status, r.test, r.score, r.maxScore, r.scorePct, r.riskScore, r.similarityPct, r.appliedAt.toISOString()].map(esc).join(",")),
  ].join("\n");
}
