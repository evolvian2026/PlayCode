import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { attendancePct, CHECK_IN_CODE_SECONDS, CHECK_IN_GRACE_MINUTES, feedbackOpen, hasInstitutionScope, LATE_AFTER_MINUTES, meanRating, MIN_FEEDBACK_RESPONSES, TRAINING_KINDS, type FeedbackDimension, type TrainingKind } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { tenants, trainingAttendance, trainingFeedback, trainingSessions, users } from "../db/schema";
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
// most colleges apply for placement eligibility. Attendees rate each session
// afterwards; staff see the ratings only in aggregate, once enough are in that
// no one response can be picked out.

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
export async function invitedIds(db: DbOrTx, s: Session) {
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
    feedback: feedbackSummary(await db.select().from(trainingFeedback).where(eq(trainingFeedback.sessionId, s.id)), { comments: true }),
    students,
  };
}

// ---------- Feedback ----------

type FeedbackRow = typeof trainingFeedback.$inferSelect;
const DIMENSIONS: FeedbackDimension[] = ["content", "delivery", "relevance"];

/**
 * Ratings in aggregate: averages per question and overall, and comments in no
 * particular order. Below the minimum number of responses only the count is
 * shown, so a trainer can't work out who said what.
 */
export function feedbackSummary(rows: FeedbackRow[], opts: { comments: boolean }) {
  if (rows.length < MIN_FEEDBACK_RESPONSES) return { responses: rows.length, shown: false as const };
  const averages = Object.fromEntries(DIMENSIONS.map((d) => [d, meanRating(rows.map((r) => r[d]))])) as Record<FeedbackDimension, number>;
  return {
    responses: rows.length,
    shown: true as const,
    overall: meanRating(rows.flatMap((r) => DIMENSIONS.map((d) => r[d]))),
    averages,
    ...(opts.comments ? { comments: rows.map((r) => r.comment.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)) } : {}),
  };
}

/** Ratings per trainer across the sessions this member of staff can see, best first. */
export async function feedbackReport(db: Db, auth: AuthContext, now: Date) {
  const { upcoming, past } = await listSessions(db, auth, now);
  // Sessions that have started: attendees can rate from the start.
  const held = [...upcoming.filter((s) => new Date(s.startsAt) <= now).reverse(), ...past].filter((s) => s.status === "scheduled");
  const rows = held.length ? await db.select().from(trainingFeedback).where(inArray(trainingFeedback.sessionId, held.map((s) => s.id))) : [];
  const bySession = new Map<string, FeedbackRow[]>();
  for (const r of rows) (bySession.get(r.sessionId) ?? bySession.set(r.sessionId, []).get(r.sessionId)!).push(r);
  const trainers = new Map<string, { sessions: number; attended: number; rows: FeedbackRow[] }>();
  for (const s of held) {
    const t = trainers.get(s.trainer) ?? trainers.set(s.trainer, { sessions: 0, attended: 0, rows: [] }).get(s.trainer)!;
    t.sessions++;
    t.attended += s.present;
    t.rows.push(...(bySession.get(s.id) ?? []));
  }
  return {
    trainers: [...trainers]
      .map(([trainer, t]) => ({ trainer, sessions: t.sessions, attended: t.attended, ...feedbackSummary(t.rows, { comments: false }) }))
      .sort((a, b) => (b.shown ? b.overall ?? 0 : -1) - (a.shown ? a.overall ?? 0 : -1) || a.trainer.localeCompare(b.trainer)),
    sessions: held.map((s) => ({ id: s.id, title: s.title, trainer: s.trainer, startsAt: s.startsAt, present: s.present, ...feedbackSummary(bySession.get(s.id) ?? [], { comments: false }) })),
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
    // Ratings count only from people who were there.
    await db.delete(trainingFeedback).where(and(eq(trainingFeedback.sessionId, s.id), eq(trainingFeedback.userId, userId)));
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

/** Each student's attendance over sessions held so far (not cancelled, already started). */
export async function attendanceFor(db: DbOrTx, tenantId: string, studentIds: string[], now: Date) {
  const out = new Map<string, { sessions: number; attended: number; pct: number | null }>();
  if (!studentIds.length) return out;
  const held = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.tenantId, tenantId), eq(trainingSessions.status, "scheduled"), lte(trainingSessions.startsAt, now)));
  const invited = new Map<string, Set<string>>();
  for (const s of held) invited.set(s.id, new Set(await invitedIds(db, s)));
  const present = held.length
    ? await db.select({ sessionId: trainingAttendance.sessionId, userId: trainingAttendance.userId }).from(trainingAttendance).where(and(inArray(trainingAttendance.sessionId, held.map((s) => s.id)), inArray(trainingAttendance.userId, studentIds)))
    : [];
  const attended = new Set(present.map((p) => `${p.sessionId}:${p.userId}`));
  for (const id of studentIds) {
    const mine = held.filter((s) => invited.get(s.id)!.has(id));
    const came = mine.filter((s) => attended.has(`${s.id}:${id}`)).length;
    out.set(id, { sessions: mine.length, attended: came, pct: attendancePct(came, mine.length) });
  }
  return out;
}

/** Each student's attendance over sessions held so far, lowest first. */
export async function attendanceReport(db: Db, auth: AuthContext, now: Date, unitId?: string) {
  const tenantId = auth.tenantId!;
  const scope = await scopeOf(db, auth);
  if (unitId && !scope.units.has(unitId)) throw forbidden("That batch or section is outside your scope");
  const units = await tenantUnits(db, tenantId);
  const studentIds = await studentIdsInUnits(db, tenantId, unitId ? descendants(units, [unitId]) : [...scope.units]);
  const [stats, held] = await Promise.all([
    attendanceFor(db, tenantId, studentIds, now),
    db.select({ id: trainingSessions.id }).from(trainingSessions).where(and(eq(trainingSessions.tenantId, tenantId), eq(trainingSessions.status, "scheduled"), lte(trainingSessions.startsAt, now))),
  ]);
  const people = studentIds.length ? await db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, studentIds)) : [];
  const rows = people.map((p) => ({ ...p, ...stats.get(p.id)! }));
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
  const rated = sessions.length
    ? new Set((await db.select({ id: trainingFeedback.sessionId }).from(trainingFeedback).where(and(eq(trainingFeedback.userId, ctx.userId), inArray(trainingFeedback.sessionId, sessions.map((s) => s.id))))).map((r) => r.id))
    : new Set<string>();
  const view = (s: Session) => {
    const a = mine.get(s.id);
    const feedback = rated.has(s.id) ? "given" : a && s.status === "scheduled" && feedbackOpen(s, ctx.now) ? "open" : null;
    return { ...summary(s, ctx.now), attended: Boolean(a), late: a?.late ?? false, feedback };
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

export interface FeedbackInput {
  content: number;
  delivery: number;
  relevance: number;
  comment: string;
}

/** An attendee rates a session, from its start until a week after it ends; rating again replaces the earlier answers. */
export async function submitFeedback(db: Db, ctx: Ctx, sessionId: string, input: FeedbackInput) {
  const [s] = await db.select().from(trainingSessions).where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.tenantId, ctx.tenantId)));
  if (!s) throw notFound("Session");
  const [attended] = await db.select().from(trainingAttendance).where(and(eq(trainingAttendance.sessionId, s.id), eq(trainingAttendance.userId, ctx.userId)));
  if (!attended) throw forbidden("Only students who attended can rate a session");
  if (s.status !== "scheduled" || !feedbackOpen(s, ctx.now)) throw badRequest("Feedback for this session is closed");
  const values = { content: input.content, delivery: input.delivery, relevance: input.relevance, comment: input.comment.trim() };
  await db
    .insert(trainingFeedback)
    .values({ sessionId: s.id, userId: ctx.userId, tenantId: ctx.tenantId, ...values, createdAt: ctx.now })
    .onConflictDoUpdate({ target: [trainingFeedback.sessionId, trainingFeedback.userId], set: { ...values, createdAt: ctx.now } });
  return { ok: true };
}

/** Hourly: remind invited students of a session in the next day, and ask attendees of a session that just ended to rate it (once each). */
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
  // Sessions that ended in the last day: ask those who attended and haven't rated it.
  const recent = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.status, "scheduled"), gt(trainingSessions.startsAt, new Date(now.getTime() - REMIND_WITHIN_MS - 8 * 3_600_000)), lte(trainingSessions.startsAt, now)));
  for (const s of recent.filter((x) => endOf(x) <= now && now.getTime() - endOf(x).getTime() <= REMIND_WITHIN_MS)) {
    const [present, rated] = await Promise.all([
      db.select({ id: trainingAttendance.userId }).from(trainingAttendance).where(eq(trainingAttendance.sessionId, s.id)),
      db.select({ id: trainingFeedback.userId }).from(trainingFeedback).where(eq(trainingFeedback.sessionId, s.id)),
    ]);
    const done = new Set(rated.map((r) => r.id));
    sent += await tell(db, s, present.map((p) => p.id).filter((id) => !done.has(id)), (uid) => ({ title: `How was ${s.title}?`, body: "Rate it in under a minute. Trainers see the ratings only in aggregate, never who gave them.", dedupeKey: `training-feedback:${s.id}:${uid}` }));
  }
  return sent;
}

/** Sessions held for one student between two instants, and how many they attended (for the monthly email to parents). */
export async function trainingBetween(db: Db, ctx: Ctx, from: Date, to: Date) {
  const held = (await myInvitedSessions(db, ctx, from, to)).filter((s) => s.status === "scheduled" && s.startsAt <= ctx.now);
  const came = held.length ? await db.select({ id: trainingAttendance.sessionId }).from(trainingAttendance).where(and(eq(trainingAttendance.userId, ctx.userId), inArray(trainingAttendance.sessionId, held.map((s) => s.id)))) : [];
  return { held: held.length, attended: came.length, titles: held.filter((s) => came.some((c) => c.id === s.id)).map((s) => s.title) };
}
