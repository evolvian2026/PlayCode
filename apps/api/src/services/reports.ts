import PDFDocument from "pdfkit";
import { and, eq, gte, inArray } from "drizzle-orm";
import { addDays, type Role } from "@playcode/core";
import type { Db } from "../db/client";
import { assignments, memberships, orgUnits, reportSubscriptions, sessions, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { forbidden } from "../lib/errors";
import { mailer } from "../lib/mailer";
import { engagement, readinessReport, skillsReport } from "./analytics";
import { effectiveBranding } from "./branding";
import { listPaths } from "./paths";
import { descendants, scopedUnitIds, studentIdsInUnits, tenantUnits, type AuthContext } from "./scope";
import { getTenant, streakRules, tenantToday } from "./tenant";

// The weekly report a TPO, HOD or L&D manager gets as a PDF: activity,
// placement readiness, weakest skills, learning paths and who needs help.
// It is the same data as the console overview, for people who live in email.

export type ReportData = Awaited<ReturnType<typeof reportData>>;

export async function reportData(db: Db, args: { auth: AuthContext; unitId?: string | null; now: Date }) {
  const tenant = await getTenant(db, args.auth.tenantId!);
  const units = await tenantUnits(db, tenant.id);
  const scoped = await scopedUnitIds(db, args.auth);
  if (args.unitId && !scoped.includes(args.unitId)) throw forbidden("That batch or section is outside your scope");
  const unitIds = args.unitId ? descendants(units, [args.unitId]) : scoped;
  const studentIds = await studentIdsInUnits(db, tenant.id, unitIds);
  const today = tenantToday(tenant, args.now);
  const [eng, readiness, skills, paths, branding] = await Promise.all([
    engagement(db, { studentIds, timeZone: tenant.timeZone, now: args.now, today, rules: streakRules(tenant) }),
    readinessReport(db, studentIds, today),
    skillsReport(db, studentIds),
    listPaths(db, tenant.id, unitIds, args.now),
    effectiveBranding(db, tenant),
  ]);

  // Assignments that closed this week or are still open, with how many students finished.
  const unitSet = new Set(unitIds);
  const recent = (await db.select().from(assignments).where(and(eq(assignments.tenantId, tenant.id), gte(assignments.closeAt, new Date(args.now.getTime() - 7 * 86_400_000))))).filter(
    (a) => a.openAt <= args.now && a.orgUnitIds.some((u) => unitSet.has(u)),
  );
  const finished = recent.length && studentIds.length
    ? await db
        .select({ assignmentId: sessions.assignmentId, userId: sessions.userId, finishedAt: sessions.finishedAt })
        .from(sessions)
        .where(and(inArray(sessions.assignmentId, recent.map((a) => a.id)), inArray(sessions.userId, studentIds)))
    : [];
  const assignmentRows = [];
  for (const a of recent) {
    const targeted = await studentIdsInUnits(db, tenant.id, descendants(units, a.orgUnitIds).filter((u) => unitSet.has(u)));
    const done = new Set(finished.filter((s) => s.assignmentId === a.id && s.finishedAt).map((s) => s.userId));
    assignmentRows.push({ title: a.title, closeAt: a.closeAt, targeted: targeted.length, completed: targeted.filter((id) => done.has(id)).length });
  }

  return {
    appName: branding.appName,
    accent: branding.primaryColor ?? "#5b4bff",
    tenantName: tenant.name,
    scopeName: args.unitId ? (units.find((u) => u.id === args.unitId)?.name ?? "") : "All your batches",
    from: addDays(today, -6),
    to: today,
    generatedAt: args.now,
    engagement: eng,
    readiness: readiness.profiles,
    atRisk: readiness.atRisk.slice(0, 15),
    weakest: skills.weakest,
    paths: paths.filter((p) => p.status === "active"),
    assignments: assignmentRows,
  };
}

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Draw the report. `compress: false` keeps the text readable in the raw PDF (tests). */
export function renderReportPdf(r: ReportData, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: opts.compress ?? true, info: { Title: `${r.appName} weekly report`, Author: r.appName } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 96;
  const ink = "#1d1b2f";
  const muted = "#6b6880";

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(1).fillColor(ink).font("Helvetica-Bold").fontSize(13).text(text).moveDown(0.4);
  };
  const row = (cells: string[], widths: number[], bold = false) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    let x = 48;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(bold ? muted : ink);
    cells.forEach((c, i) => {
      doc.text(c, x, y, { width: widths[i]! - 6, lineBreak: false, ellipsis: true });
      x += widths[i]!;
    });
    doc.moveTo(48, y + 15).lineTo(48 + width, y + 15).lineWidth(0.5).strokeColor("#e4e2ee").stroke();
    doc.x = 48;
    doc.y = y + 20;
  };

  // Title
  doc.rect(0, 0, doc.page.width, 6).fill(r.accent);
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(20).text(`${r.appName} weekly report`, 48, 40);
  doc.font("Helvetica").fontSize(10.5).fillColor(muted).text(`${r.tenantName} · ${r.scopeName} · ${fmtDate(r.from)} to ${fmtDate(r.to)}`);

  // Headline numbers
  const e = r.engagement;
  const kpis: [string, string][] = [
    ["Students", String(e.totalStudents)],
    ["Active this week", `${e.activeLast7Days} (${e.weeklyActivePct}%)`],
    ["Answers this week", String(e.answersLast7Days)],
    ["Answers per active learner", String(e.answersPerActiveStudent)],
  ];
  const boxW = width / 4;
  const top = doc.y + 16;
  kpis.forEach(([label, value], i) => {
    const x = 48 + i * boxW;
    doc.roundedRect(x, top, boxW - 8, 58, 6).lineWidth(0.8).strokeColor("#e4e2ee").stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(muted).text(label, x + 10, top + 10, { width: boxW - 20, lineBreak: false, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(16).fillColor(ink).text(value, x + 10, top + 34, { width: boxW - 28 });
  });
  doc.x = 48;
  doc.y = top + 70;

  // Daily active students, last 14 days
  heading("Daily active students (last 14 days)");
  const chartTop = doc.y;
  const chartH = 80;
  const max = Math.max(1, ...e.daily.map((d) => d.activeStudents));
  const barW = width / 14;
  for (let i = 0; i < 14; i++) {
    const day = addDays(r.to, i - 13);
    const v = e.daily.find((d) => d.day === day)?.activeStudents ?? 0;
    const h = (v / max) * chartH;
    doc.rect(48 + i * barW + 3, chartTop + chartH - h, barW - 6, h).fill(r.accent);
    doc.font("Helvetica").fontSize(7).fillColor(muted).text(day.slice(8), 48 + i * barW, chartTop + chartH + 3, { width: barW, align: "center" });
  }
  doc.x = 48;
  doc.y = chartTop + chartH + 16;

  heading("Placement readiness");
  row(["Profile", "Average", "Ready", "Almost", "Building", "At risk"], [170, 70, 70, 70, 70, 70], true);
  for (const p of r.readiness) row([p.name, `${p.average}`, `${p.bands.ready}`, `${p.bands.almost}`, `${p.bands.building}`, `${p.bands.at_risk}`], [170, 70, 70, 70, 70, 70]);

  heading("Weakest skills");
  row(["Skill", "Average mastery", "Students who practised"], [260, 120, 140], true);
  for (const s of r.weakest) row([`${s.topicName}: ${s.name}`, `${s.avgMastery}%`, `${s.attemptedPct}%`], [260, 120, 140]);

  if (r.assignments.length) {
    heading("Assignments this week");
    row(["Assignment", "Closes", "Completed"], [280, 120, 120], true);
    for (const a of r.assignments) row([a.title, a.closeAt.toISOString().slice(0, 10), `${a.completed} / ${a.targeted}`], [280, 120, 120]);
  }

  if (r.paths.length) {
    heading("Learning paths");
    row(["Path", "Completed", "Behind schedule"], [280, 120, 120], true);
    for (const p of r.paths) row([p.title, `${p.completed} / ${p.learners}`, `${p.overdue}`], [280, 120, 120]);
  }

  heading("Students who need attention");
  if (r.atRisk.length === 0) doc.font("Helvetica").fontSize(10).fillColor(muted).text("Nobody is at risk on service-company readiness this week.");
  else {
    row(["Student", "Roll no", "Service readiness", "Product readiness"], [200, 110, 110, 110], true);
    for (const s of r.atRisk) row([s.name, s.rollNo ?? "", `${s.service}`, `${s.product}`], [200, 110, 110, 110]);
  }

  doc.moveDown(2).font("Helvetica").fontSize(8).fillColor(muted).text(`Generated ${r.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC. Readiness is 0-100 from skill mastery; open the console for details.`);
  doc.end();
  return done;
}

/** Staff roles and tenant of a user, as the report needs them outside a request. */
async function authFor(db: Db, userId: string, tenantId: string): Promise<AuthContext | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== "active") return null;
  const roles = [...new Set((await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId))).map((m) => m.role as Role))];
  if (roles.every((r) => r === "student")) return null;
  return { userId, tenantId, roles };
}

export async function getSubscription(db: Db, tenantId: string, userId: string) {
  const [sub] = await db.select().from(reportSubscriptions).where(and(eq(reportSubscriptions.userId, userId), eq(reportSubscriptions.tenantId, tenantId)));
  return sub ?? null;
}

export async function saveSubscription(db: Db, auth: AuthContext, input: { enabled: boolean; unitId: string | null; weekday: number; hour: number }) {
  if (input.unitId && !(await scopedUnitIds(db, auth)).includes(input.unitId)) throw forbidden("That batch or section is outside your scope");
  const values = { ...input, lastError: null };
  await db
    .insert(reportSubscriptions)
    .values({ tenantId: auth.tenantId!, userId: auth.userId, ...values })
    .onConflictDoUpdate({ target: [reportSubscriptions.userId, reportSubscriptions.tenantId], set: values });
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "reports.subscription", data: input });
  return getSubscription(db, auth.tenantId!, auth.userId);
}

function localWeekdayHour(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
  return { weekday: wd, hour: Number(parts.find((p) => p.type === "hour")!.value) };
}

/** Hourly job: email every report that is due (its weekday, at or after its hour, not sent in the last 6 days). */
export async function sendDueReports(db: Db, now: Date) {
  const m = mailer();
  if (!m) return { sent: 0, skipped: "email is not configured (SMTP_URL)" };
  const subs = await db
    .select({ sub: reportSubscriptions, email: users.email, name: users.name, timeZone: tenants.timeZone })
    .from(reportSubscriptions)
    .innerJoin(users, eq(users.id, reportSubscriptions.userId))
    .innerJoin(tenants, eq(tenants.id, reportSubscriptions.tenantId))
    .where(eq(reportSubscriptions.enabled, true));
  let sent = 0;
  for (const { sub, email, name, timeZone } of subs) {
    const local = localWeekdayHour(now, timeZone);
    const recentlySent = sub.lastSentAt && now.getTime() - sub.lastSentAt.getTime() < 6 * 86_400_000;
    if (local.weekday !== sub.weekday || local.hour < sub.hour || recentlySent) continue;
    try {
      const auth = await authFor(db, sub.userId, sub.tenantId);
      if (!auth) {
        await db.update(reportSubscriptions).set({ enabled: false, lastError: "The account is no longer an active staff account" }).where(eq(reportSubscriptions.id, sub.id));
        continue;
      }
      const data = await reportData(db, { auth, unitId: sub.unitId, now });
      const pdf = await renderReportPdf(data);
      await m.send({
        to: email,
        subject: `${data.appName} weekly report: ${data.scopeName}, ${fmtDate(data.from)} to ${fmtDate(data.to)}`,
        text: [
          `Hello ${name.split(" ")[0]},`,
          "",
          `This week ${data.engagement.activeLast7Days} of ${data.engagement.totalStudents} students practised (${data.engagement.weeklyActivePct}%), answering ${data.engagement.answersLast7Days} questions.`,
          data.atRisk.length ? `${data.atRisk.length} students need attention; they are listed in the attached report.` : "Nobody is at risk this week.",
          "",
          "The full report is attached. You can change or stop this email under Reports in the console.",
        ].join("\n"),
        attachments: [{ filename: `weekly-report-${data.to}.pdf`, content: pdf, contentType: "application/pdf" }],
      });
      await db.update(reportSubscriptions).set({ lastSentAt: now, lastError: null }).where(eq(reportSubscriptions.id, sub.id));
      sent++;
    } catch (err) {
      await db.update(reportSubscriptions).set({ lastError: (err as Error).message.slice(0, 300) }).where(eq(reportSubscriptions.id, sub.id));
    }
  }
  return { sent };
}

export async function unitOptions(db: Db, auth: AuthContext) {
  const scoped = new Set(await scopedUnitIds(db, auth));
  return (await db.select({ id: orgUnits.id, name: orgUnits.name, kind: orgUnits.kind }).from(orgUnits).where(eq(orgUnits.tenantId, auth.tenantId!))).filter((u) => scoped.has(u.id));
}
