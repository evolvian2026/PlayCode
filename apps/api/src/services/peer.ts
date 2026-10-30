import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { addDays, agreeMode, firstCommonWindow, localDate, PEER_NO_SHOW_LIMIT, PEER_RATINGS, PEER_SLOTS, PEER_TRACKS, peerQuestions, zonedTime, type PeerMode, type PeerRating, type PeerTrack, type PeerWindow } from "@playcode/core";
import type { Db } from "../db/client";
import { peerFeedback, peerRequests, peerSessions, users } from "../db/schema";
import { badRequest, conflict, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";
import { getTenant } from "./tenant";

// Peer mock interviews. A student says when they're free in the next week and
// whether they want technical or HR practice; PlayCode pairs them with another
// student whose times overlap and gives both a time, a place (a video-call
// link, or a spot on campus) and the questions to ask, each with what a good
// answer covers. Afterwards each rates the other. Missing sessions pauses
// requests for a while, so a partner isn't left waiting twice.

type Ctx = { tenantId: string; userId: string; now: Date };
type Request = typeof peerRequests.$inferSelect;
type Session = typeof peerSessions.$inferSelect;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A session is matched only if it starts at least this far ahead. */
const LEAD = HOUR;
/** Received feedback shows once the student has given theirs, or after this long. */
const REVEAL_AFTER = 2 * DAY;

/** Another match got to one of the two requests first. */
class Taken extends Error {}

const startOf = (w: PeerWindow, tz: string) => zonedTime(w.date, PEER_SLOTS[w.slot].start, tz);

async function noShows(db: Db, userId: string, now: Date) {
  const rows = await db
    .select({ at: peerFeedback.createdAt })
    .from(peerFeedback)
    .where(and(eq(peerFeedback.toId, userId), eq(peerFeedback.partnerAbsent, true), gte(peerFeedback.createdAt, new Date(now.getTime() - 30 * DAY))))
    .orderBy(desc(peerFeedback.createdAt));
  // Paused for two weeks from the latest miss, once the limit is reached.
  return rows.length >= PEER_NO_SHOW_LIMIT ? new Date(rows[0]!.at.getTime() + 14 * DAY) : null;
}

/** Pair a waiting request with the oldest compatible one, if their times overlap. */
async function tryMatch(db: Db, req: Request, now: Date) {
  const tenant = await getTenant(db, req.tenantId);
  const tz = tenant.timeZone;
  const ahead = (w: PeerWindow) => startOf(w, tz).getTime() >= now.getTime() + LEAD;
  const mine = req.windows.filter(ahead);
  const others = await db
    .select()
    .from(peerRequests)
    .where(and(eq(peerRequests.tenantId, req.tenantId), eq(peerRequests.status, "waiting"), eq(peerRequests.track, req.track)))
    .orderBy(asc(peerRequests.createdAt));
  for (const other of others) {
    if (other.userId === req.userId) continue;
    const mode = agreeMode(req.mode, other.mode);
    if (!mode) continue;
    const window = firstCommonWindow(mine, other.windows.filter(ahead), { date: localDate(now, tz), slot: "morning" });
    if (!window) continue;
    const [a, b] = other.createdAt <= req.createdAt ? [other, req] : [req, other];
    const place = mode === "online" ? `https://meet.jit.si/PlayCode-${randomBytes(9).toString("base64url")}` : "On campus: meet at the library entrance, or agree another spot";
    const session = await db.transaction(async (tx) => {
      // Both requests must still be waiting: another match may have taken one.
      const taken = await tx
        .update(peerRequests)
        .set({ status: "matched" })
        .where(and(inArray(peerRequests.id, [a.id, b.id]), eq(peerRequests.status, "waiting")))
        .returning({ id: peerRequests.id });
      if (taken.length !== 2) throw new Taken();
      const [s] = await tx
        .insert(peerSessions)
        .values({ tenantId: req.tenantId, track: req.track, mode, place, startsAt: startOf(window, tz), aId: a.userId, bId: b.userId, seed: randomBytes(4).readUInt32BE(0) >>> 1, createdAt: now })
        .returning();
      await tx.update(peerRequests).set({ sessionId: s!.id }).where(inArray(peerRequests.id, [a.id, b.id]));
      return s!;
    }).catch((e: unknown) => {
      if (e instanceof Taken) return null;
      throw e;
    });
    if (!session) continue;
    const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [a.userId, b.userId]));
    const name = (id: string) => people.find((p) => p.id === id)?.name ?? "a classmate";
    const when = session.startsAt.toLocaleString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    await enqueue(
      db,
      [a.userId, b.userId].map((userId) => ({
        tenantId: req.tenantId,
        userId,
        template: "placement" as const,
        title: `Practice partner found: ${name(userId === a.userId ? b.userId : a.userId)}`,
        body: `${PEER_TRACKS[req.track]} mock interview, ${when}, ${mode === "online" ? "online" : "on campus"}. Your questions are ready in the app.`,
        link: appLink("/play/peer"),
        dedupeKey: `peer-match:${session.id}:${userId}`,
      })),
    );
    void processOutbox(db, now).catch(() => {});
    return session;
  }
  return null;
}

export interface PeerRequestInput {
  track: PeerTrack;
  mode: PeerMode;
  windows: PeerWindow[];
}

export async function requestPartner(db: Db, ctx: Ctx, input: PeerRequestInput) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = localDate(ctx.now, tenant.timeZone);
  const last = addDays(today, 7);
  const windows = [...new Map(input.windows.map((w) => [`${w.date}-${w.slot}`, w])).values()];
  if (windows.some((w) => w.date < today || w.date > last)) throw badRequest("Pick times in the next seven days");
  const usable = windows.filter((w) => startOf(w, tenant.timeZone).getTime() >= ctx.now.getTime() + LEAD);
  if (!usable.length) throw badRequest("Pick at least one time more than an hour from now");
  const paused = await noShows(db, ctx.userId, ctx.now);
  if (paused && paused > ctx.now) throw badRequest(`You missed ${PEER_NO_SHOW_LIMIT} practice sessions recently. You can ask again from ${paused.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: tenant.timeZone })}.`);
  const [waiting] = await db.select({ id: peerRequests.id }).from(peerRequests).where(and(eq(peerRequests.userId, ctx.userId), eq(peerRequests.status, "waiting")));
  if (waiting) throw conflict("waiting", "You're already waiting for a partner");
  const [upcoming] = await db
    .select({ id: peerSessions.id })
    .from(peerSessions)
    .where(and(eq(peerSessions.status, "scheduled"), gte(peerSessions.startsAt, ctx.now), or(eq(peerSessions.aId, ctx.userId), eq(peerSessions.bId, ctx.userId))));
  if (upcoming) throw conflict("scheduled", "You already have a practice session coming up");
  const [req] = await db.insert(peerRequests).values({ tenantId: ctx.tenantId, userId: ctx.userId, track: input.track, mode: input.mode, windows: usable, createdAt: ctx.now }).returning();
  await tryMatch(db, req!, ctx.now);
  return myPeer(db, ctx);
}

export async function cancelRequest(db: Db, ctx: Ctx) {
  const [w] = await db.select().from(peerRequests).where(and(eq(peerRequests.userId, ctx.userId), eq(peerRequests.status, "waiting")));
  if (!w) throw notFound("Request");
  await db.update(peerRequests).set({ status: "cancelled" }).where(eq(peerRequests.id, w.id));
  return myPeer(db, ctx);
}

async function loadMine(db: Db, ctx: Ctx, id: string) {
  const [s] = await db.select().from(peerSessions).where(and(eq(peerSessions.id, id), eq(peerSessions.tenantId, ctx.tenantId)));
  if (!s || (s.aId !== ctx.userId && s.bId !== ctx.userId)) throw notFound("Session");
  return s;
}

/** Calling off a session before it starts; the partner is told and can ask again. */
export async function cancelSession(db: Db, ctx: Ctx, id: string) {
  const s = await loadMine(db, ctx, id);
  if (s.status !== "scheduled" || s.startsAt <= ctx.now) throw badRequest("This session can't be called off now");
  await db.update(peerSessions).set({ status: "cancelled", cancelledBy: ctx.userId }).where(eq(peerSessions.id, s.id));
  const partner = s.aId === ctx.userId ? s.bId : s.aId;
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  await enqueue(db, [{ tenantId: s.tenantId, userId: partner, template: "placement", title: `${me?.name ?? "Your partner"} called off your practice session`, body: "Ask for a new partner whenever you're ready.", link: appLink("/play/peer"), dedupeKey: `peer-cancel:${s.id}` }]);
  void processOutbox(db, ctx.now).catch(() => {});
  return myPeer(db, ctx);
}

export interface PeerFeedbackInput {
  partnerAbsent: boolean;
  ratings: Record<PeerRating, number> | null;
  comment: string;
}

export async function giveFeedback(db: Db, ctx: Ctx, id: string, input: PeerFeedbackInput) {
  const s = await loadMine(db, ctx, id);
  if (s.status !== "scheduled" || s.startsAt > ctx.now) throw badRequest("Give feedback after the session");
  if (!input.partnerAbsent && !input.ratings) throw badRequest("Rate your partner, or say they didn't come");
  const partner = s.aId === ctx.userId ? s.bId : s.aId;
  const inserted = await db
    .insert(peerFeedback)
    .values({ sessionId: s.id, fromId: ctx.userId, toId: partner, partnerAbsent: input.partnerAbsent, ratings: input.partnerAbsent ? null : input.ratings, comment: input.comment.trim(), createdAt: ctx.now })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) throw conflict("given", "You've already given feedback on this session");
  return myPeer(db, ctx);
}

/** Where a student stands: a waiting request, upcoming sessions with their questions, past ones with feedback. */
export async function myPeer(db: Db, ctx: Ctx) {
  const tenant = await getTenant(db, ctx.tenantId);
  const [request] = await db.select().from(peerRequests).where(and(eq(peerRequests.userId, ctx.userId), eq(peerRequests.status, "waiting")));
  const sessions = await db
    .select()
    .from(peerSessions)
    .where(and(eq(peerSessions.tenantId, ctx.tenantId), or(eq(peerSessions.aId, ctx.userId), eq(peerSessions.bId, ctx.userId))))
    .orderBy(desc(peerSessions.startsAt))
    .limit(20);
  const ids = sessions.map((s) => s.id);
  const partnerIds = sessions.map((s) => (s.aId === ctx.userId ? s.bId : s.aId));
  const [feedback, people, paused] = await Promise.all([
    ids.length ? db.select().from(peerFeedback).where(inArray(peerFeedback.sessionId, ids)) : [],
    partnerIds.length ? db.select({ id: users.id, name: users.name, rollNo: users.rollNo }).from(users).where(inArray(users.id, partnerIds)) : [],
    noShows(db, ctx.userId, ctx.now),
  ]);
  const view = (s: Session) => {
    const partnerId = s.aId === ctx.userId ? s.bId : s.aId;
    const given = feedback.find((f) => f.sessionId === s.id && f.fromId === ctx.userId);
    const received = feedback.find((f) => f.sessionId === s.id && f.toId === ctx.userId);
    const [first, second] = peerQuestions(s.track, s.seed);
    const askFirst = s.aId === ctx.userId;
    return {
      id: s.id,
      track: s.track,
      trackLabel: PEER_TRACKS[s.track],
      mode: s.mode,
      place: s.place,
      startsAt: s.startsAt,
      status: s.status,
      partner: people.find((p) => p.id === partnerId) ?? null,
      askFirst,
      /** The questions this student asks their partner. */
      questions: askFirst ? first : second,
      given: given ? { partnerAbsent: given.partnerAbsent } : null,
      received: received && (given || ctx.now.getTime() - s.startsAt.getTime() > REVEAL_AFTER) ? { partnerAbsent: received.partnerAbsent, ratings: received.ratings, comment: received.comment } : received ? "hidden" : null,
    };
  };
  const all = sessions.map(view);
  const ratings = feedback.filter((f) => f.toId === ctx.userId && f.ratings).map((f) => f.ratings!);
  const average = (k: PeerRating) => (ratings.length ? Math.round((ratings.reduce((n, r) => n + r[k], 0) / ratings.length) * 10) / 10 : null);
  return {
    request: request ? { id: request.id, track: request.track, mode: request.mode, windows: request.windows, createdAt: request.createdAt } : null,
    upcoming: all.filter((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() > ctx.now.getTime() - HOUR).reverse(),
    past: all.filter((s) => s.status === "scheduled" && new Date(s.startsAt).getTime() <= ctx.now.getTime() - HOUR),
    averages: Object.fromEntries((Object.keys(PEER_RATINGS) as PeerRating[]).map((k) => [k, average(k)])) as Record<PeerRating, number | null>,
    pausedUntil: paused && paused > ctx.now ? paused : null,
    timeZone: tenant.timeZone,
    today: localDate(ctx.now, tenant.timeZone),
  };
}

/**
 * Hourly: match requests still waiting (someone may have asked since),
 * expire those whose times have all passed, and remind both partners an
 * hour before a session.
 */
export async function peerJob(db: Db, now: Date) {
  let matched = 0;
  let expired = 0;
  const waiting = await db.select().from(peerRequests).where(eq(peerRequests.status, "waiting")).orderBy(asc(peerRequests.createdAt));
  for (const r of waiting) {
    const [fresh] = await db.select().from(peerRequests).where(eq(peerRequests.id, r.id));
    if (fresh?.status !== "waiting") continue;
    if (await tryMatch(db, fresh, now)) {
      matched++;
      continue;
    }
    const tz = (await getTenant(db, r.tenantId)).timeZone;
    if (r.windows.every((w) => startOf(w, tz).getTime() < now.getTime() + LEAD)) {
      await db.update(peerRequests).set({ status: "expired" }).where(eq(peerRequests.id, r.id));
      await enqueue(db, [{ tenantId: r.tenantId, userId: r.userId, template: "placement", title: "No practice partner this time", body: "Nobody else was free at those times. Try again with a few more slots.", link: appLink("/play/peer"), dedupeKey: `peer-expired:${r.id}` }]);
      expired++;
    }
  }
  const soon = await db
    .select()
    .from(peerSessions)
    .where(and(eq(peerSessions.status, "scheduled"), isNull(peerSessions.remindedAt), gte(peerSessions.startsAt, now), lt(peerSessions.startsAt, new Date(now.getTime() + HOUR))));
  for (const s of soon) {
    await enqueue(
      db,
      [s.aId, s.bId].map((userId) => ({ tenantId: s.tenantId, userId, template: "placement" as const, title: `Practice interview in under an hour`, body: s.mode === "online" ? "Join from the app when it's time." : s.place, link: appLink("/play/peer"), dedupeKey: `peer-remind:${s.id}:${userId}` })),
    );
    await db.update(peerSessions).set({ remindedAt: now }).where(eq(peerSessions.id, s.id));
  }
  return { matched, expired, reminded: soon.length };
}

/** For staff: practice sessions held among students in scope since a date. */
export async function peerStats(db: Db, auth: AuthContext, since: Date, now: Date) {
  const scope = new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
  const sessions = (
    await db
      .select()
      .from(peerSessions)
      .where(and(eq(peerSessions.tenantId, auth.tenantId!), eq(peerSessions.status, "scheduled"), gte(peerSessions.startsAt, since), lt(peerSessions.startsAt, now)))
  ).filter((s) => scope.has(s.aId) || scope.has(s.bId));
  const absent = sessions.length ? await db.select({ sessionId: peerFeedback.sessionId }).from(peerFeedback).where(and(inArray(peerFeedback.sessionId, sessions.map((s) => s.id)), eq(peerFeedback.partnerAbsent, true))) : [];
  const held = sessions.filter((s) => !absent.some((a) => a.sessionId === s.id));
  return { sessions: held.length, students: new Set(held.flatMap((s) => [s.aId, s.bId]).filter((id) => scope.has(id))).size, noShows: absent.length };
}

/** For the data export. */
export async function peerForExport(db: Db, userId: string) {
  const [requests, sessions, given, received] = await Promise.all([
    db.select({ track: peerRequests.track, mode: peerRequests.mode, windows: peerRequests.windows, status: peerRequests.status, createdAt: peerRequests.createdAt }).from(peerRequests).where(eq(peerRequests.userId, userId)),
    db.select({ track: peerSessions.track, mode: peerSessions.mode, place: peerSessions.place, startsAt: peerSessions.startsAt, status: peerSessions.status }).from(peerSessions).where(or(eq(peerSessions.aId, userId), eq(peerSessions.bId, userId))),
    db.select({ partnerAbsent: peerFeedback.partnerAbsent, ratings: peerFeedback.ratings, comment: peerFeedback.comment, at: peerFeedback.createdAt }).from(peerFeedback).where(eq(peerFeedback.fromId, userId)),
    db.select({ partnerAbsent: peerFeedback.partnerAbsent, ratings: peerFeedback.ratings, comment: peerFeedback.comment, at: peerFeedback.createdAt }).from(peerFeedback).where(eq(peerFeedback.toId, userId)),
  ]);
  return { requests, sessions, feedbackGiven: given, feedbackReceived: received };
}

