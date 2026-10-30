import { and, desc, eq, inArray } from "drizzle-orm";
import { INTRO_PURPOSES, MAX_PENDING_INTROS, type IntroPurpose } from "@playcode/core";
import type { Db } from "../db/client";
import { alumni, alumniIntros, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { mailer } from "../lib/mailer";
import { appLink, enqueue, processOutbox } from "./notifications";
import { renderResumePdf, resumeData } from "./resume";
import { studentUnitIdsWithAncestors, tenantUnits } from "./scope";
import { getTenant } from "./tenant";

// Alumni connect. The placement cell keeps a list of graduates who are happy
// to help: where they work, and whether they'll give a referral or advice.
// Students find someone at a company they're aiming for and ask for an
// introduction with a short note; the placement cell reads it and sends it on
// by email with the student's resume, or declines with a reason. Alumni email
// addresses are never shown to students, so nobody is contacted without the
// placement cell's say.

type Auth = { tenantId: string; userId: string };
type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof alumni.$inferSelect;

export interface AlumnusInput {
  name: string;
  email: string;
  graduationYear: number;
  department: string;
  company: string;
  role: string;
  city: string;
  openToReferrals: boolean;
  openToAdvice: boolean;
  active: boolean;
}

const publicView = (a: Row) => ({ id: a.id, name: a.name, graduationYear: a.graduationYear, department: a.department, company: a.company, role: a.role, city: a.city, openToReferrals: a.openToReferrals, openToAdvice: a.openToAdvice });

async function load(db: Db, tenantId: string, id: string) {
  const [a] = await db.select().from(alumni).where(and(eq(alumni.id, id), eq(alumni.tenantId, tenantId)));
  if (!a) throw notFound("Alumnus");
  return a;
}

// ---------- Placement cell ----------

export async function listAlumni(db: Db, tenantId: string) {
  const [rows, intros] = await Promise.all([
    db.select().from(alumni).where(eq(alumni.tenantId, tenantId)).orderBy(alumni.company, alumni.name),
    db.select({ alumnusId: alumniIntros.alumnusId, status: alumniIntros.status }).from(alumniIntros).where(eq(alumniIntros.tenantId, tenantId)),
  ]);
  return {
    alumni: rows.map((a) => ({ ...a, introsSent: intros.filter((i) => i.alumnusId === a.id && i.status === "sent").length })),
    pending: intros.filter((i) => i.status === "pending").length,
    emailConfigured: Boolean(mailer()),
  };
}

const clean = (i: AlumnusInput) => ({ ...i, name: i.name.trim(), email: i.email.trim().toLowerCase(), department: i.department.trim(), company: i.company.trim(), role: i.role.trim(), city: i.city.trim() });

export async function createAlumnus(db: Db, auth: Auth, input: AlumnusInput, now: Date) {
  const [dup] = await db.select({ id: alumni.id }).from(alumni).where(and(eq(alumni.tenantId, auth.tenantId), eq(alumni.email, input.email.trim().toLowerCase())));
  if (dup) throw conflict("exists", "Someone with that email is already on the list");
  const [a] = await db.insert(alumni).values({ tenantId: auth.tenantId, ...clean(input), createdAt: now }).returning();
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "alumni.create", target: a!.id });
  return a!;
}

export async function updateAlumnus(db: Db, auth: Auth, id: string, input: AlumnusInput) {
  const a = await load(db, auth.tenantId, id);
  const [u] = await db.update(alumni).set(clean(input)).where(eq(alumni.id, a.id)).returning();
  return u!;
}

/** Removing an alumnus removes their introductions too (they asked to be forgotten, or left the list). */
export async function deleteAlumnus(db: Db, auth: Auth, id: string) {
  const a = await load(db, auth.tenantId, id);
  await db.delete(alumni).where(eq(alumni.id, a.id));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "alumni.delete", target: a.id });
  return { ok: true };
}

export async function introQueue(db: Db, tenantId: string, status: "pending" | "sent" | "declined") {
  const rows = await db
    .select({ i: alumniIntros, a: alumni, name: users.name, rollNo: users.rollNo })
    .from(alumniIntros)
    .innerJoin(alumni, eq(alumni.id, alumniIntros.alumnusId))
    .innerJoin(users, eq(users.id, alumniIntros.userId))
    .where(and(eq(alumniIntros.tenantId, tenantId), eq(alumniIntros.status, status)))
    .orderBy(status === "pending" ? alumniIntros.createdAt : desc(alumniIntros.decidedAt));
  return {
    intros: rows.slice(0, 200).map(({ i, a, name, rollNo }) => ({
      id: i.id,
      purpose: i.purpose,
      purposeLabel: INTRO_PURPOSES[i.purpose],
      message: i.message,
      createdAt: i.createdAt,
      decidedAt: i.decidedAt,
      declineNote: i.declineNote,
      student: { id: i.userId, name, rollNo },
      alumnus: { id: a.id, name: a.name, company: a.company, role: a.role, graduationYear: a.graduationYear },
    })),
  };
}

/** Send the introduction (email to the alumnus, with the student's resume) or decline it with a reason. */
export async function decideIntro(db: Db, auth: Auth, id: string, input: { send: boolean; note: string | null }, now: Date) {
  const [row] = await db
    .select({ i: alumniIntros, a: alumni })
    .from(alumniIntros)
    .innerJoin(alumni, eq(alumni.id, alumniIntros.alumnusId))
    .where(and(eq(alumniIntros.id, id), eq(alumniIntros.tenantId, auth.tenantId)));
  if (!row) throw notFound("Introduction");
  const { i, a } = row;
  if (i.status !== "pending") throw badRequest("This one has been decided");
  if (!input.send && !input.note?.trim()) throw badRequest("Tell the student why");
  if (input.send) {
    const m = mailer();
    if (!m) throw badRequest("Email isn't set up on this server, so introductions can't be sent");
    const tenant = await getTenant(db, auth.tenantId);
    const resume = await resumeData(db, i.userId, now);
    // The student's department, from the section they're in.
    const [units, mine] = await Promise.all([tenantUnits(db, auth.tenantId), studentUnitIdsWithAncestors(db, auth.tenantId, i.userId)]);
    const department = units.find((u) => u.kind === "department" && mine.includes(u.id))?.name ?? null;
    await m.send({
      to: a.email,
      subject: `${resume.name} from ${tenant.name} would like ${i.purpose === "referral" ? "a referral" : "your advice"}`,
      text: [
        `Dear ${a.name},`,
        "",
        `${resume.name}, a ${department ? `${department} ` : ""}student at ${tenant.name}${resume.academic?.graduationYear ? ` graduating in ${resume.academic.graduationYear}` : ""}, asked us to introduce them to you${a.company ? ` at ${a.company}` : ""}. In their words:`,
        "",
        i.message,
        "",
        `Their resume is attached${resume.publicUrl ? `, and their verified profile is at ${resume.publicUrl}` : ""}. If you can help, reply to them at ${resume.email}. If not, there's no need to do anything.`,
        "",
        `Thank you for staying in touch with ${tenant.name}.`,
        `The placement cell`,
      ].join("\n"),
      attachments: [{ filename: `${resume.name.replace(/[^A-Za-z0-9]+/g, "-")}-resume.pdf`, content: await renderResumePdf(resume), contentType: "application/pdf" }],
    });
  }
  await db.update(alumniIntros).set({ status: input.send ? "sent" : "declined", decidedBy: auth.userId, decidedAt: now, declineNote: input.send ? null : input.note!.trim() }).where(eq(alumniIntros.id, i.id));
  await enqueue(db, [
    {
      tenantId: auth.tenantId,
      userId: i.userId,
      template: "placement",
      title: input.send ? `Your introduction to ${a.name} has been sent` : `Your introduction to ${a.name}`,
      body: input.send ? `${a.name} has your note and resume. If they can help, they'll write to you by email.` : input.note!.trim().slice(0, 160),
      link: appLink("/play/alumni"),
      dedupeKey: `alumni-intro:${i.id}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: input.send ? "alumni.intro_sent" : "alumni.intro_declined", target: i.id, data: { alumnusId: a.id, userId: i.userId } });
  return introQueue(db, auth.tenantId, "pending");
}

// ---------- Students ----------

/** Alumni open to help, by company or name, with the student's own requests. */
export async function browseAlumni(db: Db, ctx: Ctx) {
  const [rows, mine] = await Promise.all([
    db.select().from(alumni).where(and(eq(alumni.tenantId, ctx.tenantId), eq(alumni.active, true))).orderBy(alumni.company, alumni.name),
    myIntros(db, ctx),
  ]);
  return { alumni: rows.filter((a) => a.openToAdvice || a.openToReferrals).map(publicView), ...mine };
}

export async function myIntros(db: Db, ctx: Ctx) {
  const rows = await db
    .select({ i: alumniIntros, name: alumni.name, company: alumni.company })
    .from(alumniIntros)
    .innerJoin(alumni, eq(alumni.id, alumniIntros.alumnusId))
    .where(and(eq(alumniIntros.tenantId, ctx.tenantId), eq(alumniIntros.userId, ctx.userId)))
    .orderBy(desc(alumniIntros.createdAt));
  return { intros: rows.map(({ i, name, company }) => ({ id: i.id, alumnusId: i.alumnusId, alumnus: name, company, purpose: i.purpose, purposeLabel: INTRO_PURPOSES[i.purpose], message: i.message, status: i.status, declineNote: i.declineNote, createdAt: i.createdAt })) };
}

export async function requestIntro(db: Db, ctx: Ctx, input: { alumnusId: string; purpose: IntroPurpose; message: string }) {
  const a = await load(db, ctx.tenantId, input.alumnusId);
  if (!a.active || !(input.purpose === "referral" ? a.openToReferrals : a.openToAdvice)) throw badRequest(`${a.name} isn't taking ${input.purpose === "referral" ? "referral" : "advice"} requests`);
  const mine = await db.select().from(alumniIntros).where(and(eq(alumniIntros.userId, ctx.userId), inArray(alumniIntros.status, ["pending", "sent"])));
  if (mine.some((i) => i.alumnusId === a.id)) throw conflict("asked", `You have already asked to meet ${a.name}`);
  if (mine.filter((i) => i.status === "pending").length >= MAX_PENDING_INTROS) throw badRequest(`You have ${MAX_PENDING_INTROS} introductions waiting. Wait for those first.`);
  await db.insert(alumniIntros).values({ tenantId: ctx.tenantId, alumnusId: a.id, userId: ctx.userId, purpose: input.purpose, message: input.message.trim(), createdAt: ctx.now });
  return browseAlumni(db, ctx);
}

/** A student can take back a request the placement cell hasn't acted on. */
export async function withdrawIntro(db: Db, ctx: Ctx, id: string) {
  const [i] = await db.select().from(alumniIntros).where(and(eq(alumniIntros.id, id), eq(alumniIntros.userId, ctx.userId)));
  if (!i || i.status !== "pending") throw notFound("Introduction");
  await db.delete(alumniIntros).where(eq(alumniIntros.id, i.id));
  return browseAlumni(db, ctx);
}
