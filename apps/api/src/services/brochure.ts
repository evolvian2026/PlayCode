import { and, eq, sql } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { formatLpa } from "@playcode/core";
import type { Db } from "../db/client";
import { placementApplications, placementDrives, tenants, type TenantSettings } from "../db/schema";
import { audit } from "../lib/audit";
import { activityReport } from "./activity-report";
import { effectiveBranding } from "./branding";
import { batchReport } from "./graduate-outcomes";
import { pdfSafe } from "./papers";
import type { AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// The placement brochure the placement cell sends to companies when it
// invites them for the season: who the institution is, the graduating batch
// by department, how last year's batch did, who has hired on campus, the
// training students get, and whom to contact. The figures come from the
// records already on PlayCode, so the brochure needs no retyping each year.

export type Brochure = NonNullable<TenantSettings["brochure"]>;

export async function brochureSettings(db: Db, tenantId: string): Promise<Brochure> {
  const t = await getTenant(db, tenantId);
  return { about: "", contactName: "", contactRole: "", contactEmail: "", contactPhone: "", ...t.settings.brochure };
}

export async function setBrochureSettings(db: Db, auth: { tenantId: string; userId: string }, input: Brochure) {
  const clean = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, (v ?? "").trim()]));
  await db
    .update(tenants)
    .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ brochure: clean })}::jsonb` })
    .where(eq(tenants.id, auth.tenantId));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.brochure" });
  return brochureSettings(db, auth.tenantId);
}

export async function brochureData(db: Db, auth: AuthContext, year: number, now: Date) {
  const tenantId = auth.tenantId!;
  const tenant = await getTenant(db, tenantId);
  const today = tenantToday(tenant, now);
  const yearAgo = tenantToday(tenant, new Date(now.getTime() - 365 * 86_400_000));
  const [settings, branding, batch, last, activity, recruiters] = await Promise.all([
    brochureSettings(db, tenantId),
    effectiveBranding(db, tenant),
    batchReport(db, auth, year),
    batchReport(db, auth, year - 1),
    activityReport(db, auth, { from: yearAgo, to: today }, now),
    // Every company that has made offers on campus, most offers first.
    db
      .select({ company: sql<string>`min(trim(${placementDrives.company}))`, offers: sql<number>`count(*)::int` })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.status, "offered")))
      .groupBy(sql`lower(trim(${placementDrives.company}))`)
      .orderBy(sql`2 desc`, sql`1`),
  ]);
  const t = last.totals;
  return {
    institution: tenant.name,
    accent: branding.primaryColor ?? "#5b4bff",
    year,
    settings,
    batch: { students: batch.totals.graduating, departments: batch.departments.map((d) => ({ department: d.department, students: d.graduating })) },
    lastSeason: t.graduating
      ? { year: year - 1, graduating: t.graduating, placed: t.placed, placedPct: Math.round((t.placed / t.graduating) * 100), higherStudies: t.higherStudies, medianCtc: t.medianCtc, highestCtc: t.highestCtc, departments: last.departments.map((d) => ({ department: d.department, graduating: d.graduating, placed: d.placed, medianCtc: d.medianCtc })) }
      : null,
    thisSeason: batch.totals.placed ? { placed: batch.totals.placed, highestCtc: batch.totals.highestCtc } : null,
    recruiters: recruiters.slice(0, 40).map((r) => r.company),
    training: { sessions: activity.training.totals.sessions, hours: activity.training.totals.hours, studentsTrainedPct: activity.training.totals.studentsTrainedPct, byKind: activity.training.byKind.filter((k) => k.sessions > 0).map((k) => ({ label: k.label, hours: k.hours })) },
  };
}

export type BrochureData = Awaited<ReturnType<typeof brochureData>>;

export function brochurePdf(d: BrochureData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `${d.institution} - placement brochure ${d.year}`, Author: d.institution } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#17162b";
  const muted = "#5d5b76";
  const width = doc.page.width - 96;
  const money = (n: number | null) => (n === null ? "-" : pdfSafe(formatLpa(n)));
  const season = `${d.year - 1}-${String(d.year).slice(2)}`;

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(1).fillColor(d.accent).font("Helvetica-Bold").fontSize(13).text(text.toUpperCase(), 48, doc.y, { characterSpacing: 0.6 });
    doc.moveTo(48, doc.y + 2).lineTo(48 + width, doc.y + 2).lineWidth(0.6).strokeColor(d.accent).stroke();
    doc.moveDown(0.6);
  };
  const para = (text: string) => doc.font("Helvetica").fontSize(10.5).fillColor(ink).text(pdfSafe(text), 48, doc.y, { width, lineGap: 2 });
  // Big figures in a row, for the headline numbers.
  const stats = (items: [string, string][]) => {
    const w = width / items.length;
    const y = doc.y;
    items.forEach(([label, value], i) => {
      doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text(pdfSafe(value), 48 + i * w, y, { width: w - 8 });
      doc.font("Helvetica").fontSize(9).fillColor(muted).text(pdfSafe(label), 48 + i * w, y + 26, { width: w - 8 });
    });
    doc.y = y + 52;
    doc.x = 48;
  };
  const table = (cols: { label: string; w: number; align?: "left" | "right" }[], rows: (string | number)[][]) => {
    const line = (cells: (string | number)[], bold: boolean) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const y = doc.y;
      let x = 48;
      let h = 0;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(bold ? muted : ink);
      cells.forEach((c, i) => {
        const text = pdfSafe(String(c));
        doc.text(text, x, y, { width: cols[i]!.w - 6, align: cols[i]!.align ?? "left" });
        h = Math.max(h, doc.heightOfString(text, { width: cols[i]!.w - 6 }));
        x += cols[i]!.w;
      });
      doc.y = y + h + 5;
    };
    line(cols.map((c) => c.label), true);
    for (const row of rows) line(row, false);
    doc.x = 48;
  };

  // Cover band.
  doc.rect(0, 0, doc.page.width, 190).fill(d.accent);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(26).text(pdfSafe(d.institution), 48, 64, { width });
  doc.font("Helvetica").fontSize(14).text(`Campus placements ${season}`, 48, doc.y + 6, { width });
  doc.fontSize(11).text(`Graduating batch of ${d.year}`, 48, doc.y + 2, { width });
  doc.y = 220;
  doc.x = 48;

  if (d.settings.about) {
    heading("About us");
    para(d.settings.about);
  }

  heading(`The batch of ${d.year}`);
  if (!d.batch.students) para("The graduating batch is not on record yet.");
  else {
    stats([
      ["Students graduating", String(d.batch.students)],
      ["Departments", String(d.batch.departments.length)],
      ...(d.thisSeason ? ([["Placed so far this season", String(d.thisSeason.placed)]] as [string, string][]) : []),
    ]);
    table([{ label: "Department", w: width - 120 }, { label: "Students", w: 120, align: "right" }], d.batch.departments.map((x) => [x.department, x.students]));
  }

  if (d.lastSeason) {
    const l = d.lastSeason;
    heading(`Last season: batch of ${l.year}`);
    stats([
      ["Students placed", `${l.placedPct}%`],
      ["Median package", money(l.medianCtc)],
      ["Highest package", money(l.highestCtc)],
    ]);
    table(
      [
        { label: "Department", w: width - 270 },
        { label: "Graduated", w: 80, align: "right" },
        { label: "Placed", w: 80, align: "right" },
        { label: "Median", w: 110, align: "right" },
      ],
      l.departments.map((x) => [x.department, x.graduating, x.placed, money(x.medianCtc)]),
    );
    if (l.higherStudies) doc.moveDown(0.3).font("Helvetica").fontSize(9.5).fillColor(muted).text(`${l.higherStudies} more went on to higher studies.`, 48);
  }

  if (d.recruiters.length) {
    heading("Our recruiters");
    doc.font("Helvetica").fontSize(10.5).fillColor(ink).text(pdfSafe(d.recruiters.join("   ·   ")), 48, doc.y, { width, lineGap: 4 });
  }

  if (d.training.sessions) {
    heading("Training for placements");
    para(`In the last twelve months our students had ${d.training.sessions} training sessions, ${d.training.hours} hours in all, and ${d.training.studentsTrainedPct}% of them attended. Every student also practises coding, aptitude and interviews on PlayCode, and their scores are verified.`);
    if (d.training.byKind.length) doc.moveDown(0.3).font("Helvetica").fontSize(9.5).fillColor(muted).text(pdfSafe(d.training.byKind.map((k) => `${k.label}: ${k.hours} h`).join("  ·  ")), 48);
  }

  const c = d.settings;
  if (c.contactName || c.contactEmail || c.contactPhone) {
    heading("To recruit from us");
    if (c.contactName) doc.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(pdfSafe(c.contactName), 48);
    if (c.contactRole) doc.font("Helvetica").fontSize(10).fillColor(muted).text(pdfSafe(c.contactRole), 48);
    const reach = [c.contactEmail, c.contactPhone].filter(Boolean).join("   ·   ");
    if (reach) doc.font("Helvetica").fontSize(10.5).fillColor(ink).text(pdfSafe(reach), 48);
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(muted).text(pdfSafe(`${d.institution} · Placement brochure ${season} · ${i + 1} of ${range.count}`), 48, doc.page.height - 36, { width, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
