import { and, asc, desc, eq } from "drizzle-orm";
import { entryDatesError, entryPeriod, type ResumeEntryKind } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { resumeEntries, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Projects and internships on the resume. Students write them up themselves,
// so the resume says so; an internship can also be verified by the college
// (against the offer letter, completion certificate or the company's mail),
// and then shows as verified on the resume and the public profile.

type Row = typeof resumeEntries.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };
const MAX_ENTRIES = 12;

export interface EntryInput {
  kind: ResumeEntryKind;
  title: string;
  organisation: string;
  startMonth: string;
  endMonth: string | null;
  description: string;
  link: string | null;
}

const view = (e: Row) => ({
  id: e.id,
  kind: e.kind,
  title: e.title,
  organisation: e.organisation,
  startMonth: e.startMonth,
  endMonth: e.endMonth,
  period: entryPeriod(e.startMonth, e.endMonth),
  description: e.description,
  link: e.link,
  verification: e.verification,
  verificationNote: e.verificationNote,
});

async function check(db: Db, ctx: Ctx, input: EntryInput) {
  const tenant = await getTenant(db, ctx.tenantId);
  const err = entryDatesError(input.startMonth, input.endMonth, tenantToday(tenant, ctx.now).slice(0, 7));
  if (err) throw badRequest(err);
  if (input.kind === "internship" && !input.organisation.trim()) throw badRequest("Name the company you interned with");
  if (input.link && !/^https:\/\//.test(input.link)) throw badRequest("Links must start with https://");
}

export async function myEntries(db: DbOrTx, userId: string) {
  const rows = await db.select().from(resumeEntries).where(eq(resumeEntries.userId, userId)).orderBy(desc(resumeEntries.startMonth), asc(resumeEntries.createdAt));
  return { entries: rows.map(view) };
}

export async function addEntry(db: Db, ctx: Ctx, input: EntryInput) {
  await check(db, ctx, input);
  if ((await myEntries(db, ctx.userId)).entries.length >= MAX_ENTRIES) throw badRequest(`Keep it to your best ${MAX_ENTRIES}`);
  await db.insert(resumeEntries).values({ tenantId: ctx.tenantId, userId: ctx.userId, ...input, createdAt: ctx.now, updatedAt: ctx.now });
  return myEntries(db, ctx.userId);
}

async function loadMine(db: Db, ctx: Ctx, id: string) {
  const [e] = await db.select().from(resumeEntries).where(and(eq(resumeEntries.id, id), eq(resumeEntries.userId, ctx.userId)));
  if (!e) throw notFound("Entry");
  return e;
}

/** Changing an entry clears its verification: what was checked is no longer what it says. */
export async function updateEntry(db: Db, ctx: Ctx, id: string, input: EntryInput) {
  await loadMine(db, ctx, id);
  await check(db, ctx, input);
  await db.update(resumeEntries).set({ ...input, verification: "none", verificationNote: null, verifiedBy: null, verifiedAt: null, updatedAt: ctx.now }).where(eq(resumeEntries.id, id));
  return myEntries(db, ctx.userId);
}

export async function deleteEntry(db: Db, ctx: Ctx, id: string) {
  await loadMine(db, ctx, id);
  await db.delete(resumeEntries).where(eq(resumeEntries.id, id));
  return myEntries(db, ctx.userId);
}

export async function requestVerification(db: Db, ctx: Ctx, id: string) {
  const e = await loadMine(db, ctx, id);
  if (e.kind !== "internship") throw badRequest("Only internships are verified");
  if (e.verification === "verified" || e.verification === "requested") throw conflict("requested", e.verification === "verified" ? "It's already verified" : "You've already asked");
  await db.update(resumeEntries).set({ verification: "requested", verificationNote: null, updatedAt: ctx.now }).where(eq(resumeEntries.id, id));
  return myEntries(db, ctx.userId);
}

// ---------- Staff ----------

async function inScope(db: Db, auth: AuthContext) {
  return new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
}

export async function verificationQueue(db: Db, auth: AuthContext, status: "requested" | "verified" | "rejected") {
  const scope = await inScope(db, auth);
  const rows = (
    await db
      .select({ e: resumeEntries, name: users.name, rollNo: users.rollNo })
      .from(resumeEntries)
      .innerJoin(users, eq(users.id, resumeEntries.userId))
      .where(and(eq(resumeEntries.tenantId, auth.tenantId!), eq(resumeEntries.kind, "internship"), eq(resumeEntries.verification, status)))
      .orderBy(status === "requested" ? asc(resumeEntries.updatedAt) : desc(resumeEntries.verifiedAt))
  ).filter((r) => scope.has(r.e.userId));
  return { entries: rows.slice(0, 200).map((r) => ({ ...view(r.e), student: { id: r.e.userId, name: r.name, rollNo: r.rollNo } })), total: rows.length };
}

export async function decideVerification(db: Db, auth: AuthContext, id: string, decision: { verify: boolean; note: string | null }, now: Date) {
  const [e] = await db.select().from(resumeEntries).where(and(eq(resumeEntries.id, id), eq(resumeEntries.tenantId, auth.tenantId!)));
  if (!e || e.kind !== "internship" || !(await inScope(db, auth)).has(e.userId)) throw notFound("Internship");
  if (!decision.verify && !decision.note?.trim()) throw badRequest("Tell the student what you need to see");
  await db
    .update(resumeEntries)
    .set({ verification: decision.verify ? "verified" : "rejected", verificationNote: decision.verify ? null : decision.note!.trim(), verifiedBy: auth.userId, verifiedAt: now })
    .where(eq(resumeEntries.id, e.id));
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, e.tenantId));
  await enqueue(db, [
    {
      tenantId: e.tenantId,
      userId: e.userId,
      template: "placement",
      title: decision.verify ? `Your ${e.organisation} internship is verified` : `Your ${e.organisation} internship: more needed`,
      body: decision.verify ? `It shows as verified by ${tenant!.name} on your resume.` : decision.note!.trim(),
      link: appLink("/play/resume"),
      dedupeKey: `internship:${e.id}:${e.updatedAt.getTime()}:${decision.verify ? "verified" : "rejected"}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: e.tenantId, actorId: auth.userId, action: decision.verify ? "internship.verify" : "internship.reject", target: e.id });
  return { ok: true };
}

/** For the accreditation report: students with a verified internship in a period (by when it started or ran). */
export async function internshipStats(db: DbOrTx, tenantId: string, studentIds: Set<string>, from: string, to: string) {
  const rows = (await db.select().from(resumeEntries).where(and(eq(resumeEntries.tenantId, tenantId), eq(resumeEntries.kind, "internship"), eq(resumeEntries.verification, "verified")))).filter(
    (e) => studentIds.has(e.userId) && e.startMonth <= to.slice(0, 7) && (e.endMonth ?? "9999-12") >= from.slice(0, 7),
  );
  return { internships: rows.length, students: new Set(rows.map((e) => e.userId)).size };
}
