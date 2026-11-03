import PDFDocument from "pdfkit";
import { and, eq, inArray } from "drizzle-orm";
import { formatLpa } from "@playcode/core";
import type { Db } from "../db/client";
import { academicRecords, placementApplications, placementDrives, tenants, users, type ApplicationStatus } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { pdfSafe } from "./papers";
import { drawResume, resumeData, type ResumeData } from "./resume";

// The resume book: what the placement cell sends a company before its drive,
// one PDF with a cover list of the students (by the stage they've reached)
// and each student's verified resume after it. Each resume is the same one
// the student downloads, with whatever they chose to hide left out.

export type BookStage = "registered" | "in_selection" | "offered";
const MAX = 300;

export async function resumeBook(db: Db, args: { tenantId: string; actorId: string; driveId: string; stage: BookStage; now: Date }) {
  const [drive] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, args.driveId), eq(placementDrives.tenantId, args.tenantId)));
  if (!drive) throw notFound("Placement drive");
  const keep: Record<BookStage, (s: ApplicationStatus) => boolean> = {
    registered: (s) => s !== "withdrawn",
    in_selection: (s) => s === "registered" || s === "shortlisted",
    offered: (s) => s === "offered",
  };
  const apps = (await db.select().from(placementApplications).where(eq(placementApplications.driveId, drive.id))).filter((a) => keep[args.stage](a.status));
  if (!apps.length) throw badRequest("No students at that stage yet");
  if (apps.length > MAX) throw badRequest(`That's ${apps.length} resumes; narrow it to ${MAX} or fewer`);
  const ids = apps.map((a) => a.userId);
  const [people, records, [tenant]] = await Promise.all([
    db.select({ id: users.id, name: users.name, rollNo: users.rollNo, status: users.status }).from(users).where(inArray(users.id, ids)),
    db.select().from(academicRecords).where(inArray(academicRecords.userId, ids)),
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, args.tenantId)),
  ]);
  const students = people
    .filter((p) => p.status === "active")
    .sort((a, b) => (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));
  const resumes: ResumeData[] = [];
  for (const s of students) resumes.push(await resumeData(db, s.id, args.now));

  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${drive.company} - resumes from ${tenant!.name}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const muted = "#5b5b6b";
  doc.fillColor(muted).font("Helvetica").fontSize(10).text(pdfSafe(tenant!.name));
  doc.fillColor("#16161d").font("Helvetica-Bold").fontSize(20).text(pdfSafe(`Resumes for ${drive.company}`));
  doc.font("Helvetica").fontSize(10.5).fillColor(muted).text(pdfSafe(`${drive.roleTitle} · ${formatLpa(drive.ctcRupees)} · drive on ${drive.driveDate} · ${students.length} students`));
  doc.moveDown(1);
  const cgpa = new Map(records.map((r) => [r.userId, r.cgpa]));
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#16161d");
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
    [[48, 30], [82, 90], [176, 250], [430, 117]].forEach(([x, w], i) => doc.text(pdfSafe(cells[i] ?? ""), x!, y, { width: w!, lineBreak: false, ellipsis: true }));
    doc.y = y + 15;
  };
  row(["#", "Roll no", "Name", "CGPA"], true);
  students.forEach((s, i) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    // Marks the student hid stay hidden here too.
    row([String(i + 1), s.rollNo ?? "", s.name, resumes[i]!.hide.marks ? "-" : String(cgpa.get(s.id) ?? "-")]);
  });
  doc.x = 48;
  for (const r of resumes) {
    doc.addPage();
    drawResume(doc, r);
  }
  doc.end();
  await audit(db, { tenantId: args.tenantId, actorId: args.actorId, action: "placements.resume_book", target: drive.id, data: { stage: args.stage, students: students.length } });
  return { pdf: await done, fileName: `${drive.company.replace(/[^A-Za-z0-9]+/g, "-")}-resumes.pdf`, students: students.length };
}
