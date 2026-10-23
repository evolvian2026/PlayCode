import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { masteryFromRating, READINESS_PROFILES } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { academicRecords, certificates, interviews, memberships, orgUnits, playerProfiles, questions, responses, skillRatings, skills, studentProfiles, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { notFound } from "../lib/errors";
import { readinessFor } from "./analytics";
import { effectiveBranding } from "./branding";
import { certificateCode } from "./certificates";
import { appLink } from "./notifications";
import { recordConsent } from "./privacy";
import { tenantToday } from "./tenant";

// A student's verified record from PlayCode (readiness, skills they have
// mastered, certificates, coding practice, mock interview scores) plus what
// they add themselves, as a resume PDF and, if they choose, a public profile
// recruiters can open. Everything PlayCode states is measured, not self-reported.

/** A skill counts as mastered at 60% with at least 5 answers, as for learning paths. */
const MASTERED = 60;
const MIN_ATTEMPTS = 5;

export interface ProfileInput {
  headline: string;
  about: string;
  links: { github?: string; linkedin?: string; portfolio?: string };
}

export async function getOwnProfile(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId));
  return { headline: row?.headline ?? "", about: row?.about ?? "", links: row?.links ?? {}, publicUrl: row?.publicCode ? appLink(`/p/${row.publicCode}`) : null };
}

export async function saveProfile(db: Db, args: { userId: string; tenantId: string; input: ProfileInput; now: Date }) {
  const values = { headline: args.input.headline, about: args.input.about, links: args.input.links, updatedAt: args.now };
  await db
    .insert(studentProfiles)
    .values({ userId: args.userId, tenantId: args.tenantId, ...values })
    .onConflictDoUpdate({ target: studentProfiles.userId, set: values });
  return getOwnProfile(db, args.userId);
}

/** Publish or hide the public profile. Each publish gets a new link, so an old shared link stops working once hidden. */
export async function setPublic(db: Db, args: { userId: string; tenantId: string; public: boolean; now: Date }) {
  const code = args.public ? certificateCode() : null;
  await db
    .insert(studentProfiles)
    .values({ userId: args.userId, tenantId: args.tenantId, publicCode: code, updatedAt: args.now })
    .onConflictDoUpdate({ target: studentProfiles.userId, set: { publicCode: code, updatedAt: args.now } });
  await recordConsent(db, { tenantId: args.tenantId, userId: args.userId, purpose: "public_profile", granted: args.public, source: "settings", now: args.now });
  await audit(db, { tenantId: args.tenantId, actorId: args.userId, action: args.public ? "profile.publish" : "profile.hide", target: args.userId });
  return getOwnProfile(db, args.userId);
}

/** Everything the resume says, measured from the student's PlayCode activity. */
export async function resumeData(db: Db, userId: string, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.tenantId || user.status !== "active") throw notFound("Student");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId));
  const today = tenantToday(tenant!, now);
  const [own, record, units, readiness, ratings, certs, profile, solved, interview] = await Promise.all([
    getOwnProfile(db, userId),
    db.select().from(academicRecords).where(eq(academicRecords.userId, userId)),
    db.select({ name: orgUnits.name, kind: orgUnits.kind }).from(memberships).innerJoin(orgUnits, eq(orgUnits.id, memberships.orgUnitId)).where(and(eq(memberships.userId, userId), eq(memberships.role, "student"))),
    readinessFor(db, [userId], today),
    db.select({ id: skills.id, name: skills.name, topicName: skills.topicName, rating: skillRatings.rating, attempts: skillRatings.attempts }).from(skillRatings).innerJoin(skills, eq(skills.id, skillRatings.skillId)).where(eq(skillRatings.userId, userId)),
    db.select().from(certificates).where(and(eq(certificates.userId, userId), isNull(certificates.revokedAt))).orderBy(desc(certificates.issuedAt)),
    db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId)),
    db
      .select({ type: questions.type, n: sql<number>`count(distinct ${responses.questionId})::int` })
      .from(responses)
      .innerJoin(questions, eq(questions.id, responses.questionId))
      .where(and(eq(responses.userId, userId), eq(responses.correct, true)))
      .groupBy(questions.type),
    db.select().from(interviews).where(and(eq(interviews.userId, userId), eq(interviews.status, "finished"))).orderBy(desc(interviews.finishedAt)).limit(1),
  ]);
  const branding = await effectiveBranding(db, tenant!);
  const [activeDays] = await db
    .select({ n: sql<number>`count(distinct to_char(${responses.createdAt} at time zone ${tenant!.timeZone}, 'YYYY-MM-DD'))::int` })
    .from(responses)
    .where(and(eq(responses.userId, userId), gte(responses.createdAt, new Date(now.getTime() - 90 * 86_400_000))));
  const count = (types: string[]) => solved.filter((s) => types.includes(s.type)).reduce((a, s) => a + s.n, 0);
  const rec = record[0];
  const latest = interview[0];
  return {
    name: user.name,
    email: user.email,
    rollNo: user.rollNo,
    headline: own.headline,
    about: own.about,
    links: own.links,
    publicUrl: own.publicUrl,
    institution: tenant!.name,
    appName: branding.appName,
    program: units.find((u) => u.kind === "batch")?.name ?? units[0]?.name ?? null,
    department: units.find((u) => u.kind === "department")?.name ?? null,
    academic: rec ? { cgpa: rec.cgpa, graduationYear: rec.graduationYear, tenthPct: rec.tenthPct, twelfthPct: rec.twelfthPct } : null,
    readiness: READINESS_PROFILES.map((p) => ({ id: p.id, name: p.name, score: readiness.get(userId)?.[p.id] ?? 0 })),
    skills: ratings
      .map((r) => ({ id: r.id, name: `${r.topicName}: ${r.name}`, mastery: masteryFromRating(r.rating), attempts: r.attempts }))
      .filter((r) => r.attempts >= MIN_ATTEMPTS && r.mastery >= MASTERED)
      .sort((a, b) => b.mastery - a.mastery)
      .slice(0, 12),
    certificates: certs.map((c) => ({ title: c.title, code: c.code, scorePct: c.scorePct, issuedAt: c.issuedAt, verifyUrl: appLink(`/verify/${c.code}`) })),
    practice: {
      questionsSolved: count(["predict_output", "spot_bug", "fill_blank", "reorder", "which_snippet", "complexity", "trace", "reverse", "pseudocode"]),
      codingProblemsSolved: count(["write_code"]),
      sqlProblemsSolved: count(["sql_query"]),
      activeDays90: activeDays?.n ?? 0,
      longestStreak: profile[0]?.streakLongest ?? 0,
    },
    mockInterview: latest?.scorecard ? { track: latest.track, overall: latest.scorecard.overall, scores: latest.scorecard.scores, at: latest.finishedAt } : null,
    generatedAt: now,
  };
}

export type ResumeData = Awaited<ReturnType<typeof resumeData>>;

/** The public profile: no contact details, roll number or marks; the student decides what else to share by publishing. */
export async function publicProfile(db: Db, code: string, now: Date) {
  const [row] = await db.select().from(studentProfiles).where(eq(studentProfiles.publicCode, code));
  if (!row) throw notFound("Profile");
  const d = await resumeData(db, row.userId, now);
  return {
    name: d.name,
    headline: d.headline,
    about: d.about,
    links: d.links,
    institution: d.institution,
    appName: d.appName,
    program: d.program,
    graduationYear: d.academic?.graduationYear ?? null,
    readiness: d.readiness,
    skills: d.skills.map(({ name, mastery }) => ({ name, mastery })),
    certificates: d.certificates,
    practice: d.practice,
    mockInterview: d.mockInterview ? { track: d.mockInterview.track, overall: d.mockInterview.overall } : null,
    verifiedAt: now,
  };
}

/** Public-profile links for students who published one, for exports. */
export async function publicLinks(db: DbOrTx, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.select({ userId: studentProfiles.userId, code: studentProfiles.publicCode }).from(studentProfiles).where(inArray(studentProfiles.userId, userIds));
  return new Map(rows.filter((r) => r.code).map((r) => [r.userId, appLink(`/p/${r.code}`)]));
}

export function renderResumePdf(d: ResumeData, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: opts.compress ?? true, info: { Title: `${d.name} - resume`, Author: d.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#16161d";
  const muted = "#5b5b6b";
  const accent = "#5b4bff";
  const width = doc.page.width - 96;
  const date = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const heading = (text: string) => {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(accent).text(text.toUpperCase(), { characterSpacing: 0.5 });
    doc.moveTo(48, doc.y + 2).lineTo(48 + width, doc.y + 2).strokeColor("#e4e4ee").lineWidth(1).stroke();
    doc.moveDown(0.5);
  };

  doc.font("Helvetica-Bold").fontSize(22).fillColor(ink).text(d.name);
  if (d.headline) doc.font("Helvetica").fontSize(11.5).fillColor(ink).text(d.headline);
  const contact = [d.email, d.links.linkedin, d.links.github, d.links.portfolio].filter(Boolean).join("   ·   ");
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(contact);
  if (d.about) {
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10).fillColor(ink).text(d.about, { width });
  }

  heading("Education");
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(d.institution);
  const edu = [d.program, d.academic?.graduationYear ? `Graduating ${d.academic.graduationYear}` : null, d.academic?.cgpa != null ? `CGPA ${d.academic.cgpa}` : null].filter(Boolean).join("  ·  ");
  if (edu) doc.font("Helvetica").fontSize(9.5).fillColor(muted).text(edu);
  const school = [d.academic?.twelfthPct != null ? `Class 12: ${d.academic.twelfthPct}%` : null, d.academic?.tenthPct != null ? `Class 10: ${d.academic.tenthPct}%` : null].filter(Boolean).join("  ·  ");
  if (school) doc.font("Helvetica").fontSize(9.5).fillColor(muted).text(school);

  heading(`Verified on ${d.appName}`);
  doc.font("Helvetica").fontSize(9).fillColor(muted).text("Measured from practice on the platform, not self-reported.", { width });
  doc.moveDown(0.4);
  for (const r of d.readiness) {
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(ink).text(`${r.name} readiness`, 48, y, { width: 170 });
    doc.rect(222, y + 2, 200, 7).fillColor("#ececf4").fill();
    doc.rect(222, y + 2, 2 * Math.max(0, Math.min(100, r.score)), 7).fillColor(accent).fill();
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(ink).text(`${r.score}/100`, 432, y, { width: 60 });
    doc.y = y + 16;
  }
  const p = d.practice;
  doc.x = 48;
  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(ink)
    .text(
      [`${p.questionsSolved} practice questions solved`, `${p.codingProblemsSolved} coding problems`, `${p.sqlProblemsSolved} SQL problems`, `${p.activeDays90} practice days in the last 90`, `longest streak ${p.longestStreak} days`].join("  ·  "),
      { width },
    );
  if (d.mockInterview) {
    const s = d.mockInterview.scores;
    doc.text(
      `Mock technical interview (${d.mockInterview.track} company): ${d.mockInterview.overall}/5 overall; problem solving ${s.problemSolving}, fundamentals ${s.fundamentals}, communication ${s.communication}, code ${s.code}.`,
      { width },
    );
  }

  if (d.skills.length) {
    heading("Skills mastered");
    doc.font("Helvetica").fontSize(9.5).fillColor(ink).text(d.skills.map((s) => `${s.name} (${s.mastery}%)`).join("   ·   "), { width });
  }

  if (d.certificates.length) {
    heading("Certificates");
    for (const c of d.certificates) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(ink).text(`${c.title}  `, { continued: true });
      doc.font("Helvetica").fillColor(muted).text(`${c.scorePct}% · ${date(c.issuedAt)} · verify at ${c.verifyUrl}`);
    }
  }

  doc.moveDown(1.2);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(muted)
    .text(`Generated by ${d.appName} on ${date(d.generatedAt)}.${d.publicUrl ? ` Live, verified version: ${d.publicUrl}` : ""}`, 48, doc.y, { width });
  doc.end();
  return done;
}
