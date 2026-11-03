import { randomBytes } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { RECRUITER_DIMENSIONS, RETURN_INTENTIONS, trainingPriorities, TRAINING_KINDS, type RecruiterDimension, type ReturnIntention } from "@playcode/core";
import type { Db } from "../db/client";
import { driveSchedules, driveSlots, placementApplications, placementDrives, recruiterFeedback } from "../db/schema";
import { audit } from "../lib/audit";
import { sha256 } from "../lib/crypto";
import { badRequest, notFound } from "../lib/errors";
import { mailer } from "../lib/mailer";
import { appLink } from "./notifications";
import { getTenant, tenantToday } from "./tenant";

// After a drive, the company's view of the students: ratings on aptitude,
// technical knowledge, communication and preparedness, what went well and
// where students fell short, and whether it will come back. The placement
// cell sends a private link (the company needs no account); across the
// season, the answers and the interview panels' ratings show where training
// should focus.

type Auth = { tenantId: string; userId: string };
const DAY = 86_400_000;
/** The company can change its answers for this long after the link is made. */
const OPEN_DAYS = 30;

async function loadDrive(db: Db, tenantId: string, id: string) {
  const [d] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, id), eq(placementDrives.tenantId, tenantId)));
  if (!d) throw notFound("Placement drive");
  return d;
}

const view = (f: typeof recruiterFeedback.$inferSelect | undefined) =>
  f
    ? {
        sentTo: f.sentTo,
        createdAt: f.createdAt,
        submittedAt: f.submittedAt,
        ratings: f.ratings,
        wentWell: f.wentWell,
        gaps: f.gaps,
        returnNextYear: f.returnNextYear,
        returnLabel: f.returnNextYear ? RETURN_INTENTIONS[f.returnNextYear] : null,
        plannedHires: f.plannedHires,
        respondentName: f.respondentName,
        respondentRole: f.respondentRole,
      }
    : null;

export async function driveFeedback(db: Db, tenantId: string, driveId: string) {
  const drive = await loadDrive(db, tenantId, driveId);
  const [f] = await db.select().from(recruiterFeedback).where(eq(recruiterFeedback.driveId, drive.id));
  return { feedback: view(f), emailConfigured: Boolean(mailer()) };
}

/**
 * Make the private link for a drive (a new one replaces the old, until the
 * company has answered), and email it to the company's contact if given.
 */
export async function createFeedbackLink(db: Db, auth: Auth, driveId: string, email: string | null, now: Date) {
  const drive = await loadDrive(db, auth.tenantId, driveId);
  if (drive.driveDate > tenantToday(await getTenant(db, auth.tenantId), now)) throw badRequest("Ask for feedback once the drive has happened");
  const [existing] = await db.select().from(recruiterFeedback).where(eq(recruiterFeedback.driveId, drive.id));
  if (existing?.submittedAt) throw badRequest(`${drive.company} has already answered`);
  const m = mailer();
  if (email && !m) throw badRequest("Email isn't set up on this server. Copy the link and send it yourself.");
  const token = randomBytes(24).toString("base64url");
  const values = { tokenHash: sha256(token), sentTo: email, createdBy: auth.userId, createdAt: now };
  await db
    .insert(recruiterFeedback)
    .values({ tenantId: auth.tenantId, driveId: drive.id, ...values })
    .onConflictDoUpdate({ target: recruiterFeedback.driveId, set: values });
  const link = appLink(`/feedback/${token}`);
  if (email) {
    const tenant = await getTenant(db, auth.tenantId);
    await m!.send({
      to: email,
      subject: `${tenant.name}: how did our students do at your ${drive.roleTitle} drive?`,
      text: [
        "Hello,",
        "",
        `Thank you for hiring at ${tenant.name}. We'd value two minutes of your feedback on our students: how they did on aptitude, technical knowledge, communication and preparedness, and where they fell short. It goes straight into how we train the next batch.`,
        "",
        `Give your feedback here (no sign-in needed): ${link}`,
        "",
        "The link works for 30 days.",
      ].join("\n"),
    });
  }
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.feedback_link", target: drive.id, data: { emailed: Boolean(email) } });
  return { link, ...(await driveFeedback(db, auth.tenantId, drive.id)) };
}

async function byToken(db: Db, token: string, now: Date) {
  const [f] = await db.select().from(recruiterFeedback).where(eq(recruiterFeedback.tokenHash, sha256(token)));
  if (!f || f.createdAt.getTime() + OPEN_DAYS * DAY < now.getTime()) throw notFound("Feedback link");
  const [drive] = await db.select().from(placementDrives).where(eq(placementDrives.id, f.driveId));
  return { f, drive: drive! };
}

/** What the company sees: the drive, how many took part, and its answers so far. */
export async function feedbackForm(db: Db, token: string, now: Date) {
  const { f, drive } = await byToken(db, token, now);
  const tenant = await getTenant(db, f.tenantId);
  const apps = await db.select({ status: placementApplications.status }).from(placementApplications).where(eq(placementApplications.driveId, drive.id));
  return {
    institution: tenant.name,
    company: drive.company,
    roleTitle: drive.roleTitle,
    driveDate: drive.driveDate,
    took: apps.filter((a) => a.status !== "withdrawn").length,
    offers: apps.filter((a) => a.status === "offered").length,
    dimensions: Object.entries(RECRUITER_DIMENSIONS).map(([key, d]) => ({ key, label: d.label })),
    answers: view(f),
  };
}

export interface FeedbackInput {
  ratings: Record<RecruiterDimension, number>;
  wentWell: string;
  gaps: string;
  returnNextYear: ReturnIntention;
  plannedHires: number | null;
  respondentName: string;
  respondentRole: string;
}

export async function submitFeedback(db: Db, token: string, input: FeedbackInput, now: Date) {
  const { f } = await byToken(db, token, now);
  await db
    .update(recruiterFeedback)
    .set({ ...input, wentWell: input.wentWell.trim(), gaps: input.gaps.trim(), respondentName: input.respondentName.trim(), respondentRole: input.respondentRole.trim(), submittedAt: now })
    .where(eq(recruiterFeedback.id, f.id));
  return feedbackForm(db, token, now);
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * The season (the last 12 months): companies' ratings by dimension, the
 * interview panels' ratings, what companies said, and where training
 * should focus.
 */
export async function feedbackSummary(db: Db, tenantId: string, now: Date) {
  const since = new Date(now.getTime() - 365 * DAY);
  const answered = await db
    .select({ f: recruiterFeedback, company: placementDrives.company, roleTitle: placementDrives.roleTitle, driveDate: placementDrives.driveDate })
    .from(recruiterFeedback)
    .innerJoin(placementDrives, eq(placementDrives.id, recruiterFeedback.driveId))
    .where(and(eq(recruiterFeedback.tenantId, tenantId), isNotNull(recruiterFeedback.submittedAt), gte(recruiterFeedback.submittedAt, since)));
  // Links still open that the company hasn't answered.
  const waiting = await db
    .select({ id: recruiterFeedback.id })
    .from(recruiterFeedback)
    .where(and(eq(recruiterFeedback.tenantId, tenantId), isNull(recruiterFeedback.submittedAt), gte(recruiterFeedback.createdAt, new Date(now.getTime() - OPEN_DAYS * DAY))));
  const dims = Object.keys(RECRUITER_DIMENSIONS) as RecruiterDimension[];
  const companies = Object.fromEntries(dims.map((d) => [d, avg(answered.map((a) => a.f.ratings?.[d]).filter((v): v is number => typeof v === "number"))])) as Record<RecruiterDimension, number | null>;

  // The interview panels' ratings of each student, from interview feedback this year.
  const schedules = await db.select({ id: driveSchedules.id }).from(driveSchedules).where(and(eq(driveSchedules.tenantId, tenantId), gte(driveSchedules.startsAt, since)));
  const slots = schedules.length ? await db.select({ feedback: driveSlots.feedback }).from(driveSlots).where(and(inArray(driveSlots.scheduleId, schedules.map((s) => s.id)), isNotNull(driveSlots.feedback))) : [];
  const panel = {
    interviews: slots.length,
    communication: avg(slots.map((s) => s.feedback!.ratings.communication)),
    technical: avg(slots.map((s) => s.feedback!.ratings.technical)),
    problemSolving: avg(slots.map((s) => s.feedback!.ratings.problemSolving)),
  };

  // Training priorities: the companies' view, with the panels' where companies said nothing.
  const blended = { ...companies, technical: companies.technical ?? panel.technical, communication: companies.communication ?? panel.communication };
  const priorities = trainingPriorities(blended).map((p) => ({ ...p, label: RECRUITER_DIMENSIONS[p.dimension].label, trainingLabel: TRAINING_KINDS[p.training] }));
  const returning = Object.fromEntries((Object.keys(RETURN_INTENTIONS) as ReturnIntention[]).map((k) => [k, answered.filter((a) => a.f.returnNextYear === k).length])) as Record<ReturnIntention, number>;
  return {
    responses: answered.length,
    waiting: waiting.length,
    companies,
    panel,
    priorities,
    returning,
    plannedHires: answered.reduce((n, a) => n + (a.f.plannedHires ?? 0), 0),
    comments: answered
      .sort((a, b) => b.f.submittedAt!.getTime() - a.f.submittedAt!.getTime())
      .map((a) => ({ company: a.company, roleTitle: a.roleTitle, driveDate: a.driveDate, wentWell: a.f.wentWell, gaps: a.f.gaps, returnLabel: a.f.returnNextYear ? RETURN_INTENTIONS[a.f.returnNextYear] : null, respondent: [a.f.respondentName, a.f.respondentRole].filter(Boolean).join(", ") })),
  };
}
