import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { hasInstitutionScope, localDate } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { circularAcks, circulars, tenants, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { assertUnitsInScope, descendants, scopedUnitIds, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Circulars: the notices placement cells pin on the board ("Carry two copies
// of your resume to the TCS drive", "Submit your marksheets by Friday"), sent
// to chosen batches in the app. A circular can ask students to acknowledge
// it by a date; staff see who hasn't, can remind them (twice a day at most),
// and the hourly job reminds those still pending the day before.

type Row = typeof circulars.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };
const REMIND_EVERY_MS = 12 * 3_600_000;

export interface CircularInput {
  title: string;
  body: string;
  unitIds: string[];
  requireAck: boolean;
  ackBy: string | null;
}

/** Students a circular is for: those in its units and the units below, or everyone. */
async function audienceOf(db: DbOrTx, c: Row) {
  const units = await tenantUnits(db, c.tenantId);
  return studentIdsInUnits(db, c.tenantId, c.unitIds.length ? descendants(units, c.unitIds) : units.map((u) => u.id));
}

async function visible(db: DbOrTx, auth: AuthContext, c: Row) {
  if (c.tenantId !== auth.tenantId) return false;
  if (hasInstitutionScope(auth.roles) || c.createdBy === auth.userId || !c.unitIds.length) return true;
  const mine = new Set(await scopedUnitIds(db, auth));
  return descendants(await tenantUnits(db, c.tenantId), c.unitIds).some((u) => mine.has(u));
}

async function loadForStaff(db: Db, auth: AuthContext, id: string) {
  const [c] = await db.select().from(circulars).where(and(eq(circulars.id, id), eq(circulars.tenantId, auth.tenantId!)));
  if (!c || !(await visible(db, auth, c))) throw notFound("Circular");
  return c;
}

function tell(db: DbOrTx, c: Row, userIds: string[], title: string, body: string, dedupe: (uid: string) => string) {
  return enqueue(db, userIds.map((userId) => ({ tenantId: c.tenantId, userId, template: "circular" as const, title, body, link: appLink("/play/circulars"), dedupeKey: dedupe(userId) })));
}

const summary = (c: Row) => ({ id: c.id, title: c.title, body: c.body, unitIds: c.unitIds, requireAck: c.requireAck, ackBy: c.ackBy, createdAt: c.createdAt, withdrawn: Boolean(c.withdrawnAt) });
const excerpt = (text: string) => (text.length > 140 ? `${text.slice(0, 137).trimEnd()}...` : text);

// ---------- Staff ----------

export async function createCircular(db: Db, auth: AuthContext, input: CircularInput, now: Date) {
  const tenant = await getTenant(db, auth.tenantId!);
  if (input.requireAck && input.ackBy && input.ackBy < tenantToday(tenant, now)) throw badRequest("The last day to acknowledge can't be in the past");
  if (input.unitIds.length) await assertUnitsInScope(db, auth, input.unitIds);
  else if (!hasInstitutionScope(auth.roles)) throw badRequest("Choose the batches or sections it is for");
  const [c] = await db
    .insert(circulars)
    .values({ tenantId: auth.tenantId!, createdBy: auth.userId, title: input.title, body: input.body, unitIds: input.unitIds, requireAck: input.requireAck, ackBy: input.requireAck ? input.ackBy : null, createdAt: now })
    .returning();
  const audience = await audienceOf(db, c!);
  await tell(db, c!, audience, `Circular: ${c!.title}`, c!.requireAck ? `${excerpt(c!.body)} Please acknowledge it${c!.ackBy ? ` by ${c!.ackBy}` : ""}.` : excerpt(c!.body), (uid) => `circular:${c!.id}:${uid}`);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: c!.tenantId, actorId: auth.userId, action: "circular.create", target: c!.id, data: { students: audience.length } });
  return { ...summary(c!), audience: audience.length };
}

export async function listCirculars(db: Db, auth: AuthContext, now: Date) {
  const rows = await db
    .select()
    .from(circulars)
    .where(and(eq(circulars.tenantId, auth.tenantId!), gte(circulars.createdAt, new Date(now.getTime() - 365 * 86_400_000))))
    .orderBy(desc(circulars.createdAt));
  const mine: Row[] = [];
  for (const c of rows) if (await visible(db, auth, c)) mine.push(c);
  const acks = mine.length ? await db.select({ id: circularAcks.circularId, userId: circularAcks.userId }).from(circularAcks).where(inArray(circularAcks.circularId, mine.map((c) => c.id))) : [];
  const out = [];
  for (const c of mine) {
    const audience = new Set(await audienceOf(db, c));
    out.push({ ...summary(c), audience: audience.size, acknowledged: acks.filter((a) => a.id === c.id && audience.has(a.userId)).length });
  }
  return { circulars: out };
}

export async function circularDetail(db: Db, auth: AuthContext, id: string) {
  const c = await loadForStaff(db, auth, id);
  const audience = await audienceOf(db, c);
  const [people, acks] = await Promise.all([
    audience.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, audience)) : [],
    db.select().from(circularAcks).where(eq(circularAcks.circularId, c.id)),
  ]);
  const at = new Map(acks.map((a) => [a.userId, a.at]));
  const students = people
    .map((p) => ({ ...p, acknowledgedAt: at.get(p.id) ?? null }))
    .sort((a, b) => Number(Boolean(a.acknowledgedAt)) - Number(Boolean(b.acknowledgedAt)) || (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }));
  return { ...summary(c), audience: students.length, acknowledged: students.filter((s) => s.acknowledgedAt).length, lastRemindedAt: c.lastRemindedAt, students };
}

/** Remind students who haven't acknowledged yet; at most every 12 hours. */
export async function remindCircular(db: Db, auth: AuthContext, id: string, now: Date) {
  const c = await loadForStaff(db, auth, id);
  if (!c.requireAck || c.withdrawnAt) throw badRequest("There's nothing to acknowledge");
  if (c.lastRemindedAt && now.getTime() - c.lastRemindedAt.getTime() < REMIND_EVERY_MS) throw conflict("reminded", "Students were reminded less than 12 hours ago");
  const done = new Set((await db.select({ userId: circularAcks.userId }).from(circularAcks).where(eq(circularAcks.circularId, c.id))).map((a) => a.userId));
  const pending = (await audienceOf(db, c)).filter((u) => !done.has(u));
  await tell(db, c, pending, `Reminder: ${c.title}`, `Please read and acknowledge this circular${c.ackBy ? ` by ${c.ackBy}` : ""}.`, (uid) => `circular-remind:${c.id}:${now.getTime()}:${uid}`);
  await db.update(circulars).set({ lastRemindedAt: now }).where(eq(circulars.id, c.id));
  void processOutbox(db, now).catch(() => {});
  return { reminded: pending.length };
}

export async function withdrawCircular(db: Db, auth: AuthContext, id: string, now: Date) {
  const c = await loadForStaff(db, auth, id);
  if (c.createdBy !== auth.userId && !hasInstitutionScope(auth.roles)) throw forbidden("Only whoever posted it, or the placement cell, can withdraw it");
  await db.update(circulars).set({ withdrawnAt: now }).where(eq(circulars.id, c.id));
  await audit(db, { tenantId: c.tenantId, actorId: auth.userId, action: "circular.withdraw", target: c.id });
  return { ok: true };
}

// ---------- Students ----------

async function myCircularRows(db: Db, ctx: Ctx) {
  const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  const rows = await db
    .select()
    .from(circulars)
    .where(and(eq(circulars.tenantId, ctx.tenantId), isNull(circulars.withdrawnAt), gte(circulars.createdAt, new Date(ctx.now.getTime() - 180 * 86_400_000))))
    .orderBy(desc(circulars.createdAt));
  return rows.filter((c) => !c.unitIds.length || c.unitIds.some((u) => myUnits.has(u)));
}

export async function myCirculars(db: Db, ctx: Ctx) {
  const rows = await myCircularRows(db, ctx);
  const acks = rows.length ? new Map((await db.select().from(circularAcks).where(and(eq(circularAcks.userId, ctx.userId), inArray(circularAcks.circularId, rows.map((c) => c.id))))).map((a) => [a.circularId, a.at])) : new Map<string, Date>();
  const list = rows.map((c) => ({ id: c.id, title: c.title, body: c.body, requireAck: c.requireAck, ackBy: c.ackBy, createdAt: c.createdAt, acknowledgedAt: acks.get(c.id) ?? null }));
  return { circulars: list, pending: list.filter((c) => c.requireAck && !c.acknowledgedAt).length };
}

export async function acknowledge(db: Db, ctx: Ctx, id: string) {
  const c = (await myCircularRows(db, ctx)).find((x) => x.id === id);
  if (!c) throw notFound("Circular");
  if (!c.requireAck) throw badRequest("This circular doesn't need acknowledging");
  await db.insert(circularAcks).values({ circularId: c.id, userId: ctx.userId, at: ctx.now }).onConflictDoNothing();
  return myCirculars(db, ctx);
}

/** Hourly: remind students who haven't acknowledged a circular due tomorrow (once each). */
export async function circularReminders(db: Db, now: Date) {
  const rows = await db
    .select({ c: circulars, timeZone: tenants.timeZone })
    .from(circulars)
    .innerJoin(tenants, eq(tenants.id, circulars.tenantId))
    .where(and(eq(circulars.requireAck, true), isNull(circulars.withdrawnAt), gte(circulars.ackBy, localDate(now, "UTC").slice(0, 10))));
  let sent = 0;
  for (const { c, timeZone } of rows) {
    const tomorrow = localDate(new Date(now.getTime() + 86_400_000), timeZone);
    if (c.ackBy !== tomorrow) continue;
    const done = new Set((await db.select({ userId: circularAcks.userId }).from(circularAcks).where(eq(circularAcks.circularId, c.id))).map((a) => a.userId));
    sent += await tell(db, c, (await audienceOf(db, c)).filter((u) => !done.has(u)), `Due tomorrow: ${c.title}`, "Please read and acknowledge this circular.", (uid) => `circular-due:${c.id}:${uid}`);
  }
  return sent;
}
