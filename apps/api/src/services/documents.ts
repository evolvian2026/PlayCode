import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { hasInstitutionScope, localDate, MAX_DOCUMENT_BYTES, safeFileName, sniffDocumentType } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { documentRequests, documentSubmissions, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { deleteObject, getObject, putObject } from "../lib/storage";
import { audienceOf, reachesStudent, visible } from "./circulars";
import { appLink, enqueue, processOutbox } from "./notifications";
import { assertUnitsInScope, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Document collection: before a drive season the placement cell asks each
// batch for marksheets, ID proof or a signed resume. Students upload a PDF or
// photo from their phone (5 MB at most; the file's real type is checked, not
// its name), staff open each file and verify it or send it back with a note,
// and those who haven't uploaded are reminded the day before it's due.

type Row = typeof documentRequests.$inferSelect;
type Submission = typeof documentSubmissions.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };
const REMIND_EVERY_MS = 12 * 3_600_000;

export interface RequestInput {
  title: string;
  instructions: string;
  unitIds: string[];
  dueOn: string;
}

const summary = (r: Row) => ({ id: r.id, title: r.title, instructions: r.instructions, unitIds: r.unitIds, dueOn: r.dueOn, createdAt: r.createdAt, closed: Boolean(r.closedAt) });
const fileView = (s: Submission) => ({ fileName: s.fileName, contentType: s.contentType, sizeBytes: s.sizeBytes, status: s.status, reviewNote: s.reviewNote, submittedAt: s.submittedAt });

function tell(db: DbOrTx, r: Row, userIds: string[], title: string, body: string, dedupe: (uid: string) => string) {
  return enqueue(db, userIds.map((userId) => ({ tenantId: r.tenantId, userId, template: "circular" as const, title, body, link: appLink("/play/documents"), dedupeKey: dedupe(userId) })));
}

async function loadForStaff(db: Db, auth: AuthContext, id: string) {
  const [r] = await db.select().from(documentRequests).where(and(eq(documentRequests.id, id), eq(documentRequests.tenantId, auth.tenantId!)));
  if (!r || !(await visible(db, auth, r))) throw notFound("Document request");
  return r;
}

// ---------- Staff ----------

export async function createRequest(db: Db, auth: AuthContext, input: RequestInput, now: Date) {
  const tenant = await getTenant(db, auth.tenantId!);
  if (input.dueOn < tenantToday(tenant, now)) throw badRequest("The last day can't be in the past");
  if (input.unitIds.length) await assertUnitsInScope(db, auth, input.unitIds);
  else if (!hasInstitutionScope(auth.roles)) throw badRequest("Choose the batches or sections it is for");
  const [r] = await db.insert(documentRequests).values({ tenantId: auth.tenantId!, createdBy: auth.userId, ...input, createdAt: now }).returning();
  const audience = await audienceOf(db, r!);
  await tell(db, r!, audience, `Upload: ${r!.title}`, `Upload it in the app by ${r!.dueOn}.${r!.instructions ? ` ${r!.instructions.slice(0, 120)}` : ""}`, (uid) => `document:${r!.id}:${uid}`);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: r!.tenantId, actorId: auth.userId, action: "documents.request", target: r!.id, data: { students: audience.length } });
  return { ...summary(r!), audience: audience.length };
}

export async function listRequests(db: Db, auth: AuthContext, now: Date) {
  const rows = await db
    .select()
    .from(documentRequests)
    .where(and(eq(documentRequests.tenantId, auth.tenantId!), gte(documentRequests.createdAt, new Date(now.getTime() - 365 * 86_400_000))))
    .orderBy(desc(documentRequests.createdAt));
  const mine: Row[] = [];
  for (const r of rows) if (await visible(db, auth, r)) mine.push(r);
  const subs = mine.length ? await db.select({ id: documentSubmissions.requestId, userId: documentSubmissions.userId, status: documentSubmissions.status }).from(documentSubmissions).where(inArray(documentSubmissions.requestId, mine.map((r) => r.id))) : [];
  const out = [];
  for (const r of mine) {
    const audience = new Set(await audienceOf(db, r));
    const list = subs.filter((s) => s.id === r.id && audience.has(s.userId));
    out.push({ ...summary(r), audience: audience.size, submitted: list.length, verified: list.filter((s) => s.status === "verified").length, toReview: list.filter((s) => s.status === "pending").length });
  }
  return { requests: out };
}

export async function requestDetail(db: Db, auth: AuthContext, id: string) {
  const r = await loadForStaff(db, auth, id);
  const audience = await audienceOf(db, r);
  const [people, subs] = await Promise.all([
    audience.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, audience)) : [],
    db.select().from(documentSubmissions).where(eq(documentSubmissions.requestId, r.id)),
  ]);
  const byUser = new Map(subs.map((s) => [s.userId, s]));
  // Files to review first, then those still missing, then the rest.
  const order = (s: Submission | undefined) => (!s ? 1 : s.status === "pending" ? 0 : s.status === "rejected" ? 2 : 3);
  const students = people
    .map((p) => ({ ...p, file: byUser.has(p.id) ? fileView(byUser.get(p.id)!) : null, order: order(byUser.get(p.id)) }))
    .sort((a, b) => a.order - b.order || (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }))
    .map(({ order: _order, ...rest }) => rest);
  return {
    ...summary(r),
    audience: students.length,
    submitted: students.filter((s) => s.file).length,
    verified: students.filter((s) => s.file?.status === "verified").length,
    lastRemindedAt: r.lastRemindedAt,
    students,
  };
}

/** A student's file, for staff who can see the request. */
export async function staffFile(db: Db, auth: AuthContext, id: string, userId: string) {
  const r = await loadForStaff(db, auth, id);
  if (!(await audienceOf(db, r)).includes(userId)) throw notFound("File");
  const [s] = await db.select().from(documentSubmissions).where(and(eq(documentSubmissions.requestId, r.id), eq(documentSubmissions.userId, userId)));
  const data = s ? await getObject(s.storageKey) : null;
  if (!s || !data) throw notFound("File");
  await audit(db, { tenantId: r.tenantId, actorId: auth.userId, action: "documents.view", target: r.id, data: { userId } });
  return { data, contentType: s.contentType, fileName: s.fileName };
}

export async function reviewSubmission(db: Db, auth: AuthContext, id: string, userId: string, decision: { verify: boolean; note: string | null }, now: Date) {
  const r = await loadForStaff(db, auth, id);
  const [s] = await db.select().from(documentSubmissions).where(and(eq(documentSubmissions.requestId, r.id), eq(documentSubmissions.userId, userId)));
  if (!s) throw notFound("File");
  if (!decision.verify && !decision.note?.trim()) throw badRequest("Tell the student what's wrong with it");
  await db
    .update(documentSubmissions)
    .set({ status: decision.verify ? "verified" : "rejected", reviewNote: decision.verify ? null : decision.note!.trim(), reviewedBy: auth.userId, reviewedAt: now })
    .where(and(eq(documentSubmissions.requestId, r.id), eq(documentSubmissions.userId, userId)));
  if (!decision.verify) {
    await tell(db, r, [userId], `Upload again: ${r.title}`, decision.note!.trim(), (uid) => `document-rejected:${r.id}:${uid}:${s.submittedAt.getTime()}`);
    void processOutbox(db, now).catch(() => {});
  }
  await audit(db, { tenantId: r.tenantId, actorId: auth.userId, action: decision.verify ? "documents.verify" : "documents.reject", target: r.id, data: { userId } });
  return { ok: true };
}

/** Remind students who haven't uploaded, or whose file was sent back; at most every 12 hours. */
export async function remindRequest(db: Db, auth: AuthContext, id: string, now: Date) {
  const r = await loadForStaff(db, auth, id);
  if (r.closedAt) throw badRequest("This request is closed");
  if (r.lastRemindedAt && now.getTime() - r.lastRemindedAt.getTime() < REMIND_EVERY_MS) throw conflict("reminded", "Students were reminded less than 12 hours ago");
  const pending = await outstanding(db, r);
  await tell(db, r, pending, `Reminder: upload ${r.title}`, `Please upload it in the app by ${r.dueOn}.`, (uid) => `document-remind:${r.id}:${now.getTime()}:${uid}`);
  await db.update(documentRequests).set({ lastRemindedAt: now }).where(eq(documentRequests.id, r.id));
  void processOutbox(db, now).catch(() => {});
  return { reminded: pending.length };
}

/** Students with nothing uploaded, or whose file was sent back. */
async function outstanding(db: DbOrTx, r: Row) {
  const subs = await db.select({ userId: documentSubmissions.userId, status: documentSubmissions.status }).from(documentSubmissions).where(eq(documentSubmissions.requestId, r.id));
  const ok = new Set(subs.filter((s) => s.status !== "rejected").map((s) => s.userId));
  return (await audienceOf(db, r)).filter((u) => !ok.has(u));
}

export async function closeRequest(db: Db, auth: AuthContext, id: string, now: Date) {
  const r = await loadForStaff(db, auth, id);
  if (r.createdBy !== auth.userId && !hasInstitutionScope(auth.roles)) throw forbidden("Only whoever asked for it, or the placement cell, can close it");
  await db.update(documentRequests).set({ closedAt: now }).where(eq(documentRequests.id, r.id));
  await audit(db, { tenantId: r.tenantId, actorId: auth.userId, action: "documents.close", target: r.id });
  return { ok: true };
}

// ---------- Students ----------

async function myRequestRows(db: Db, ctx: Ctx) {
  const reaches = await reachesStudent(db, ctx);
  const rows = await db
    .select()
    .from(documentRequests)
    .where(and(eq(documentRequests.tenantId, ctx.tenantId), gte(documentRequests.createdAt, new Date(ctx.now.getTime() - 365 * 86_400_000))))
    .orderBy(desc(documentRequests.createdAt));
  return rows.filter(reaches);
}

export async function myDocuments(db: Db, ctx: Ctx) {
  const rows = await myRequestRows(db, ctx);
  const subs = rows.length ? new Map((await db.select().from(documentSubmissions).where(and(eq(documentSubmissions.userId, ctx.userId), inArray(documentSubmissions.requestId, rows.map((r) => r.id))))).map((s) => [s.requestId, s])) : new Map<string, Submission>();
  // Closed requests stay visible only if the student had uploaded something.
  const list = rows
    .filter((r) => !r.closedAt || subs.has(r.id))
    .map((r) => ({ ...summary(r), file: subs.has(r.id) ? fileView(subs.get(r.id)!) : null }));
  return { requests: list, todo: list.filter((r) => !r.closed && (!r.file || r.file.status === "rejected")).length };
}

export async function upload(db: Db, ctx: Ctx, id: string, input: { fileName: string; data: string }) {
  const r = (await myRequestRows(db, ctx)).find((x) => x.id === id);
  if (!r) throw notFound("Document request");
  if (r.closedAt) throw badRequest("This request is closed");
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length === 0) throw badRequest("The file is empty");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw badRequest("The file is larger than 5 MB. Scan it at a lower resolution or upload a photo.");
  const type = sniffDocumentType(bytes);
  if (!type) throw badRequest("Upload a PDF, JPG or PNG file");
  const [old] = await db.select().from(documentSubmissions).where(and(eq(documentSubmissions.requestId, r.id), eq(documentSubmissions.userId, ctx.userId)));
  if (old?.status === "verified") throw conflict("verified", "This is already verified. Ask your placement cell if it needs replacing.");
  const key = `documents/${ctx.tenantId}/${r.id}/${ctx.userId}/${randomUUID()}`;
  await putObject(key, bytes);
  const values = { storageKey: key, fileName: safeFileName(input.fileName, type), contentType: type, sizeBytes: bytes.length, status: "pending" as const, reviewNote: null, reviewedBy: null, reviewedAt: null, submittedAt: ctx.now };
  await db
    .insert(documentSubmissions)
    .values({ requestId: r.id, userId: ctx.userId, tenantId: ctx.tenantId, ...values })
    .onConflictDoUpdate({ target: [documentSubmissions.requestId, documentSubmissions.userId], set: values });
  if (old) await deleteObject(old.storageKey).catch(() => {});
  return myDocuments(db, ctx);
}

export async function myFile(db: Db, ctx: Ctx, id: string) {
  const [s] = await db.select().from(documentSubmissions).where(and(eq(documentSubmissions.requestId, id), eq(documentSubmissions.userId, ctx.userId), eq(documentSubmissions.tenantId, ctx.tenantId)));
  const data = s ? await getObject(s.storageKey) : null;
  if (!s || !data) throw notFound("File");
  return { data, contentType: s.contentType, fileName: s.fileName };
}

/** Hourly: remind students with nothing uploaded for a request due tomorrow (once each). */
export async function documentReminders(db: Db, now: Date) {
  const rows = await db
    .select({ r: documentRequests, timeZone: tenants.timeZone })
    .from(documentRequests)
    .innerJoin(tenants, eq(tenants.id, documentRequests.tenantId))
    .where(and(isNull(documentRequests.closedAt), gte(documentRequests.dueOn, localDate(now, "UTC"))));
  let sent = 0;
  for (const { r, timeZone } of rows) {
    if (r.dueOn !== localDate(new Date(now.getTime() + 86_400_000), timeZone)) continue;
    sent += await tell(db, r, await outstanding(db, r), `Due tomorrow: ${r.title}`, "Please upload it in the app today.", (uid) => `document-due:${r.id}:${uid}`);
  }
  return sent;
}
