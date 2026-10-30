import PDFDocument from "pdfkit";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { attendancePct, formatLpa, localDate, median, MIN_FEEDBACK_RESPONSES, TRAINING_KINDS, type TrainingKind } from "@playcode/core";
import type { Db } from "../db/client";
import {
  groupDiscussions,
  interviews,
  mockAttempts,
  paperResults,
  placementApplications,
  placementDrives,
  questionPapers,
  responses,
  trainingAttendance,
  trainingFeedback,
  trainingSessions,
  writingAttempts,
} from "../db/schema";
import { forbidden } from "../lib/errors";
import { mentoringStats } from "./mentoring";
import { certificationStats, internshipStats } from "./resume-entries";
import { pdfSafe } from "./papers";
import { descendants, scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";
import { getTenant } from "./tenant";
import { feedbackSummary, invitedIds } from "./training";

// The training and placement activity report placement cells file for
// accreditation (NAAC, NBA) and management reviews: for a period, usually an
// academic year, every training session held with its hours and attendance,
// class tests, practice on PlayCode, and placement outcomes, for the whole
// institution or one department or batch. Counts cover only students in the
// requester's scope.

const DAY = 86_400_000;
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
// Every application but a withdrawn one, as the placements report counts them.
const ACTIVE = new Set(["registered", "shortlisted", "offered", "rejected"]);

export interface ReportPeriod {
  from: string;
  to: string;
  unitId?: string;
}

export async function activityReport(db: Db, auth: AuthContext, period: ReportPeriod, now: Date) {
  const tenantId = auth.tenantId!;
  const tenant = await getTenant(db, tenantId);
  const tz = tenant.timeZone;
  const scoped = await scopedUnitIds(db, auth);
  if (period.unitId && !scoped.includes(period.unitId)) throw forbidden("That batch or section is outside your scope");
  const units = await tenantUnits(db, tenantId);
  const students = await studentIdsInUnits(db, tenantId, period.unitId ? descendants(units, [period.unitId]) : scoped);
  const inScope = new Set(students);
  // Rows are fetched with a day's slack either side, then kept by their local date.
  const lo = new Date(new Date(`${period.from}T00:00:00Z`).getTime() - DAY);
  const hi = new Date(new Date(`${period.to}T00:00:00Z`).getTime() + 2 * DAY);
  const within = (d: Date) => {
    const day = localDate(d, tz);
    return day >= period.from && day <= period.to;
  };

  // ---------- Training ----------
  const held = (await db.select().from(trainingSessions).where(and(eq(trainingSessions.tenantId, tenantId), eq(trainingSessions.status, "scheduled"), gte(trainingSessions.startsAt, lo), lte(trainingSessions.startsAt, hi))))
    .filter((s) => within(s.startsAt) && s.startsAt <= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const present = held.length ? await db.select({ sessionId: trainingAttendance.sessionId, userId: trainingAttendance.userId }).from(trainingAttendance).where(inArray(trainingAttendance.sessionId, held.map((s) => s.id))) : [];
  const ratings = held.length ? await db.select().from(trainingFeedback).where(inArray(trainingFeedback.sessionId, held.map((s) => s.id))) : [];
  const trained = new Set<string>();
  const rated: typeof ratings = [];
  const sessions: { id: string; date: string; title: string; kind: TrainingKind; trainer: string; location: string; hours: number; invited: number; attended: number; pct: number; rating: number | null }[] = [];
  for (const s of held) {
    const invited = (await invitedIds(db, s)).filter((id) => inScope.has(id));
    if (!invited.length) continue;
    const invitedSet = new Set(invited);
    const came = present.filter((p) => p.sessionId === s.id && invitedSet.has(p.userId));
    for (const p of came) trained.add(p.userId);
    // Ratings are the session's as a whole (from everyone who attended), shown once there are enough.
    const mine = ratings.filter((f) => f.sessionId === s.id);
    rated.push(...mine);
    const fb = feedbackSummary(mine, { comments: false });
    sessions.push({ id: s.id, date: localDate(s.startsAt, tz), title: s.title, kind: s.kind, trainer: s.trainer, location: s.location, hours: Math.round((s.durationMinutes / 60) * 10) / 10, invited: invited.length, attended: came.length, pct: pct(came.length, invited.length), rating: fb.shown ? fb.overall : null });
  }
  const byKind = (Object.keys(TRAINING_KINDS) as TrainingKind[])
    .map((kind) => {
      const list = sessions.filter((s) => s.kind === kind);
      return { kind, label: TRAINING_KINDS[kind], sessions: list.length, hours: Math.round(list.reduce((n, s) => n + s.hours, 0) * 10) / 10 };
    })
    .filter((k) => k.sessions > 0);
  const totalInvited = sessions.reduce((n, s) => n + s.invited, 0);
  const totalAttended = sessions.reduce((n, s) => n + s.attended, 0);

  // ---------- Class tests ----------
  const results = students.length
    ? (await db.select({ r: paperResults, title: questionPapers.title, marksPer: questionPapers.marksPerQuestion, questions: questionPapers.questionIds }).from(paperResults).innerJoin(questionPapers, eq(questionPapers.id, paperResults.paperId)).where(and(eq(paperResults.tenantId, tenantId), gte(paperResults.enteredAt, lo), lte(paperResults.enteredAt, hi)))).filter(
        (x) => inScope.has(x.r.userId) && within(x.r.enteredAt),
      )
    : [];
  const byPaper = new Map<string, typeof results>();
  for (const x of results) byPaper.set(x.r.paperId, [...(byPaper.get(x.r.paperId) ?? []), x]);
  const classTests = [...byPaper].map(([paperId, list]) => {
    const marks = list[0]!.questions.length * list[0]!.marksPer;
    const first = list.reduce((a, b) => (a.r.enteredAt < b.r.enteredAt ? a : b));
    return { paperId, title: list[0]!.title, date: localDate(first.r.enteredAt, tz), students: list.length, averagePct: Math.round(list.reduce((n, x) => n + pct(x.r.score, marks), 0) / list.length) };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // ---------- Practice ----------
  const count = async <T extends { userId: string; at: Date | null }>(rows: () => Promise<T[]>) => {
    if (!students.length) return { count: 0, students: 0 };
    const kept = (await rows()).filter((r) => r.at && inScope.has(r.userId) && within(r.at));
    return { count: kept.length, students: new Set(kept.map((r) => r.userId)).size };
  };
  const ids = students;
  const [answers, mocks, mockInterviews, gds, writing] = await Promise.all([
    count(() => db.select({ userId: responses.userId, at: responses.createdAt }).from(responses).where(and(inArray(responses.userId, ids), gte(responses.createdAt, lo), lte(responses.createdAt, hi)))),
    count(() => db.select({ userId: mockAttempts.userId, at: mockAttempts.submittedAt }).from(mockAttempts).where(and(inArray(mockAttempts.userId, ids), eq(mockAttempts.status, "submitted"), gte(mockAttempts.startedAt, lo), lte(mockAttempts.startedAt, hi)))),
    count(() => db.select({ userId: interviews.userId, at: interviews.finishedAt }).from(interviews).where(and(inArray(interviews.userId, ids), eq(interviews.status, "finished"), gte(interviews.startedAt, lo), lte(interviews.startedAt, hi)))),
    count(() => db.select({ userId: groupDiscussions.userId, at: groupDiscussions.finishedAt }).from(groupDiscussions).where(and(inArray(groupDiscussions.userId, ids), eq(groupDiscussions.status, "finished"), gte(groupDiscussions.startedAt, lo), lte(groupDiscussions.startedAt, hi)))),
    count(() => db.select({ userId: writingAttempts.userId, at: writingAttempts.createdAt }).from(writingAttempts).where(and(inArray(writingAttempts.userId, ids), gte(writingAttempts.createdAt, lo), lte(writingAttempts.createdAt, hi)))),
  ]);

  // ---------- Placements ----------
  const drives = (await db.select().from(placementDrives).where(eq(placementDrives.tenantId, tenantId))).filter((d) => d.driveDate >= period.from && d.driveDate <= period.to);
  const apps = drives.length ? (await db.select().from(placementApplications).where(inArray(placementApplications.driveId, drives.map((d) => d.id)))).filter((a) => inScope.has(a.userId) && ACTIVE.has(a.status)) : [];
  const best = new Map<string, number>();
  for (const a of apps) if (a.status === "offered") best.set(a.userId, Math.max(best.get(a.userId) ?? 0, a.offerCtcRupees ?? 0));
  const offers = [...best.values()];
  const companies = drives
    .map((d) => {
      const list = apps.filter((a) => a.driveId === d.id);
      return { company: d.company, roleTitle: d.roleTitle, date: d.driveDate, ctcRupees: d.ctcRupees, registered: list.length, offers: list.filter((a) => a.status === "offered").length };
    })
    .filter((c) => c.registered > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    institution: tenant.name,
    scope: period.unitId ? (units.find((u) => u.id === period.unitId)?.name ?? "") : "All students in scope",
    from: period.from,
    to: period.to,
    students: students.length,
    training: {
      sessions,
      byKind,
      totals: { sessions: sessions.length, hours: Math.round(sessions.reduce((n, s) => n + s.hours, 0) * 10) / 10, studentsTrained: trained.size, studentsTrainedPct: pct(trained.size, students.length), attendancePct: attendancePct(totalAttended, totalInvited), feedback: feedbackSummary(rated, { comments: false }) },
    },
    classTests,
    practice: { answers, mockTests: mocks, mockInterviews, groupDiscussions: gds, writing },
    mentoring: await mentoringStats(db, tenantId, students, period.from, period.to),
    internships: await internshipStats(db, tenantId, inScope, period.from, period.to),
    certifications: await certificationStats(db, tenantId, inScope, period.from, period.to),
    placements: {
      companies,
      registered: new Set(apps.map((a) => a.userId)).size,
      placed: best.size,
      offers: apps.filter((a) => a.status === "offered").length,
      highest: offers.length ? Math.max(...offers) : null,
      median: median(offers),
    },
  };
}

export type ActivityReport = Awaited<ReturnType<typeof activityReport>>;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Formula-looking cells are neutralised so a spreadsheet doesn't run them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");

export function activityCsv(r: ActivityReport): string {
  const rows: unknown[][] = [
    ["Training and placement activity", r.institution, r.scope, `${r.from} to ${r.to}`],
    [],
    ["Training sessions"],
    ["Date", "Title", "Kind", "Trainer", "Venue", "Hours", "Students invited", "Students attended", "Attendance %", "Student rating (of 5)"],
    ...r.training.sessions.map((s) => [s.date, s.title, TRAINING_KINDS[s.kind], s.trainer, s.location, s.hours, s.invited, s.attended, s.pct, s.rating ?? ""]),
    ["Total", `${r.training.totals.sessions} sessions`, "", "", "", r.training.totals.hours, "", "", r.training.totals.attendancePct ?? "", r.training.totals.feedback.shown ? r.training.totals.feedback.overall : ""],
    [],
    ["Class tests"],
    ["Date", "Paper", "Students", "Average %"],
    ...r.classTests.map((c) => [c.date, c.title, c.students, c.averagePct]),
    [],
    ["Practice on PlayCode", "Count", "Students"],
    ["Practice answers", r.practice.answers.count, r.practice.answers.students],
    ["Mock tests", r.practice.mockTests.count, r.practice.mockTests.students],
    ["AI mock interviews", r.practice.mockInterviews.count, r.practice.mockInterviews.students],
    ["Group discussions", r.practice.groupDiscussions.count, r.practice.groupDiscussions.students],
    ["Written English", r.practice.writing.count, r.practice.writing.students],
    [],
    ["Mentoring", "Mentors", "Mentees", "Mentees per mentor", "Meetings", "Students met"],
    ["", r.mentoring.mentors, `${r.mentoring.mentees} (${r.mentoring.coveragePct}%)`, r.mentoring.ratio ?? "", r.mentoring.meetings, r.mentoring.studentsMet],
    [],
    ["Internships verified by the institution", r.internships.internships, "Students", r.internships.students],
    ["Certifications earned (verified)", r.certifications.certifications, "Students", r.certifications.students],
    [],
    ["Placement drives"],
    ["Date", "Company", "Role", "CTC (Rs)", "Registered", "Offers"],
    ...r.placements.companies.map((c) => [c.date, c.company, c.roleTitle, c.ctcRupees, c.registered, c.offers]),
    ["Students placed", r.placements.placed, "Offers", r.placements.offers, "Highest CTC (Rs)", r.placements.highest ?? "", "Median CTC (Rs)", r.placements.median ?? ""],
  ];
  return rows.map(csvRow).join("\r\n") + "\r\n";
}

export function activityPdf(r: ActivityReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Training and placement activity ${r.from} to ${r.to}`, Author: r.institution } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#17162b";
  const muted = "#5d5b76";
  const width = doc.page.width - 96;
  const money = (n: number | null) => (n === null ? "-" : pdfSafe(formatLpa(n)));

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.8).fillColor(ink).font("Helvetica-Bold").fontSize(13).text(text, 48).moveDown(0.3);
  };
  const table = (cols: { label: string; w: number; align?: "left" | "right" }[], rows: (string | number)[][]) => {
    const line = (cells: (string | number)[], bold: boolean) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const y = doc.y;
      let x = 48;
      let h = 0;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(bold ? muted : ink);
      cells.forEach((c, i) => {
        const text = pdfSafe(String(c));
        doc.text(text, x, y, { width: cols[i]!.w - 6, align: cols[i]!.align ?? "left" });
        h = Math.max(h, doc.heightOfString(text, { width: cols[i]!.w - 6 }));
        x += cols[i]!.w;
      });
      doc.y = y + h + 4;
    };
    line(cols.map((c) => c.label), true);
    for (const row of rows) line(row, false);
    doc.x = 48;
  };
  const facts = (items: [string, string][]) => {
    for (const [k, v] of items) doc.font("Helvetica").fontSize(10).fillColor(muted).text(`${k}: `, 48, doc.y, { continued: true }).fillColor(ink).font("Helvetica-Bold").text(pdfSafe(v));
  };

  doc.fillColor(muted).font("Helvetica").fontSize(10).text(pdfSafe(r.institution));
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(18).text("Training and placement activity");
  doc.font("Helvetica").fontSize(10).fillColor(muted).text(pdfSafe(`${r.scope} · ${r.from} to ${r.to} · ${r.students} students`));

  const t = r.training.totals;
  heading("Summary");
  facts([
    ["Training sessions held", `${t.sessions} (${t.hours} hours)`],
    ["Students who attended at least one session", `${t.studentsTrained} of ${r.students} (${t.studentsTrainedPct}%)`],
    ["Average attendance", t.attendancePct === null ? "-" : `${t.attendancePct}%`],
    ["Students' rating of training", t.feedback.shown ? `${t.feedback.overall} of 5 (${t.feedback.responses} responses)` : "-"],
    ["Class tests", String(r.classTests.length)],
    ["Students placed", `${r.placements.placed} (${r.placements.offers} offers)`],
    ["Highest and median package", `${money(r.placements.highest)} · ${money(r.placements.median)}`],
  ]);

  heading("Training sessions");
  if (!r.training.sessions.length) doc.font("Helvetica").fontSize(10).fillColor(muted).text("No sessions in this period.");
  else {
    table(
      [
        { label: "Date", w: 58 },
        { label: "Session", w: 112 },
        { label: "Kind", w: 68 },
        { label: "Trainer", w: 74 },
        { label: "Hours", w: 34, align: "right" },
        { label: "Invited", w: 40, align: "right" },
        { label: "Attended", w: 46, align: "right" },
        { label: "Rate", w: 34, align: "right" },
        { label: "Rating", w: width - 466, align: "right" },
      ],
      r.training.sessions.map((s) => [s.date, s.title, TRAINING_KINDS[s.kind], s.trainer, s.hours, s.invited, s.attended, `${s.pct}%`, s.rating === null ? "-" : String(s.rating)]),
    );
    doc.moveDown(0.3).font("Helvetica").fontSize(9).fillColor(muted).text(r.training.byKind.map((k) => `${k.label}: ${k.sessions} session${k.sessions === 1 ? "" : "s"}, ${k.hours} h`).join(" · "), 48);
    doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Rating: attendees' average out of 5, shown once ${MIN_FEEDBACK_RESPONSES} or more have rated the session.`, 48);
  }

  heading("Class tests");
  if (!r.classTests.length) doc.font("Helvetica").fontSize(10).fillColor(muted).text("No class test results in this period.");
  else table([{ label: "Date", w: 70 }, { label: "Paper", w: 270 }, { label: "Students", w: 70, align: "right" }, { label: "Average", w: width - 410, align: "right" }], r.classTests.map((c) => [c.date, c.title, c.students, `${c.averagePct}%`]));

  heading("Practice on PlayCode");
  const p = r.practice;
  table(
    [{ label: "Activity", w: 220 }, { label: "Count", w: 100, align: "right" }, { label: "Students", w: 100, align: "right" }],
    [
      ["Practice answers", p.answers.count, p.answers.students],
      ["Timed mock tests", p.mockTests.count, p.mockTests.students],
      ["AI mock interviews", p.mockInterviews.count, p.mockInterviews.students],
      ["Group discussions", p.groupDiscussions.count, p.groupDiscussions.students],
      ["Written English answers", p.writing.count, p.writing.students],
    ],
  );

  heading("Mentoring");
  const m = r.mentoring;
  facts([
    ["Mentors", String(m.mentors)],
    ["Students with a mentor", `${m.mentees} of ${r.students} (${m.coveragePct}%)`],
    ["Mentees per mentor", m.ratio === null ? "-" : `1:${m.ratio}`],
    ["Mentoring meetings held", `${m.meetings}, with ${m.studentsMet} students`],
    ["Internships verified", `${r.internships.internships}, by ${r.internships.students} students`],
    ["Certifications earned (verified)", `${r.certifications.certifications}, by ${r.certifications.students} students`],
  ]);

  heading("Placement drives");
  if (!r.placements.companies.length) doc.font("Helvetica").fontSize(10).fillColor(muted).text("No drives with registrations in this period.");
  else
    table(
      [{ label: "Date", w: 70 }, { label: "Company", w: 120 }, { label: "Role", w: 140 }, { label: "Package", w: 80, align: "right" }, { label: "Registered", w: 55, align: "right" }, { label: "Offers", w: width - 465, align: "right" }],
      r.placements.companies.map((c) => [c.date, c.company, c.roleTitle, money(c.ctcRupees), c.registered, c.offers]),
    );

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(muted).text(`Generated by PlayCode from attendance and results recorded in it · page ${i + 1} of ${range.count}`, 48, doc.page.height - 36, { width, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
