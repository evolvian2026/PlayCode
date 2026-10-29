import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { correctionError, HELP_CATEGORIES, RECORD_FIELDS, type HelpCategory, type RecordField } from "@playcode/core";
import type { Db } from "../db/client";
import { academicRecords, helpMessages, helpTickets, users, type RecordCorrection } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";

// The placement helpdesk. Students ask the placement cell about their record,
// a drive or their documents in one thread per question, instead of chasing
// them on WhatsApp. When their CGPA, backlogs or marks are wrong they say what
// the right value is; the placement cell checks it against the university
// records and applies it in one click, which updates the record drives use.

type Ticket = typeof helpTickets.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };
const MAX_OPEN = 5;

export interface NewTicket {
  category: HelpCategory;
  subject: string;
  message: string;
  correction: { field: RecordField; proposed: number } | null;
}

const fmt = (v: number | null) => (v === null ? "not on record" : String(v));

async function thread(db: Db, t: Ticket) {
  const messages = await db
    .select({ id: helpMessages.id, fromStaff: helpMessages.fromStaff, body: helpMessages.body, createdAt: helpMessages.createdAt, author: users.name })
    .from(helpMessages)
    .leftJoin(users, eq(users.id, helpMessages.authorId))
    .where(eq(helpMessages.ticketId, t.id))
    .orderBy(asc(helpMessages.createdAt));
  return {
    id: t.id,
    category: t.category,
    categoryLabel: HELP_CATEGORIES[t.category],
    subject: t.subject,
    status: t.status,
    correction: t.correction ? { ...t.correction, label: RECORD_FIELDS[t.correction.field].label } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: messages.map((m) => ({ ...m, author: m.fromStaff ? (m.author ?? "Placement cell") : m.author })),
  };
}

// ---------- Students ----------

export async function myTickets(db: Db, ctx: Ctx) {
  const rows = await db.select().from(helpTickets).where(and(eq(helpTickets.tenantId, ctx.tenantId), eq(helpTickets.userId, ctx.userId))).orderBy(desc(helpTickets.updatedAt));
  return { tickets: rows.map((t) => ({ id: t.id, categoryLabel: HELP_CATEGORIES[t.category], subject: t.subject, status: t.status, updatedAt: t.updatedAt })) };
}

export async function openTicket(db: Db, ctx: Ctx, input: NewTicket) {
  const open = await db.select({ id: helpTickets.id }).from(helpTickets).where(and(eq(helpTickets.tenantId, ctx.tenantId), eq(helpTickets.userId, ctx.userId), ne(helpTickets.status, "closed")));
  if (open.length >= MAX_OPEN) throw badRequest(`You have ${open.length} questions open. Close the ones that are sorted first.`);
  let correction: RecordCorrection | null = null;
  if (input.correction) {
    if (input.category !== "record") throw badRequest("Corrections are for academic record questions");
    const err = correctionError(input.correction.field, input.correction.proposed);
    if (err) throw badRequest(err);
    const [record] = await db.select().from(academicRecords).where(eq(academicRecords.userId, ctx.userId));
    const current = (record?.[input.correction.field] as number | null | undefined) ?? null;
    if (current === input.correction.proposed) throw badRequest(`Your ${RECORD_FIELDS[input.correction.field].label} is already ${current}`);
    correction = { field: input.correction.field, current, proposed: input.correction.proposed, status: "pending" };
  }
  const [t] = await db.insert(helpTickets).values({ tenantId: ctx.tenantId, userId: ctx.userId, category: input.category, subject: input.subject, correction, createdAt: ctx.now, updatedAt: ctx.now }).returning();
  await db.insert(helpMessages).values({ ticketId: t!.id, authorId: ctx.userId, fromStaff: false, body: input.message, createdAt: ctx.now });
  return thread(db, t!);
}

async function loadMine(db: Db, ctx: Ctx, id: string) {
  const [t] = await db.select().from(helpTickets).where(and(eq(helpTickets.id, id), eq(helpTickets.tenantId, ctx.tenantId)));
  if (!t || t.userId !== ctx.userId) throw notFound("Question");
  return t;
}

export async function myTicket(db: Db, ctx: Ctx, id: string) {
  return thread(db, await loadMine(db, ctx, id));
}

/** A student's reply reopens the question. */
export async function studentReply(db: Db, ctx: Ctx, id: string, body: string) {
  const t = await loadMine(db, ctx, id);
  if (t.status === "closed") throw badRequest("This question is closed. Ask a new one.");
  await db.insert(helpMessages).values({ ticketId: t.id, authorId: ctx.userId, fromStaff: false, body, createdAt: ctx.now });
  const [u] = await db.update(helpTickets).set({ status: "open", updatedAt: ctx.now }).where(eq(helpTickets.id, t.id)).returning();
  return thread(db, u!);
}

export async function studentClose(db: Db, ctx: Ctx, id: string) {
  const t = await loadMine(db, ctx, id);
  const [u] = await db.update(helpTickets).set({ status: "closed", updatedAt: ctx.now }).where(eq(helpTickets.id, t.id)).returning();
  return thread(db, u!);
}

// ---------- Placement cell ----------

async function inScope(db: Db, auth: AuthContext) {
  return new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
}

async function loadForStaff(db: Db, auth: AuthContext, id: string) {
  const [t] = await db.select().from(helpTickets).where(and(eq(helpTickets.id, id), eq(helpTickets.tenantId, auth.tenantId!)));
  if (!t || !(await inScope(db, auth)).has(t.userId)) throw notFound("Question");
  return t;
}

export async function inbox(db: Db, auth: AuthContext, status: Ticket["status"]) {
  const scope = await inScope(db, auth);
  const rows = (
    await db
      .select({ t: helpTickets, name: users.name, rollNo: users.rollNo })
      .from(helpTickets)
      .innerJoin(users, eq(users.id, helpTickets.userId))
      .where(and(eq(helpTickets.tenantId, auth.tenantId!), eq(helpTickets.status, status)))
      .orderBy(status === "open" ? asc(helpTickets.updatedAt) : desc(helpTickets.updatedAt))
  ).filter((r) => scope.has(r.t.userId));
  const open = (await db.select({ userId: helpTickets.userId }).from(helpTickets).where(and(eq(helpTickets.tenantId, auth.tenantId!), eq(helpTickets.status, "open")))).filter((r) => scope.has(r.userId)).length;
  return {
    counts: { open },
    tickets: rows.slice(0, 200).map((r) => ({
      id: r.t.id,
      categoryLabel: HELP_CATEGORIES[r.t.category],
      subject: r.t.subject,
      status: r.t.status,
      correctionPending: r.t.correction?.status === "pending",
      updatedAt: r.t.updatedAt,
      student: { id: r.t.userId, name: r.name, rollNo: r.rollNo },
    })),
  };
}

export async function staffTicket(db: Db, auth: AuthContext, id: string) {
  const t = await loadForStaff(db, auth, id);
  const [s] = await db.select({ id: users.id, name: users.name, rollNo: users.rollNo, email: users.email }).from(users).where(eq(users.id, t.userId));
  const [record] = await db.select().from(academicRecords).where(eq(academicRecords.userId, t.userId));
  return { ...(await thread(db, t)), student: s!, record: record ? { cgpa: record.cgpa, backlogs: record.backlogs, tenthPct: record.tenthPct, twelfthPct: record.twelfthPct, graduationYear: record.graduationYear } : null };
}

function tellStudent(db: Db, t: Ticket, title: string, body: string, key: string, sentBy: string) {
  return enqueue(db, [{ tenantId: t.tenantId, userId: t.userId, template: "placement", title, body, link: appLink(`/play/help?id=${t.id}`), dedupeKey: key, sentBy }]);
}

export async function staffReply(db: Db, auth: AuthContext, id: string, input: { body: string; close: boolean }, now: Date) {
  const t = await loadForStaff(db, auth, id);
  await db.insert(helpMessages).values({ ticketId: t.id, authorId: auth.userId, fromStaff: true, body: input.body, createdAt: now });
  const [u] = await db.update(helpTickets).set({ status: input.close ? "closed" : "answered", updatedAt: now }).where(eq(helpTickets.id, t.id)).returning();
  await tellStudent(db, t, `The placement cell answered: ${t.subject}`, input.body.slice(0, 160), `help:${t.id}:${now.getTime()}`, auth.userId);
  void processOutbox(db, now).catch(() => {});
  return staffTicket(db, auth, u!.id);
}

/** Apply (or decline) the correction a student asked for: it updates the record drives check. */
export async function decideCorrection(db: Db, auth: AuthContext, id: string, apply: boolean, note: string | null, now: Date) {
  const t = await loadForStaff(db, auth, id);
  if (!t.correction || t.correction.status !== "pending") throw badRequest("There's no correction waiting on this question");
  const { field, proposed, current } = t.correction;
  const label = RECORD_FIELDS[field].label;
  if (!apply && !note?.trim()) throw badRequest("Tell the student why it stays as it is");
  await db.transaction(async (tx) => {
    if (apply) {
      await tx
        .insert(academicRecords)
        .values({ userId: t.userId, tenantId: t.tenantId, [field]: proposed, updatedBy: auth.userId, updatedAt: now })
        .onConflictDoUpdate({ target: academicRecords.userId, set: { [field]: proposed, updatedBy: auth.userId, updatedAt: now } });
    }
    await tx.update(helpTickets).set({ correction: { ...t.correction!, status: apply ? "applied" : "declined" }, status: "answered", updatedAt: now }).where(eq(helpTickets.id, t.id));
    const body = apply ? `Your ${label} is now ${proposed} (it was ${fmt(current)}).` : `Your ${label} stays at ${fmt(current)}. ${note!.trim()}`;
    await tx.insert(helpMessages).values({ ticketId: t.id, authorId: auth.userId, fromStaff: true, body, createdAt: now });
    await audit(tx, { tenantId: t.tenantId, actorId: auth.userId, action: apply ? "placements.record_corrected" : "placements.record_correction_declined", target: t.userId, data: { field, from: current, to: apply ? proposed : current } });
  });
  await tellStudent(db, t, apply ? `Your ${label} has been corrected` : `Your ${label} correction`, apply ? `It's now ${proposed}.` : (note ?? "").slice(0, 160), `help-correction:${t.id}`, auth.userId);
  void processOutbox(db, now).catch(() => {});
  return staffTicket(db, auth, t.id);
}

export async function staffClose(db: Db, auth: AuthContext, id: string, now: Date) {
  const t = await loadForStaff(db, auth, id);
  await db.update(helpTickets).set({ status: "closed", updatedAt: now }).where(eq(helpTickets.id, t.id));
  return staffTicket(db, auth, t.id);
}

/** For the data export: a student's questions with every message. */
export async function ticketsForExport(db: Db, userId: string) {
  const rows = await db.select().from(helpTickets).where(eq(helpTickets.userId, userId));
  const messages = rows.length ? await db.select().from(helpMessages).where(inArray(helpMessages.ticketId, rows.map((t) => t.id))).orderBy(asc(helpMessages.createdAt)) : [];
  return rows.map((t) => ({ category: t.category, subject: t.subject, status: t.status, correction: t.correction, createdAt: t.createdAt, messages: messages.filter((m) => m.ticketId === t.id).map((m) => ({ fromStaff: m.fromStaff, body: m.body, at: m.createdAt })) }));
}
