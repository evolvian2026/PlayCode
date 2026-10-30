import { and, desc, eq, isNull } from "drizzle-orm";
import { formatLpa, OPENING_KINDS, openingState, type OpeningKind, type OpeningResponse, type PlacementCriteria } from "@playcode/core";
import type { Db } from "../db/client";
import { openingResponses, placementOpenings, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { eligibilityChecker, studentsEligible } from "./placements";
import { tenantUnits } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Openings found outside campus drives: an off-campus hiring drive, a pool
// campus at another college, an internship. The placement cell shares the
// link with the same eligibility rules as a drive, and the students it fits
// are told. Students say whether they applied, so the placement cell knows
// who to follow up with; the selection itself happens with the company.

type Auth = { tenantId: string; userId: string };
type Row = typeof placementOpenings.$inferSelect;

export interface OpeningInput {
  kind: OpeningKind;
  company: string;
  roleTitle: string;
  payRupees: number | null;
  location: string;
  details: string;
  applyUrl: string | null;
  closesOn: string;
  criteria: PlacementCriteria;
}

const pay = (o: { kind: OpeningKind; payRupees: number | null }) => (o.payRupees === null ? null : o.kind === "internship" ? `₹${o.payRupees.toLocaleString("en-IN")} a month` : formatLpa(o.payRupees));
// Offer tiers apply to jobs; an internship's stipend isn't a package.
const ctcOf = (o: { kind: OpeningKind; payRupees: number | null }) => (o.kind === "internship" ? null : o.payRupees);

async function load(db: Db, tenantId: string, id: string) {
  const [o] = await db.select().from(placementOpenings).where(and(eq(placementOpenings.id, id), eq(placementOpenings.tenantId, tenantId)));
  if (!o) throw notFound("Opening");
  return o;
}

export async function createOpening(db: Db, auth: Auth, input: OpeningInput, now: Date) {
  const tenant = await getTenant(db, auth.tenantId);
  if (input.closesOn < tenantToday(tenant, now)) throw badRequest("The last day to apply can't be in the past");
  if (!input.applyUrl && !input.details.trim()) throw badRequest("Add the link to apply, or say how to apply");
  const units = new Set((await tenantUnits(db, auth.tenantId)).map((u) => u.id));
  if (input.criteria.unitIds.some((u) => !units.has(u))) throw badRequest("Unknown branch or batch");
  const [o] = await db
    .insert(placementOpenings)
    .values({ tenantId: auth.tenantId, ...input, company: input.company.trim(), roleTitle: input.roleTitle.trim(), details: input.details.trim(), createdBy: auth.userId, createdAt: now })
    .returning();
  const eligible = await studentsEligible(db, auth.tenantId, input.criteria, { driveId: null, ctcRupees: ctcOf(input), now });
  const by = new Date(`${input.closesOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  await enqueue(
    db,
    eligible.map((userId) => ({
      tenantId: auth.tenantId,
      userId,
      template: "placement" as const,
      title: `${OPENING_KINDS[input.kind]}: ${input.company} ${input.roleTitle}`,
      body: `${[pay(input), input.location].filter(Boolean).join(", ")}${pay(input) || input.location ? ". " : ""}You are eligible. Apply by ${by}.`,
      link: appLink(`/play/openings?id=${o!.id}`),
      dedupeKey: `opening:${o!.id}:${userId}`,
      sentBy: auth.userId,
    })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.opening_create", target: o!.id, data: { company: o!.company, notified: eligible.length } });
  return { opening: await staffView(db, o!, now), notified: eligible.length };
}

/** Taking an opening down: students no longer see it, and what they said stays for the record. */
export async function withdrawOpening(db: Db, auth: Auth, id: string, now: Date) {
  const o = await load(db, auth.tenantId, id);
  await db.update(placementOpenings).set({ withdrawnAt: now }).where(eq(placementOpenings.id, o.id));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "placements.opening_withdraw", target: o.id });
  return { ok: true };
}

async function staffView(db: Db, o: Row, now: Date) {
  const tenant = await getTenant(db, o.tenantId);
  const responses = await db.select({ response: openingResponses.response }).from(openingResponses).where(eq(openingResponses.openingId, o.id));
  return {
    ...o,
    kindLabel: OPENING_KINDS[o.kind],
    pay: pay(o),
    state: o.withdrawnAt ? ("withdrawn" as const) : openingState(o.closesOn, tenantToday(tenant, now)),
    applied: responses.filter((r) => r.response === "applied").length,
    notInterested: responses.filter((r) => r.response === "not_interested").length,
  };
}

export async function listOpeningsForStaff(db: Db, tenantId: string, now: Date) {
  const rows = await db.select().from(placementOpenings).where(eq(placementOpenings.tenantId, tenantId)).orderBy(desc(placementOpenings.closesOn));
  return { openings: await Promise.all(rows.map((o) => staffView(db, o, now))) };
}

/** Who applied and who passed, with how many eligible students haven't said. */
export async function openingResponsesFor(db: Db, tenantId: string, id: string, now: Date) {
  const o = await load(db, tenantId, id);
  const [rows, eligible] = await Promise.all([
    db
      .select({ userId: openingResponses.userId, response: openingResponses.response, updatedAt: openingResponses.updatedAt, name: users.name, rollNo: users.rollNo, email: users.email })
      .from(openingResponses)
      .innerJoin(users, eq(users.id, openingResponses.userId))
      .where(eq(openingResponses.openingId, o.id))
      .orderBy(desc(openingResponses.updatedAt)),
    studentsEligible(db, tenantId, o.criteria, { driveId: null, ctcRupees: ctcOf(o), now }),
  ]);
  const answered = new Set(rows.map((r) => r.userId));
  return { opening: await staffView(db, o, now), responses: rows, eligible: eligible.length, notAnswered: eligible.filter((id) => !answered.has(id)).length };
}

// ---------- Students ----------

/** Openings a student is eligible for that are still open, and any they answered. */
export async function myOpenings(db: Db, ctx: { tenantId: string; userId: string; now: Date }) {
  const tenant = await getTenant(db, ctx.tenantId);
  const today = tenantToday(tenant, ctx.now);
  const [rows, mine, check] = await Promise.all([
    db.select().from(placementOpenings).where(and(eq(placementOpenings.tenantId, ctx.tenantId), isNull(placementOpenings.withdrawnAt))).orderBy(placementOpenings.closesOn),
    db.select().from(openingResponses).where(and(eq(openingResponses.tenantId, ctx.tenantId), eq(openingResponses.userId, ctx.userId))),
    eligibilityChecker(db, ctx.tenantId, ctx.userId, ctx.now),
  ]);
  const answered = new Map(mine.map((r) => [r.openingId, r.response]));
  const out = [];
  for (const o of rows) {
    const state = openingState(o.closesOn, today);
    const response = answered.get(o.id) ?? null;
    if (state === "closed" && !response) continue;
    const eligibility = check(o.criteria, ctcOf(o));
    // Students only see what they could apply for, or what they already answered.
    if (!eligibility.eligible && !response) continue;
    out.push({ id: o.id, kind: o.kind, kindLabel: OPENING_KINDS[o.kind], company: o.company, roleTitle: o.roleTitle, pay: pay(o), location: o.location, details: o.details, applyUrl: o.applyUrl, closesOn: o.closesOn, state, response });
  }
  return { openings: out };
}

export async function respond(db: Db, ctx: { tenantId: string; userId: string; now: Date }, id: string, response: OpeningResponse | null) {
  const o = await load(db, ctx.tenantId, id);
  if (o.withdrawnAt) throw notFound("Opening");
  const tenant = await getTenant(db, ctx.tenantId);
  if (openingState(o.closesOn, tenantToday(tenant, ctx.now)) === "closed") throw badRequest("This opening has closed");
  if (response !== null) {
    const e = (await eligibilityChecker(db, ctx.tenantId, ctx.userId, ctx.now))(o.criteria, ctcOf(o));
    if (!e.eligible) throw badRequest(`You are not eligible: ${e.reasons.join("; ")}`);
  }
  const where = and(eq(openingResponses.openingId, o.id), eq(openingResponses.userId, ctx.userId));
  if (response === null) await db.delete(openingResponses).where(where);
  else
    await db
      .insert(openingResponses)
      .values({ openingId: o.id, userId: ctx.userId, tenantId: ctx.tenantId, response, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: [openingResponses.openingId, openingResponses.userId], set: { response, updatedAt: ctx.now } });
  return myOpenings(db, ctx);
}

/** For the data export: the openings a student answered. */
export async function openingResponsesForExport(db: Db, userId: string) {
  const rows = await db
    .select({ company: placementOpenings.company, roleTitle: placementOpenings.roleTitle, response: openingResponses.response, at: openingResponses.updatedAt })
    .from(openingResponses)
    .innerJoin(placementOpenings, eq(placementOpenings.id, openingResponses.openingId))
    .where(eq(openingResponses.userId, userId));
  return rows;
}

