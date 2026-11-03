import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { guardianReportMonth, localDate, monthLabel, monthRange, type GuardianRelation } from "@playcode/core";
import type { Db } from "../db/client";
import { guardians, mentoringMeetings, paperResults, placementApplications, placementDrives, questionPapers, responses, tenants, users } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { mailer } from "../lib/mailer";
import { rateLimit } from "../lib/rate-limit";
import { readinessFor } from "./analytics";
import { appLink } from "./notifications";
import { recordConsent } from "./privacy";
import { getTenant } from "./tenant";
import { trainingBetween } from "./training";

// Monthly progress emails to a parent or guardian. Colleges in India keep
// parents informed; here the student decides: they add a parent's address and
// agree to share, the parent confirms it from the first email (so nobody can
// sign a stranger up), and on the 1st of each month the parent gets a short
// summary of the month: practice, readiness, training attendance, class tests,
// mentor meetings and placement drives. Either side can stop it at any time,
// and the institution has to switch it on first.

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof guardians.$inferSelect;
const DAY_MS = 86_400_000;

/** The link in every email: the row id and a signature, so a link stops working once the row is replaced. */
export function guardianToken(g: Pick<Row, "id" | "email">) {
  const sig = createHmac("sha256", env.JWT_SECRET).update(`guardian:${g.id}:${g.email}`).digest("base64url").slice(0, 32);
  return `${g.id}.${sig}`;
}

async function byToken(db: Db, token: string) {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) throw notFound("Link");
  const [g] = await db.select().from(guardians).where(eq(guardians.id, id));
  if (!g) throw notFound("Link");
  const expected = guardianToken(g).split(".")[1]!;
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw notFound("Link");
  return g;
}

const status = (g: Row) => (g.stoppedAt ? "stopped" : g.confirmedAt ? "active" : "waiting");

export async function guardianEnabled(db: Db, tenantId: string) {
  const t = await getTenant(db, tenantId);
  return t.type === "institution" && t.settings.guardianReports === true;
}

// ---------- Students ----------

export async function myGuardian(db: Db, ctx: Ctx) {
  const [g] = await db.select().from(guardians).where(eq(guardians.userId, ctx.userId));
  return {
    enabled: await guardianEnabled(db, ctx.tenantId),
    emailConfigured: Boolean(mailer()),
    guardian: g ? { name: g.name, relation: g.relation, email: g.email, status: status(g), stoppedBy: g.stoppedBy, confirmationSentAt: g.confirmationSentAt, lastReportMonth: g.lastReportMonth } : null,
  };
}

async function sendConfirmation(db: Db, g: Row, now: Date) {
  const m = mailer();
  if (!m) throw badRequest("Email isn't set up on this server yet. Ask your placement cell.");
  const [student] = await db.select({ name: users.name }).from(users).where(eq(users.id, g.userId));
  const tenant = await getTenant(db, g.tenantId);
  const link = appLink(`/guardian/${guardianToken(g)}`);
  await m.send({
    to: g.email,
    subject: `${student!.name} would like to share their placement preparation with you`,
    text: [
      `Dear ${g.name},`,
      "",
      `${student!.name}, a student at ${tenant.name}, practises for campus placements on PlayCode and would like you to receive a short progress email on the 1st of each month: how often they practised, their placement readiness, attendance in training sessions, class test marks and placement drives.`,
      "",
      `To start the monthly email, open this link and confirm: ${link}`,
      "",
      "If you don't know this student or don't want these emails, ignore this message: nothing more will be sent.",
    ].join("\n"),
  });
  await db.update(guardians).set({ confirmationSentAt: now }).where(eq(guardians.id, g.id));
}

export interface GuardianInput {
  name: string;
  relation: GuardianRelation;
  email: string;
  consent: boolean;
}

/** Adding or changing the parent's address starts again: a new link, and the new address has to confirm. */
export async function setGuardian(db: Db, ctx: Ctx, input: GuardianInput) {
  if (!(await guardianEnabled(db, ctx.tenantId))) throw badRequest("Your institution hasn't switched on progress emails to parents");
  if (!input.consent) throw badRequest("Tick the box to agree to share your progress");
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, ctx.userId));
  const email = input.email.trim().toLowerCase();
  if (email === me!.email.toLowerCase()) throw badRequest("Use your parent's email address, not your own");
  await rateLimit(`guardian-email:${ctx.userId}`, 5, DAY_MS, ctx.now, "You've sent several confirmation emails today. Try again tomorrow.");
  const [old] = await db.select().from(guardians).where(eq(guardians.userId, ctx.userId));
  let g: Row;
  if (old?.stoppedBy === "guardian" && old.email === email) throw badRequest(`${old.name} stopped these emails, so they can't be restarted from here`);
  if (old && old.email === email && !old.stoppedAt) {
    [g] = (await db.update(guardians).set({ name: input.name.trim(), relation: input.relation }).where(eq(guardians.id, old.id)).returning()) as [Row];
    if (g.confirmedAt) return myGuardian(db, ctx);
  } else {
    if (old) await db.delete(guardians).where(eq(guardians.id, old.id));
    [g] = (await db.insert(guardians).values({ userId: ctx.userId, tenantId: ctx.tenantId, name: input.name.trim(), relation: input.relation, email, createdAt: ctx.now }).returning()) as [Row];
  }
  await recordConsent(db, { tenantId: ctx.tenantId, userId: ctx.userId, purpose: "guardian_reports", granted: true, source: "settings", now: ctx.now });
  await sendConfirmation(db, g, ctx.now);
  return myGuardian(db, ctx);
}

export async function resendConfirmation(db: Db, ctx: Ctx) {
  const [g] = await db.select().from(guardians).where(eq(guardians.userId, ctx.userId));
  if (!g || g.confirmedAt || g.stoppedAt) throw badRequest("There's nothing to confirm");
  await rateLimit(`guardian-email:${ctx.userId}`, 5, DAY_MS, ctx.now, "You've sent several confirmation emails today. Try again tomorrow.");
  await sendConfirmation(db, g, ctx.now);
  return myGuardian(db, ctx);
}

/** The student stops the emails; the address is forgotten. */
export async function removeGuardian(db: Db, ctx: Ctx) {
  const [g] = await db.select().from(guardians).where(eq(guardians.userId, ctx.userId));
  if (g) {
    await db.delete(guardians).where(eq(guardians.id, g.id));
    await recordConsent(db, { tenantId: ctx.tenantId, userId: ctx.userId, purpose: "guardian_reports", granted: false, source: "settings", now: ctx.now });
  }
  return myGuardian(db, ctx);
}

// ---------- The parent's link ----------

export async function guardianLink(db: Db, token: string) {
  const g = await byToken(db, token);
  const [student] = await db.select({ name: users.name }).from(users).where(eq(users.id, g.userId));
  const tenant = await getTenant(db, g.tenantId);
  return { student: student!.name, institution: tenant.name, name: g.name, status: status(g) };
}

export async function confirmGuardian(db: Db, token: string, now: Date) {
  const g = await byToken(db, token);
  if (g.stoppedAt) throw badRequest("These emails were stopped. The student can send a new invitation.");
  if (!g.confirmedAt) await db.update(guardians).set({ confirmedAt: now }).where(eq(guardians.id, g.id));
  return guardianLink(db, token);
}

export async function stopGuardian(db: Db, token: string, now: Date) {
  const g = await byToken(db, token);
  if (!g.stoppedAt) {
    await db.update(guardians).set({ stoppedAt: now, stoppedBy: "guardian" }).where(eq(guardians.id, g.id));
    await audit(db, { tenantId: g.tenantId, actorId: g.userId, action: "guardian.stopped_by_guardian", target: g.id });
  }
  return guardianLink(db, token);
}

// ---------- Institution ----------

export async function guardianStats(db: Db, tenantId: string) {
  const rows = await db.select().from(guardians).where(eq(guardians.tenantId, tenantId));
  return { enabled: await guardianEnabled(db, tenantId), active: rows.filter((g) => status(g) === "active").length, waiting: rows.filter((g) => status(g) === "waiting").length, emailConfigured: Boolean(mailer()) };
}

export async function setGuardianReports(db: Db, args: { tenantId: string; actorId: string; enabled: boolean }) {
  await db
    .update(tenants)
    .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ guardianReports: args.enabled })}::jsonb` })
    .where(eq(tenants.id, args.tenantId));
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "settings.guardian_reports", data: { enabled: args.enabled } });
  return guardianStats(db, args.tenantId);
}

// ---------- The monthly email ----------

/** What a parent reads about one month. */
export async function monthSummary(db: Db, g: Row, month: string, now: Date) {
  const tenant = await getTenant(db, g.tenantId);
  const tz = tenant.timeZone;
  const { from, to } = monthRange(month);
  // A wide window in UTC, narrowed to the month's local days.
  const lo = new Date(`${from}T00:00:00Z`).getTime() - DAY_MS;
  const hi = new Date(`${to}T23:59:59Z`).getTime() + DAY_MS;
  const within = (d: Date) => {
    const day = localDate(d, tz);
    return day >= from && day <= to;
  };
  const [student] = await db.select({ name: users.name }).from(users).where(eq(users.id, g.userId));
  const answers = (await db.select({ at: responses.createdAt, correct: responses.correct }).from(responses).where(and(eq(responses.userId, g.userId), gte(responses.createdAt, new Date(lo)), lte(responses.createdAt, new Date(hi))))).filter((r) => within(r.at));
  const days = new Set(answers.map((a) => localDate(a.at, tz))).size;
  const readiness = (await readinessFor(db, [g.userId], to)).get(g.userId) ?? {};
  const training = await trainingBetween(db, { tenantId: g.tenantId, userId: g.userId, now }, new Date(lo), new Date(hi));
  const tests = (
    await db
      .select({ title: questionPapers.title, score: paperResults.score, at: paperResults.enteredAt, questions: questionPapers.questionIds, marksPer: questionPapers.marksPerQuestion })
      .from(paperResults)
      .innerJoin(questionPapers, eq(questionPapers.id, paperResults.paperId))
      .where(and(eq(paperResults.userId, g.userId), gte(paperResults.enteredAt, new Date(lo)), lte(paperResults.enteredAt, new Date(hi))))
  )
    .filter((t) => within(t.at))
    .map((t) => ({ title: t.title, score: t.score, marks: t.questions.length * t.marksPer }));
  const meetings = (await db.select({ date: mentoringMeetings.meetingDate }).from(mentoringMeetings).where(and(eq(mentoringMeetings.tenantId, g.tenantId), eq(mentoringMeetings.studentId, g.userId)))).filter((m) => m.date >= from && m.date <= to).length;
  const apps = await db
    .select({ company: placementDrives.company, status: placementApplications.status, createdAt: placementApplications.createdAt, updatedAt: placementApplications.updatedAt, ctc: placementApplications.offerCtcRupees })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.tenantId, g.tenantId), eq(placementApplications.userId, g.userId)));
  return {
    student: student!.name,
    institution: tenant.name,
    month,
    practice: { days, answers: answers.length, accuracyPct: answers.length ? Math.round((answers.filter((a) => a.correct).length / answers.length) * 100) : null },
    readiness: { service: readiness.service ?? 0, product: readiness.product ?? 0 },
    training: { held: training.held, attended: training.attended },
    classTests: tests,
    mentorMeetings: meetings,
    drives: {
      registered: apps.filter((a) => within(a.createdAt) && a.status !== "withdrawn").map((a) => a.company),
      offers: apps.filter((a) => a.status === "offered" && within(a.updatedAt ?? a.createdAt)).map((a) => ({ company: a.company, ctcRupees: a.ctc })),
    },
  };
}

export function summaryText(s: Awaited<ReturnType<typeof monthSummary>>, g: Pick<Row, "name" | "relation">, stopLink: string) {
  const first = s.student.split(" ")[0];
  const lines = [
    `Dear ${g.name},`,
    "",
    `Here is ${first}'s placement preparation at ${s.institution} in ${monthLabel(s.month)}.`,
    "",
    s.practice.answers ? `Practice: ${s.practice.days} day${s.practice.days === 1 ? "" : "s"}, ${s.practice.answers} questions answered (${s.practice.accuracyPct}% correct).` : "Practice: no practice on PlayCode this month.",
    `Placement readiness: ${s.readiness.service} of 100 for service companies, ${s.readiness.product} of 100 for product companies.`,
    s.training.held ? `Training sessions: attended ${s.training.attended} of ${s.training.held}.` : "Training sessions: none held this month.",
    ...(s.classTests.length ? [`Class tests: ${s.classTests.map((t) => `${t.title} ${t.score}/${t.marks}`).join("; ")}.`] : []),
    ...(s.mentorMeetings ? [`Mentor meetings: ${s.mentorMeetings}.`] : []),
    ...(s.drives.registered.length ? [`Placement drives registered for: ${s.drives.registered.join(", ")}.`] : []),
    ...s.drives.offers.map((o) => `Offer: ${o.company}${o.ctcRupees ? `, ₹${(o.ctcRupees / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} LPA` : ""}. Congratulations!`),
    "",
    `${first} chose to share this with you and can stop it at any time. To stop these emails yourself: ${stopLink}`,
  ];
  return lines.join("\n");
}

/** Hourly: in the first week of a month, send last month's summary to each confirmed parent (once). */
export async function sendGuardianReports(db: Db, now: Date) {
  const m = mailer();
  if (!m) return { sent: 0, skipped: "email is not configured (SMTP_URL)" };
  const rows = await db
    .select({ g: guardians, timeZone: tenants.timeZone, settings: tenants.settings, userStatus: users.status })
    .from(guardians)
    .innerJoin(tenants, eq(tenants.id, guardians.tenantId))
    .innerJoin(users, eq(users.id, guardians.userId))
    .where(and(isNotNull(guardians.confirmedAt), isNull(guardians.stoppedAt)));
  let sent = 0;
  for (const { g, timeZone, settings, userStatus } of rows) {
    if (settings.guardianReports !== true || userStatus !== "active") continue;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
    const month = guardianReportMonth(localDate(now, timeZone), hour);
    if (!month || (g.lastReportMonth && g.lastReportMonth >= month)) continue;
    // Only months that had started being shared: a parent who confirmed on the 3rd of November gets November's, not October's.
    if (localDate(g.confirmedAt!, timeZone) > monthRange(month).to) continue;
    try {
      const summary = await monthSummary(db, g, month, now);
      await m.send({ to: g.email, subject: `${summary.student}: ${monthLabel(month)} progress on PlayCode`, text: summaryText(summary, g, appLink(`/guardian/${guardianToken(g)}`)) });
      await db.update(guardians).set({ lastReportMonth: month, lastError: null }).where(eq(guardians.id, g.id));
      sent++;
    } catch (err) {
      await db.update(guardians).set({ lastError: (err as Error).message.slice(0, 300) }).where(eq(guardians.id, g.id));
    }
  }
  return { sent };
}
