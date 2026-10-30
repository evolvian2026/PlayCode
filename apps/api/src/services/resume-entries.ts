import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { certificationPeriod, entryDatesError, entryPeriod, VERIFIABLE_KINDS, type ResumeEntryKind } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { resumeEntries, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Projects, internships and certifications on the resume. Students write them
// up themselves, so the resume says so; an internship can also be verified by
// the college (against the offer letter, completion certificate or the
// company's mail), and a certification against its credential (an NPTEL,
// AWS or Coursera link, or the certificate itself), and then shows as
// verified on the resume and the public profile.

type Row = typeof resumeEntries.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };
const MAX_ENTRIES = 12;
const MAX_CERTIFICATIONS = 10;
const isCert = (k: ResumeEntryKind) => k === "certification";

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
  period: e.kind === "certification" ? certificationPeriod(e.startMonth, e.endMonth) : entryPeriod(e.startMonth, e.endMonth),
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
  if (input.kind === "certification" && !input.organisation.trim()) throw badRequest("Say who issued it, like NPTEL or AWS");
  if (input.link && !/^https:\/\//.test(input.link)) throw badRequest("Links must start with https://");
}

export async function myEntries(db: DbOrTx, userId: string) {
  const rows = await db.select().from(resumeEntries).where(eq(resumeEntries.userId, userId)).orderBy(desc(resumeEntries.startMonth), asc(resumeEntries.createdAt));
  return { entries: rows.map(view) };
}

export async function addEntry(db: Db, ctx: Ctx, input: EntryInput) {
  await check(db, ctx, input);
  const mine = (await myEntries(db, ctx.userId)).entries.filter((e) => isCert(e.kind) === isCert(input.kind));
  const max = isCert(input.kind) ? MAX_CERTIFICATIONS : MAX_ENTRIES;
  if (mine.length >= max) throw badRequest(`Keep it to your best ${max}`);
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
  if (!VERIFIABLE_KINDS.includes(e.kind)) throw badRequest("Only internships and certifications are verified");
  if (e.kind === "certification" && !e.link) throw badRequest("Add the credential link first, so the college can check it");
  if (e.verification === "verified" || e.verification === "requested") throw conflict("requested", e.verification === "verified" ? "It's already verified" : "You've already asked");
  await db.update(resumeEntries).set({ verification: "requested", verificationNote: null, updatedAt: ctx.now }).where(eq(resumeEntries.id, id));
  return myEntries(db, ctx.userId);
}

// ---------- Staff ----------

async function inScope(db: Db, auth: AuthContext) {
  return new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
}

export async function verificationQueue(db: Db, auth: AuthContext, status: "requested" | "verified" | "rejected", kind?: "internship" | "certification") {
  const scope = await inScope(db, auth);
  const rows = (
    await db
      .select({ e: resumeEntries, name: users.name, rollNo: users.rollNo })
      .from(resumeEntries)
      .innerJoin(users, eq(users.id, resumeEntries.userId))
      .where(and(eq(resumeEntries.tenantId, auth.tenantId!), kind ? eq(resumeEntries.kind, kind) : inArray(resumeEntries.kind, VERIFIABLE_KINDS), eq(resumeEntries.verification, status)))
      .orderBy(status === "requested" ? asc(resumeEntries.updatedAt) : desc(resumeEntries.verifiedAt))
  ).filter((r) => scope.has(r.e.userId));
  return { entries: rows.slice(0, 200).map((r) => ({ ...view(r.e), student: { id: r.e.userId, name: r.name, rollNo: r.rollNo } })), total: rows.length };
}

export async function decideVerification(db: Db, auth: AuthContext, id: string, decision: { verify: boolean; note: string | null }, now: Date) {
  const [e] = await db.select().from(resumeEntries).where(and(eq(resumeEntries.id, id), eq(resumeEntries.tenantId, auth.tenantId!)));
  if (!e || !VERIFIABLE_KINDS.includes(e.kind) || !(await inScope(db, auth)).has(e.userId)) throw notFound("Entry");
  const what = e.kind === "certification" ? `${e.title} certification` : `${e.organisation} internship`;
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
      title: decision.verify ? `Your ${what} is verified` : `Your ${what}: more needed`,
      body: decision.verify ? `It shows as verified by ${tenant!.name} on your resume.` : decision.note!.trim(),
      link: appLink("/play/resume"),
      dedupeKey: `${e.kind}:${e.id}:${e.updatedAt.getTime()}:${decision.verify ? "verified" : "rejected"}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: e.tenantId, actorId: auth.userId, action: `${e.kind}.${decision.verify ? "verify" : "reject"}`, target: e.id });
  return { ok: true };
}

/** For the accreditation report: students with a verified internship in a period (by when it started or ran). */
export async function internshipStats(db: DbOrTx, tenantId: string, studentIds: Set<string>, from: string, to: string) {
  const rows = (await db.select().from(resumeEntries).where(and(eq(resumeEntries.tenantId, tenantId), eq(resumeEntries.kind, "internship"), eq(resumeEntries.verification, "verified")))).filter(
    (e) => studentIds.has(e.userId) && e.startMonth <= to.slice(0, 7) && (e.endMonth ?? "9999-12") >= from.slice(0, 7),
  );
  return { internships: rows.length, students: new Set(rows.map((e) => e.userId)).size };
}

/** Verified certifications in scope, by issuer: what the batch has earned beyond the syllabus. */
export async function certificationSummary(db: Db, auth: AuthContext) {
  const scope = await inScope(db, auth);
  const rows = (await db.select({ userId: resumeEntries.userId, issuer: resumeEntries.organisation }).from(resumeEntries).where(and(eq(resumeEntries.tenantId, auth.tenantId!), eq(resumeEntries.kind, "certification"), eq(resumeEntries.verification, "verified")))).filter((r) =>
    scope.has(r.userId),
  );
  const byIssuer = new Map<string, { issuer: string; certifications: number; students: Set<string> }>();
  for (const r of rows) {
    const key = r.issuer.trim().toLowerCase();
    const g = byIssuer.get(key) ?? byIssuer.set(key, { issuer: r.issuer.trim(), certifications: 0, students: new Set() }).get(key)!;
    g.certifications++;
    g.students.add(r.userId);
  }
  return {
    certifications: rows.length,
    students: new Set(rows.map((r) => r.userId)).size,
    byIssuer: [...byIssuer.values()].map((g) => ({ issuer: g.issuer, certifications: g.certifications, students: g.students.size })).sort((a, b) => b.students - a.students || a.issuer.localeCompare(b.issuer)),
  };
}

/** For the accreditation report: verified certifications earned in a period. */
export async function certificationStats(db: DbOrTx, tenantId: string, studentIds: Set<string>, from: string, to: string) {
  const rows = (await db.select().from(resumeEntries).where(and(eq(resumeEntries.tenantId, tenantId), eq(resumeEntries.kind, "certification"), eq(resumeEntries.verification, "verified")))).filter(
    (e) => studentIds.has(e.userId) && e.startMonth >= from.slice(0, 7) && e.startMonth <= to.slice(0, 7),
  );
  return { certifications: rows.length, students: new Set(rows.map((e) => e.userId)).size };
}
