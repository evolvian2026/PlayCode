import { and, eq, sql } from "drizzle-orm";
import { JOINING_STATUSES, joiningDelayed, STUDENT_JOINING_STATUSES, type JoiningStatus } from "@playcode/core";
import type { Db } from "../db/client";
import { placementApplications, placementDrives, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";
import { getTenant, tenantToday } from "./tenant";

// Between accepting an offer and the first day at work there can be months:
// the offer letter, then a joining date, sometimes pushed back, and now and
// then an offer the company withdraws. Students say where they stand; the
// placement cell sees which companies are slow to onboard, and records a
// withdrawn offer, which stops counting so the student can sit for drives
// again.

const DAY_MS = 86_400_000;
const accepted = and(eq(placementApplications.status, "offered"), eq(placementApplications.decision, "accepted"));

export interface JoiningInput {
  status: JoiningStatus;
  joiningDate: string | null;
  note: string;
}

function clean(input: JoiningInput) {
  if ((input.status === "date_given" || input.status === "joined") && !input.joiningDate) throw badRequest("Enter the joining date");
  if (input.status === "revoked" && !input.note.trim()) throw badRequest("Say what the company told you");
  return { joiningStatus: input.status, joiningDate: input.status === "awaiting_letter" || input.status === "letter_received" ? null : input.joiningDate, joiningNote: input.note.trim() };
}

async function loadAccepted(db: Db, tenantId: string, driveId: string, userId: string) {
  const [row] = await db
    .select({ a: placementApplications, company: placementDrives.company })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.driveId, driveId), eq(placementApplications.userId, userId), accepted));
  if (!row) throw notFound("Accepted offer");
  return row;
}

/** A student says where their accepted offer stands. */
export async function setMyJoining(db: Db, ctx: { tenantId: string; userId: string; now: Date }, driveId: string, input: JoiningInput) {
  if (!STUDENT_JOINING_STATUSES.includes(input.status)) throw badRequest("Tell your placement cell if the company withdrew your offer");
  const { a } = await loadAccepted(db, ctx.tenantId, driveId, ctx.userId);
  if (a.joiningStatus === "revoked") throw badRequest("Your placement cell has recorded this offer as withdrawn");
  const today = tenantToday(await getTenant(db, ctx.tenantId), ctx.now);
  if (input.status === "joined" && input.joiningDate! > today) throw badRequest("You can say you've joined from your joining date");
  await db.update(placementApplications).set({ ...clean(input), joiningUpdatedAt: ctx.now }).where(and(eq(placementApplications.driveId, driveId), eq(placementApplications.userId, ctx.userId)));
  return { ok: true };
}

/** The placement cell records any status, including a withdrawn offer. */
export async function setJoining(db: Db, auth: AuthContext, driveId: string, userId: string, input: JoiningInput, now: Date) {
  if (!(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth))).includes(userId)) throw notFound("Accepted offer");
  const { a, company } = await loadAccepted(db, auth.tenantId!, driveId, userId);
  await db.update(placementApplications).set({ ...clean(input), joiningUpdatedAt: now }).where(and(eq(placementApplications.driveId, driveId), eq(placementApplications.userId, userId)));
  if (input.status === "revoked" && a.joiningStatus !== "revoked") {
    await enqueue(db, [
      {
        tenantId: auth.tenantId!,
        userId,
        template: "placement",
        title: `Your ${company} offer is recorded as withdrawn`,
        body: "It no longer counts as an offer you hold, so you can register for drives again. Your placement cell is here to help.",
        link: appLink("/play/placements"),
        dedupeKey: `offer-revoked:${driveId}:${userId}`,
        sentBy: auth.userId,
      },
    ]);
    void processOutbox(db, now).catch(() => {});
  }
  await audit(db, { tenantId: auth.tenantId!, actorId: auth.userId, action: input.status === "revoked" ? "placements.offer_revoked" : "placements.joining", target: driveId, data: { userId, status: input.status, joiningDate: input.joiningDate } });
  return joiningBoard(db, auth, now);
}

/** Every accepted campus offer in scope, with where it stands, and a summary by company. */
export async function joiningBoard(db: Db, auth: AuthContext, now: Date) {
  const tenant = await getTenant(db, auth.tenantId!);
  const today = tenantToday(tenant, now);
  const scope = new Set(await studentIdsInUnits(db, tenant.id, await scopedUnitIds(db, auth)));
  const rows = (
    await db
      .select({ a: placementApplications, company: placementDrives.company, roleTitle: placementDrives.roleTitle, driveDate: placementDrives.driveDate, driveCtc: placementDrives.ctcRupees, name: users.name, rollNo: users.rollNo })
      .from(placementApplications)
      .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
      .innerJoin(users, eq(users.id, placementApplications.userId))
      .where(and(eq(placementApplications.tenantId, tenant.id), accepted))
  ).filter((r) => scope.has(r.a.userId));
  const offers = rows
    .map((r) => ({
      driveId: r.a.driveId,
      userId: r.a.userId,
      name: r.name,
      rollNo: r.rollNo,
      company: r.company,
      roleTitle: r.roleTitle,
      driveDate: r.driveDate,
      ctcRupees: r.a.offerCtcRupees ?? r.driveCtc,
      status: r.a.joiningStatus,
      statusLabel: r.a.joiningStatus ? JOINING_STATUSES[r.a.joiningStatus] : "Not updated",
      joiningDate: r.a.joiningDate,
      note: r.a.joiningNote,
      updatedAt: r.a.joiningUpdatedAt,
      delayed: joiningDelayed({ status: r.a.joiningStatus, joiningDate: r.a.joiningDate, driveDate: r.driveDate }, today),
    }))
    .sort((x, y) => Number(y.delayed) - Number(x.delayed) || x.company.localeCompare(y.company) || (x.rollNo ?? x.name).localeCompare(y.rollNo ?? y.name, "en", { numeric: true }));
  const companies = [...new Set(offers.map((o) => o.company))]
    .map((company) => {
      const list = offers.filter((o) => o.company === company);
      const count = (s: JoiningStatus | null) => list.filter((o) => o.status === s).length;
      const dates = list.map((o) => o.joiningDate).filter((d): d is string => Boolean(d)).sort();
      return { company, accepted: list.length, joined: count("joined"), dateGiven: count("date_given"), letterReceived: count("letter_received"), awaitingLetter: count("awaiting_letter"), notUpdated: count(null), revoked: count("revoked"), delayed: list.filter((o) => o.delayed).length, nextJoining: dates.find((d) => d >= today) ?? null };
    })
    .sort((a, b) => b.delayed - a.delayed || b.accepted - a.accepted || a.company.localeCompare(b.company));
  return { offers, companies, totals: { accepted: offers.length, joined: offers.filter((o) => o.status === "joined").length, delayed: offers.filter((o) => o.delayed).length, revoked: offers.filter((o) => o.status === "revoked").length } };
}

/**
 * Hourly job: once a month, ask students with an accepted offer they haven't
 * joined yet (at least a month after the drive) where it stands, unless they
 * updated it in the last month.
 */
export async function joiningCheckIns(db: Db, now: Date) {
  const rows = await db
    .select({ a: placementApplications, company: placementDrives.company, driveDate: placementDrives.driveDate })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(accepted, sql`(${placementApplications.joiningStatus} is null or ${placementApplications.joiningStatus} not in ('joined', 'revoked'))`));
  const month = now.toISOString().slice(0, 7);
  const due = rows.filter(({ a, driveDate }) => now.getTime() - Date.parse(`${driveDate}T00:00:00Z`) >= 30 * DAY_MS && (!a.joiningUpdatedAt || now.getTime() - a.joiningUpdatedAt.getTime() >= 30 * DAY_MS));
  return enqueue(
    db,
    due.map(({ a, company }) => ({
      tenantId: a.tenantId,
      userId: a.userId,
      template: "placement" as const,
      title: `Any news from ${company}?`,
      body: "Tell your placement cell whether you have your offer letter or a joining date. It takes a few seconds.",
      link: appLink("/play/placements"),
      dedupeKey: `joining-check:${a.driveId}:${a.userId}:${month}`,
    })),
  );
}

