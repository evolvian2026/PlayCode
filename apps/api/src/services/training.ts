import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { attendancePct, CHECK_IN_CODE_SECONDS, CHECK_IN_GRACE_MINUTES, hasInstitutionScope, LATE_AFTER_MINUTES, TRAINING_KINDS, type TrainingKind } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { tenants, trainingAttendance, trainingSessions, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { appLink, enqueue, processOutbox, type NewNotification } from "./notifications";
import { assertUnitsInScope, descendants, scopedUnitIds, studentIdsInUnits, studentUnitIdsWithAncestors, tenantUnits, type AuthContext } from "./scope";
import { getTenant } from "./tenant";

// Placement training sessions and attendance. Staff schedule a session for
// batches or sections (or the whole institution); invited students are told,
// and reminded the day before. In the room, staff open check-in and put the
// code on the projector: it changes every 30 seconds, so a code forwarded to
// a friend outside is stale by the time it's typed. Staff can also mark
// students present by hand. Attendance below 75% is flagged, the threshold
// most colleges apply for placement eligibility.

const MIN = 60_000;
const REMIND_WITHIN_MS = 24 * 3_600_000;
type Session = typeof trainingSessions.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };

const endOf = (s: Session) => new Date(s.startsAt.getTime() + s.durationMinutes * MIN);
const when = (d: Date, timeZone: string) => d.toLocaleString("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The room's code for a 30-second window: six digits from the session's secret. */
export function checkInCode(secret: string, window: number) {
  const digest = createHmac("sha256", secret).update(String(window)).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}
const windowAt = (now: Date) => Math.floor(now.getTime() / (CHECK_IN_CODE_SECONDS * 1000));

export function checkInOpen(s: Session, now: Date) {
  return s.status === "scheduled" && Boolean(s.checkInOpenedAt) && !s.checkInClosedAt && now.getTime() <= endOf(s).getTime() + CHECK_IN_GRACE_MINUTES * MIN;
}

/** Students a session is for: those in its units and the units below them, or everyone. */
async function invitedIds(db: DbOrTx, s: Session) {
  const units = await tenantUnits(db, s.tenantId);
  return studentIdsInUnits(db, s.tenantId, s.unitIds.length ? descendants(units, s.unitIds) : units.map((u) => u.id));
}

async function scopeOf(db: DbOrTx, auth: AuthContext) {
  return { all: hasInstitutionScope(auth.roles), units: new Set(await scopedUnitIds(db, auth)) };
}

/** Staff see a session they created, any session with institution scope, and sessions that reach their batches. */
async function visible(db: DbOrTx, auth: AuthContext, s: Session, scope: Awaited<ReturnType<typeof scopeOf>>) {
  if (s.tenantId !== auth.tenantId) return false;
  if (scope.all || s.createdBy === auth.userId || !s.unitIds.length) return true;
  const covered = descendants(await tenantUnits(db, s.tenantId), s.unitIds);
  return covered.some((u) => scope.units.has(u));
}

async function loadForStaff(db: Db, auth: AuthContext, id: string) {
  const [s] = await db.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.tenantId, auth.tenantId!)));
  const scope = await scopeOf(db, auth);
  if (!s || !(await visible(db, auth, s, scope))) throw notFound("Session");
  return { s, scope };
}

/** Of a session's invited students, those this staff member looks after. */
async function myInvited(db: DbOrTx, auth: AuthContext, s: Session, scope: Awaited<ReturnType<typeof scopeOf>>) {
  const invited = await invitedIds(db, s);
  if (scope.all || s.createdBy === auth.userId) return invited;
  const mine = new Set(await studentIdsInUnits(db, s.tenantId, [...scope.units]));
  return invited.filter((id) => mine.has(id));
}

function summary(s: Session, now: Date) {
  return {
    id: s.id,
    title: s.title,
    kind: s.kind,
    kindLabel: TRAINING_KINDS[s.kind],
    trainer: s.trainer,
    location: s.location,
    startsAt: s.startsAt,
    durationMinutes: s.durationMinutes,
    unitIds: s.unitIds,
    status: s.status,
    checkInOpen: checkInOpen(s, now),
  };
}

// ---------- Staff ----------

export interface SessionInput {
  title: string;
  kind: TrainingKind;
  trainer: string;
  location: string;
  startsAt: Date;
  durationMinutes: number;
  unitIds: string[];
}

export async function createSession(db: Db, auth: AuthContext, input: SessionInput, now: Date) {
  if (input.startsAt <= now) throw badRequest("Sessions must start in the future");
  if (input.unitIds.length) await assertUnitsInScope(db, auth, input.unitIds);
  else if (!hasInstitutionScope(auth.roles)) throw badRequest("Choose the batches or sections it is for");
  const [s] = await db
    .insert(trainingSessions)
    .values({ tenantId: auth.tenantId!, createdBy: auth.userId, ...input, codeSecret: randomBytes(16).toString("hex"), createdAt: now })
    .returning();
  const tenant = await getTenant(db, s!.tenantId);
  await tell(db, s!, await invitedIds(db, s!), (uid) => ({
    title: `Training: ${s!.title}`,
    body: `${when(s!.startsAt, tenant.timeZone)} · ${s!.location} · with ${s!.trainer}. Attendance is taken in the room.`,
    dedupeKey: `training-new:${s!.id}:${uid}`,
  }));
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: s!.tenantId, actorId: auth.userId, action: "training.create", target: s!.id, data: { units: input.unitIds.length } });
  return summary(s!, now);
}

async function tell(db: DbOrTx, s: Session, userIds: string[], content: (uid: string) => Pick<NewNotification, "title" | "body" | "dedupeKey">) {
  return enqueue(db, userIds.map((userId) => ({ tenantId: s.tenantId, userId, template: "training" as const, link: appLink("/play/training"), ...content(userId) })));
}

export async function listSessions(db: Db, auth: AuthContext, now: Date) {
  const scope = await scopeOf(db, auth);
  const rows = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.tenantId, auth.tenantId!), gte(trainingSessions.startsAt, new Date(now.getTime() - 120 * 86_400_000))))
    .orderBy(asc(trainingSessions.startsAt));
  const mine: Session[] = [];
  for (const s of rows) if (await visible(db, auth, s, scope)) mine.push(s);
  const present = mine.length ? await db.select({ sessionId: trainingAttendance.sessionId }).from(trainingAttendance).where(inArray(trainingAttendance.sessionId, mine.map((s) => s.id))) : [];
  const counts = new Map<string, number>();
  for (const p of present) counts.set(p.sessionId, (counts.get(p.sessionId) ?? 0) + 1);
  const out = mine.map((s) => ({ ...summary(s, now), present: counts.get(s.id) ?? 0 }));
  return { upcoming: out.filter((s) => endOf(mine.find((m) => m.id === s.id)!) > now), past: out.filter((s) => endOf(mine.find((m) => m.id === s.id)!) <= now).reverse() };
}

export async function sessionDetail(db: Db, auth: AuthContext, id: string, now: Date) {
  const { s, scope } = await loadForStaff(db, auth, id);
  const ids = await myInvited(db, auth, s, scope);
  const people = ids.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, ids)) : [];
  const marks = new Map((await db.select().from(trainingAttendance).where(eq(trainingAttendance.sessionId, s.id))).map((a) => [a.userId, a]));
  const started = s.startsAt <= now;
  const students = people
    .sort((a, b) => (a.rollNo ?? a.name).localeCompare(b.rollNo ?? b.name, "en", { numeric: true }))
    .map((p) => {
      const a = marks.get(p.id);
      return { ...p, status: a ? (a.late ? "late" : "present") : started ? "absent" : "expected", method: a?.method ?? null, markedAt: a?.markedAt ?? null };
    });
  return {
    ...summary(s, now),
    invited: students.length,
    present: students.filter((x) => x.status === "present" || x.status === "late").length,
    late: students.filter((x) => x.status === "late").length,
    canOpenCheckIn: s.status === "scheduled" && now.getTime() >= s.startsAt.getTime() - CHECK_IN_GRACE_MINUTES * MIN && now.getTime() <= endOf(s).getTime() + CHECK_IN_GRACE_MINUTES * MIN,
    students,
  };
}

export async function setCheckIn(db: Db, auth: AuthContext, id: string, open: boolean, now: Date) {
  const { s } = await loadForStaff(db, auth, id);
  if (s.status !== "scheduled") throw conflict("session_cancelled", "This session was cancelled");
  if (open) {
    if (now.getTime() < s.startsAt.getTime() - CHECK_IN_GRACE_MINUTES * MIN) throw conflict("too_early", `Check-in opens ${CHECK_IN_GRACE_MINUTES} minutes before the start`);
    if (now.getTime() > endOf(s).getTime() + CHECK_IN_GRACE_MINUTES * MIN) throw conflict("too_late", "This session is over; mark attendance by hand instead");
    await db.update(trainingSessions).set({ checkInOpenedAt: now, checkInClosedAt: null }).where(eq(trainingSessions.id, s.id));
  } else {
    await db.update(trainingSessions).set({ checkInClosedAt: now }).where(eq(trainingSessions.id, s.id));
  }
  return sessionDetail(db, auth, id, now);
}

/** The code to show in the room, and how long until it changes. */
export async function currentCode(db: Db, auth: AuthContext, id: string, now: Date) {
  const { s } = await loadForStaff(db, auth, id);
  if (!checkInOpen(s, now)) throw conflict("check_in_closed", "Check-in isn't open");
  const window = windowAt(now);
  return { code: checkInCode(s.codeSecret, window), changesInMs: (window + 1) * CHECK_IN_CODE_SECONDS * 1000 - now.getTime() };
}

export async function markAttendance(db: Db, auth: AuthContext, id: string, userId: string, present: boolean, now: Date) {
  const { s, scope } = await loadForStaff(db, auth, id);
  if (s.status !== "scheduled") throw conflict("session_cancelled", "This session was cancelled");
  if (!(await myInvited(db, auth, s, scope)).includes(userId)) throw forbidden("This student wasn't invited, or isn't in your batches");
  if (present) {
    await db
      .insert(trainingAttendance)
      .values({ sessionId: s.id, userId, method: "staff", late: false, markedBy: auth.userId, markedAt: now })
      .onConflictDoNothing();
  } else {
    await db.delete(trainingAttendance).where(and(eq(trainingAttendance.sessionId, s.id), eq(trainingAttendance.userId, userId)));
  }
  return { ok: true };
}

export async function cancelSession(db: Db, auth: AuthContext, id: string, now: Date) {
  const { s } = await loadForStaff(db, auth, id);
  if (s.status === "cancelled") return summary(s, now);
  if (endOf(s) <= now) throw conflict("session_over", "This session has already happened");
  const [updated] = await db.update(trainingSessions).set({ status: "cancelled" }).where(eq(trainingSessions.id, s.id)).returning();
  const tenant = await getTenant(db, s.tenantId);
  await tell(db, s, await invitedIds(db, s), (uid) => ({ title: `Cancelled: ${s.title}`, body: `The training session on ${when(s.startsAt, tenant.timeZone)} won't take place.`, dedupeKey: `training-cancel:${s.id}:${uid}` }));
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: s.tenantId, actorId: auth.userId, action: "training.cancel", target: s.id });
  return summary(updated!, now);
}

/** Each student's attendance over sessions held so far, lowest first. */
export async function attendanceReport(db: Db, auth: AuthContext, now: Date, unitId?: string) {
  const tenantId = auth.tenantId!;
  const scope = await scopeOf(db, auth);
  if (unitId && !scope.units.has(unitId)) throw forbidden("That batch or section is outside your scope");
  const units = await tenantUnits(db, tenantId);
  const studentIds = await studentIdsInUnits(db, tenantId, unitId ? descendants(units, [unitId]) : [...scope.units]);
  const held = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.tenantId, tenantId), eq(trainingSessions.status, "scheduled"), lte(trainingSessions.startsAt, now)));
  const invited = new Map<string, Set<string>>();
  for (const s of held) invited.set(s.id, new Set(await invitedIds(db, s)));
  const present = held.length ? await db.select().from(trainingAttendance).where(inArray(trainingAttendance.sessionId, held.map((s) => s.id))) : [];
  const attended = new Set(present.map((p) => `${p.sessionId}:${p.userId}`));
  const people = studentIds.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, studentIds)) : [];
  const rows = people.map((p) => {
    const mine = held.filter((s) => invited.get(s.id)!.has(p.id));
    const came = mine.filter((s) => attended.has(`${s.id}:${p.id}`)).length;
    return { ...p, sessions: mine.length, attended: came, pct: attendancePct(came, mine.length) };
  });
  return { sessionsHeld: held.length, students: rows.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name)) };
}

// ---------- Students ----------

async function myInvitedSessions(db: Db, ctx: Ctx, from: Date, to: Date) {
  const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  const rows = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.tenantId, ctx.tenantId), gte(trainingSessions.startsAt, from), lte(trainingSessions.startsAt, to)))
    .orderBy(asc(trainingSessions.startsAt));
  return rows.filter((s) => !s.unitIds.length || s.unitIds.some((u) => myUnits.has(u)));
}

export async function myTraining(db: Db, ctx: Ctx) {
  const sessions = await myInvitedSessions(db, ctx, new Date(ctx.now.getTime() - 120 * 86_400_000), new Date(ctx.now.getTime() + 60 * 86_400_000));
  const mine = sessions.length
    ? new Map((await db.select().from(trainingAttendance).where(and(eq(trainingAttendance.userId, ctx.userId), inArray(trainingAttendance.sessionId, sessions.map((s) => s.id))))).map((a) => [a.sessionId, a]))
    : new Map();
  const view = (s: Session) => {
    const a = mine.get(s.id);
    return { ...summary(s, ctx.now), attended: Boolean(a), late: a?.late ?? false };
  };
  const held = sessions.filter((s) => s.status === "scheduled" && s.startsAt <= ctx.now);
  return {
    attendancePct: attendancePct(held.filter((s) => mine.has(s.id)).length, held.length),
    held: held.length,
    attended: held.filter((s) => mine.has(s.id)).length,
    // Taking attendance now and not checked in yet; once checked in, the session shows under upcoming until it ends.
    openNow: sessions.filter((s) => checkInOpen(s, ctx.now) && !mine.has(s.id)).map(view),
    upcoming: sessions.filter((s) => endOf(s) > ctx.now && !(checkInOpen(s, ctx.now) && !mine.has(s.id))).map(view),
    past: sessions.filter((s) => endOf(s) <= ctx.now).reverse().map(view),
  };
}

/** A student types the code from the screen. It matches the session taking attendance that they're invited to. */
export async function checkIn(db: Db, ctx: Ctx, code: string) {
  await rateLimit(`training-checkin:${ctx.userId}`, 10, 10 * MIN, ctx.now, "Too many tries. Ask the trainer to mark you present.");
  const open = (await myInvitedSessions(db, ctx, new Date(ctx.now.getTime() - 24 * 3_600_000), new Date(ctx.now.getTime() + CHECK_IN_GRACE_MINUTES * MIN))).filter((s) => checkInOpen(s, ctx.now));
  if (!open.length) throw badRequest("No session of yours is taking attendance right now");
  const window = windowAt(ctx.now);
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const s = open.find((x) => [window, window - 1].some((w) => same(checkInCode(x.codeSecret, w), code)));
  if (!s) throw badRequest(`That code doesn't match. Type the one on the screen now: it changes every ${CHECK_IN_CODE_SECONDS} seconds.`);
  const late = ctx.now.getTime() > s.startsAt.getTime() + LATE_AFTER_MINUTES * MIN;
  await db.insert(trainingAttendance).values({ sessionId: s.id, userId: ctx.userId, method: "code", late, markedAt: ctx.now }).onConflictDoNothing();
  return { session: { id: s.id, title: s.title }, late };
}

/** Hourly: remind invited students of a session in the next day (once each). */
export async function trainingReminders(db: Db, now: Date) {
  const soon = await db
    .select({ s: trainingSessions, timeZone: tenants.timeZone })
    .from(trainingSessions)
    .innerJoin(tenants, eq(tenants.id, trainingSessions.tenantId))
    .where(and(eq(trainingSessions.status, "scheduled"), gt(trainingSessions.startsAt, now), lte(trainingSessions.startsAt, new Date(now.getTime() + REMIND_WITHIN_MS))));
  let sent = 0;
  for (const { s, timeZone } of soon) {
    sent += await tell(db, s, await invitedIds(db, s), (uid) => ({ title: `Tomorrow: ${s.title}`, body: `${when(s.startsAt, timeZone)} · ${s.location}. Check in with the code shown in the room.`, dedupeKey: `training-remind:${s.id}:${uid}` }));
  }
  return sent;
}
