import { and, asc, desc, eq, gt, gte, lte, ne } from "drizzle-orm";
import { hasInstitutionScope, PANEL_KINDS, PANEL_RECOMMENDATIONS, PANEL_RUBRIC, type PanelKind, type PanelRecommendation } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { interviewSlots, tenants, users, type PanelFeedback } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox, type NewNotification } from "./notifications";
import { assertUnitsInScope, scopedUnitIds, studentUnitIdsWithAncestors, type AuthContext } from "./scope";
import { getTenant } from "./tenant";

// Mock interviews with real people: placement cells run them with faculty and
// alumni. Staff publish slots (a run of back-to-back ones in one go), students
// book one at a time, and the interviewer's rubric comes back to the student.

/** A booking can be dropped up to this long before the start. */
const CANCEL_BEFORE_MS = 2 * 3_600_000;
const REMIND_WITHIN_MS = 24 * 3_600_000;
const MAX_RUN = 12;

type Slot = typeof interviewSlots.$inferSelect;
type Ctx = { tenantId: string; userId: string; now: Date };

const label = (s: Slot) => `${PANEL_KINDS[s.kind]} mock interview with ${s.interviewerName}`;
const when = (d: Date, timeZone: string) => d.toLocaleString("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function slotView(s: Slot, student?: { name: string; rollNo: string | null } | null) {
  return {
    id: s.id,
    interviewerName: s.interviewerName,
    kind: s.kind,
    startsAt: s.startsAt,
    durationMinutes: s.durationMinutes,
    location: s.location,
    unitIds: s.unitIds,
    status: s.status,
    ...(student !== undefined ? { student } : {}),
    feedback: s.feedback,
  };
}

// ---------- Staff ----------

export async function createSlots(
  db: Db,
  auth: AuthContext,
  input: { interviewerName: string; kind: PanelKind; startsAt: Date; durationMinutes: number; count: number; location: string; unitIds: string[] },
  now: Date,
) {
  if (input.startsAt <= now) throw badRequest("Slots must start in the future");
  if (input.count < 1 || input.count > MAX_RUN) throw badRequest(`Create 1 to ${MAX_RUN} slots at a time`);
  if (input.unitIds.length) await assertUnitsInScope(db, auth, input.unitIds);
  else if (!hasInstitutionScope(auth.roles)) throw badRequest("Choose the batches or sections who may book");
  const rows = await db
    .insert(interviewSlots)
    .values(
      Array.from({ length: input.count }, (_, i) => ({
        tenantId: auth.tenantId!,
        createdBy: auth.userId,
        interviewerName: input.interviewerName,
        kind: input.kind,
        startsAt: new Date(input.startsAt.getTime() + i * input.durationMinutes * 60_000),
        durationMinutes: input.durationMinutes,
        location: input.location,
        unitIds: input.unitIds,
        createdAt: now,
      })),
    )
    .returning();
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "interview_slots.create", data: { count: rows.length, interviewer: input.interviewerName } });
  return { slots: rows.map((s) => slotView(s)) };
}

/** Slots staff may manage: their own, or (with institution scope) all; and those for units in their scope. */
async function manageable(db: DbOrTx, auth: AuthContext, s: Slot) {
  if (s.tenantId !== auth.tenantId) return false;
  if (s.createdBy === auth.userId || hasInstitutionScope(auth.roles)) return true;
  if (!s.unitIds.length) return false;
  const scope = new Set(await scopedUnitIds(db, auth));
  return s.unitIds.every((u) => scope.has(u));
}

async function loadForStaff(db: Db, auth: AuthContext, id: string) {
  const [s] = await db.select().from(interviewSlots).where(eq(interviewSlots.id, id));
  if (!s || !(await manageable(db, auth, s))) throw notFound("Slot");
  return s;
}

export async function staffSlots(db: Db, auth: AuthContext, now: Date) {
  const rows = await db
    .select({ slot: interviewSlots, name: users.name, rollNo: users.rollNo })
    .from(interviewSlots)
    .leftJoin(users, eq(users.id, interviewSlots.bookedBy))
    .where(and(eq(interviewSlots.tenantId, auth.tenantId!), gte(interviewSlots.startsAt, new Date(now.getTime() - 30 * 86_400_000))))
    .orderBy(asc(interviewSlots.startsAt))
    .limit(500);
  const out = [];
  for (const r of rows) if (await manageable(db, auth, r.slot)) out.push(slotView(r.slot, r.name ? { name: r.name, rollNo: r.rollNo } : null));
  return { slots: out, rubric: PANEL_RUBRIC, recommendations: PANEL_RECOMMENDATIONS };
}

async function notify(db: Db, items: NewNotification[], now: Date) {
  if (!(await enqueue(db, items))) return;
  void processOutbox(db, now).catch(() => {});
}

export async function cancelSlot(db: Db, auth: AuthContext, id: string, now: Date) {
  const s = await loadForStaff(db, auth, id);
  if (s.status === "done" || s.status === "no_show") throw conflict("slot_finished", "This interview has already happened");
  await db.update(interviewSlots).set({ status: "cancelled" }).where(eq(interviewSlots.id, s.id));
  if (s.bookedBy) {
    const tz = (await getTenant(db, s.tenantId)).timeZone;
    await notify(
      db,
      [{ tenantId: s.tenantId, userId: s.bookedBy, template: "interview_slot", title: "Mock interview cancelled", body: `Your ${label(s).toLowerCase()} on ${when(s.startsAt, tz)} was cancelled. Book another slot.`, link: appLink("/play/panel"), dedupeKey: `slot-cancel:${s.id}` }],
      now,
    );
  }
  await audit(db, { tenantId: s.tenantId, actorId: auth.userId, action: "interview_slot.cancel", target: s.id });
  return { ok: true };
}

export async function recordFeedback(
  db: Db,
  auth: AuthContext,
  id: string,
  input: { noShow: true } | { scores: Record<string, number>; overall: number; recommendation: PanelRecommendation; strengths: string; improvements: string },
  now: Date,
) {
  const s = await loadForStaff(db, auth, id);
  if (!s.bookedBy || (s.status !== "booked" && s.status !== "done")) throw conflict("not_booked", "Only a booked interview gets feedback");
  if (s.startsAt > now) throw conflict("not_yet", "Feedback can be recorded once the interview has started");
  if ("noShow" in input) {
    await db.update(interviewSlots).set({ status: "no_show", feedback: null, feedbackAt: now }).where(eq(interviewSlots.id, s.id));
    return { status: "no_show" as const };
  }
  const keys = PANEL_RUBRIC.map(([k]) => k);
  if (keys.some((k) => !Number.isInteger(input.scores[k]) || input.scores[k]! < 1 || input.scores[k]! > 5)) throw badRequest(`Score each of ${keys.join(", ")} from 1 to 5`);
  const [by] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
  const feedback: PanelFeedback = {
    scores: Object.fromEntries(keys.map((k) => [k, input.scores[k]!])),
    overall: input.overall,
    recommendation: input.recommendation,
    strengths: input.strengths,
    improvements: input.improvements,
    by: by!.name,
  };
  await db.update(interviewSlots).set({ status: "done", feedback, feedbackAt: now }).where(eq(interviewSlots.id, s.id));
  await notify(
    db,
    [{ tenantId: s.tenantId, userId: s.bookedBy, template: "interview_slot", title: "Feedback from your mock interview", body: `${s.interviewerName}: ${PANEL_RECOMMENDATIONS[input.recommendation]}, ${input.overall}/5 overall.`, link: appLink("/play/panel"), dedupeKey: `slot-feedback:${s.id}` }],
    now,
  );
  await audit(db, { tenantId: s.tenantId, actorId: auth.userId, action: "interview_slot.feedback", target: s.id });
  return { status: "done" as const };
}

// ---------- Students ----------

export async function studentSlots(db: Db, ctx: Ctx) {
  const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
  const open = (
    await db
      .select()
      .from(interviewSlots)
      .where(and(eq(interviewSlots.tenantId, ctx.tenantId), eq(interviewSlots.status, "open"), gt(interviewSlots.startsAt, ctx.now)))
      .orderBy(asc(interviewSlots.startsAt))
      .limit(300)
  ).filter((s) => !s.unitIds.length || s.unitIds.some((u) => myUnits.has(u)));
  const mine = await db.select().from(interviewSlots).where(eq(interviewSlots.bookedBy, ctx.userId)).orderBy(desc(interviewSlots.startsAt)).limit(50);
  return {
    open: open.map((s) => slotView(s)),
    mine: mine.map((s) => ({ ...slotView(s), canCancel: s.status === "booked" && s.startsAt.getTime() - ctx.now.getTime() > CANCEL_BEFORE_MS })),
    rubric: PANEL_RUBRIC,
    recommendations: PANEL_RECOMMENDATIONS,
  };
}

export async function bookSlot(db: Db, ctx: Ctx, id: string) {
  const [s] = await db.select().from(interviewSlots).where(and(eq(interviewSlots.id, id), eq(interviewSlots.tenantId, ctx.tenantId)));
  if (!s) throw notFound("Slot");
  if (s.unitIds.length) {
    const myUnits = new Set(await studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId));
    if (!s.unitIds.some((u) => myUnits.has(u))) throw forbidden("This slot is for other batches");
  }
  if (s.startsAt <= ctx.now) throw conflict("slot_past", "This slot has already started");
  const [upcoming] = await db
    .select({ id: interviewSlots.id })
    .from(interviewSlots)
    .where(and(eq(interviewSlots.bookedBy, ctx.userId), eq(interviewSlots.status, "booked"), gt(interviewSlots.startsAt, ctx.now)));
  if (upcoming) throw conflict("already_booked", "You already have a mock interview booked. Cancel it to book another.");
  const [taken] = await db
    .update(interviewSlots)
    .set({ status: "booked", bookedBy: ctx.userId, bookedAt: ctx.now })
    .where(and(eq(interviewSlots.id, s.id), eq(interviewSlots.status, "open")))
    .returning();
  if (!taken) throw conflict("slot_taken", "Someone else just booked this slot");
  return studentSlots(db, ctx);
}

export async function cancelBooking(db: Db, ctx: Ctx, id: string) {
  const [s] = await db.select().from(interviewSlots).where(and(eq(interviewSlots.id, id), eq(interviewSlots.bookedBy, ctx.userId)));
  if (!s || s.status !== "booked") throw notFound("Booking");
  if (s.startsAt.getTime() - ctx.now.getTime() <= CANCEL_BEFORE_MS) throw conflict("too_late", "It's too close to the start to cancel. Tell the placement cell if you can't make it.");
  await db.update(interviewSlots).set({ status: "open", bookedBy: null, bookedAt: null }).where(eq(interviewSlots.id, s.id));
  return studentSlots(db, ctx);
}

/** Hourly: remind students of a booked interview in the next day (once). */
export async function slotReminders(db: Db, now: Date) {
  const soon = await db
    .select({ s: interviewSlots, timeZone: tenants.timeZone })
    .from(interviewSlots)
    .innerJoin(tenants, eq(tenants.id, interviewSlots.tenantId))
    .where(and(eq(interviewSlots.status, "booked"), gt(interviewSlots.startsAt, now), lte(interviewSlots.startsAt, new Date(now.getTime() + REMIND_WITHIN_MS))));
  return enqueue(
    db,
    soon.map(({ s, timeZone }) => ({
      tenantId: s.tenantId,
      userId: s.bookedBy!,
      template: "interview_slot" as const,
      title: "Mock interview tomorrow",
      body: `${label(s)}, ${when(s.startsAt, timeZone)}${s.location ? ` · ${s.location}` : ""}.`,
      link: appLink("/play/panel"),
      dedupeKey: `slot-remind:${s.id}`,
    })),
  );
}

/** For erasure: an upcoming booking reopens; past ones lose the student and the feedback about them. */
export async function forgetBookings(db: DbOrTx, userId: string) {
  await db.update(interviewSlots).set({ status: "open", bookedBy: null, bookedAt: null }).where(and(eq(interviewSlots.bookedBy, userId), eq(interviewSlots.status, "booked")));
  await db.update(interviewSlots).set({ bookedBy: null, feedback: null }).where(and(eq(interviewSlots.bookedBy, userId), ne(interviewSlots.status, "booked")));
}
