import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { followUpState, type CompanyStage, type InteractionKind } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { placementApplications, placementDrives, recruiterContacts, recruiterInteractions, recruiters, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { getTenant, tenantToday } from "./tenant";

// Company relations: the placement cell's list of recruiters, from first
// contact to a campus visit. Each company has its people, a log of calls,
// emails and meetings, and a date to follow up on, so nothing slips between
// placement officers; and each is matched by name to the drives it has held.

type Auth = { tenantId: string; userId: string };
type Row = typeof recruiters.$inferSelect;

export interface RecruiterInput {
  name: string;
  sector: string;
  website: string | null;
  stage: CompanyStage;
  notes: string;
  ownerId: string | null;
}

const key = (name: string) => name.trim().toLowerCase();

async function load(db: DbOrTx, tenantId: string, id: string) {
  const [r] = await db.select().from(recruiters).where(and(eq(recruiters.id, id), eq(recruiters.tenantId, tenantId)));
  if (!r) throw notFound("Company");
  return r;
}

/** Drives held, and offers made, per company name. */
async function driveStats(db: DbOrTx, tenantId: string) {
  const drives = await db.select({ id: placementDrives.id, company: placementDrives.company, driveDate: placementDrives.driveDate, ctc: placementDrives.ctcRupees }).from(placementDrives).where(eq(placementDrives.tenantId, tenantId));
  const offers = drives.length
    ? await db
        .select({ driveId: placementApplications.driveId, n: sql<number>`count(*)::int` })
        .from(placementApplications)
        .where(and(eq(placementApplications.tenantId, tenantId), eq(placementApplications.status, "offered")))
        .groupBy(placementApplications.driveId)
    : [];
  const byDrive = new Map(offers.map((o) => [o.driveId, o.n]));
  const out = new Map<string, { drives: number; offers: number; lastDrive: string | null; highestCtc: number | null }>();
  for (const d of drives) {
    const s = out.get(key(d.company)) ?? { drives: 0, offers: 0, lastDrive: null, highestCtc: null };
    s.drives++;
    s.offers += byDrive.get(d.id) ?? 0;
    if (!s.lastDrive || d.driveDate > s.lastDrive) s.lastDrive = d.driveDate;
    s.highestCtc = Math.max(s.highestCtc ?? 0, d.ctc);
    out.set(key(d.company), s);
  }
  return out;
}

export async function listRecruiters(db: Db, auth: Auth, now: Date) {
  const tenant = await getTenant(db, auth.tenantId);
  const today = tenantToday(tenant, now);
  const [rows, owners, interactions, stats] = await Promise.all([
    db.select().from(recruiters).where(eq(recruiters.tenantId, auth.tenantId)).orderBy(asc(recruiters.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, auth.tenantId)),
    db.select().from(recruiterInteractions).where(eq(recruiterInteractions.tenantId, auth.tenantId)).orderBy(desc(recruiterInteractions.on)),
    driveStats(db, auth.tenantId),
  ]);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const list = rows.map((r) => {
    const mine = interactions.filter((i) => i.recruiterId === r.id);
    const next = mine.filter((i) => i.followUpOn && !i.followUpDone).sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!))[0];
    return {
      id: r.id,
      name: r.name,
      sector: r.sector,
      stage: r.stage,
      owner: r.ownerId ? (ownerName.get(r.ownerId) ?? null) : null,
      lastContact: mine[0]?.on ?? null,
      followUp: next ? { id: next.id, on: next.followUpOn!, state: followUpState(next.followUpOn!, today), note: next.note } : null,
      drives: stats.get(key(r.name)) ?? { drives: 0, offers: 0, lastDrive: null, highestCtc: null },
    };
  });
  // Companies that held drives but aren't on the list yet, so the placement cell can add them.
  const known = new Set(rows.map((r) => key(r.name)));
  const drivesOnly = [...stats.entries()].filter(([k]) => !known.has(k)).length;
  const due = list.filter((r) => r.followUp && r.followUp.state !== "upcoming").sort((a, b) => a.followUp!.on.localeCompare(b.followUp!.on));
  return { recruiters: list, due, notListed: drivesOnly };
}

/** Add every company that has held a drive but isn't on the list, as visited. */
export async function importFromDrives(db: Db, auth: Auth, now: Date) {
  const stats = await driveStats(db, auth.tenantId);
  const names = new Map((await db.select({ company: placementDrives.company }).from(placementDrives).where(eq(placementDrives.tenantId, auth.tenantId))).map((d) => [key(d.company), d.company.trim()]));
  const known = new Set((await db.select({ name: recruiters.name }).from(recruiters).where(eq(recruiters.tenantId, auth.tenantId))).map((r) => key(r.name)));
  const add = [...stats.keys()].filter((k) => !known.has(k));
  if (add.length) await db.insert(recruiters).values(add.map((k) => ({ tenantId: auth.tenantId, name: names.get(k)!, stage: "visited" as const, ownerId: auth.userId, createdAt: now, updatedAt: now })));
  return { added: add.length };
}

export async function createRecruiter(db: Db, auth: Auth, input: RecruiterInput, now: Date) {
  const [dup] = await db.select({ id: recruiters.id }).from(recruiters).where(and(eq(recruiters.tenantId, auth.tenantId), sql`lower(${recruiters.name}) = ${key(input.name)}`));
  if (dup) throw conflict("exists", `${input.name} is already on the list`);
  const [r] = await db.insert(recruiters).values({ tenantId: auth.tenantId, ...input, name: input.name.trim(), createdAt: now, updatedAt: now }).returning();
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "recruiters.create", target: r!.id });
  return recruiterDetail(db, auth, r!.id, now);
}

export async function updateRecruiter(db: Db, auth: Auth, id: string, input: RecruiterInput, now: Date) {
  const r = await load(db, auth.tenantId, id);
  if (key(input.name) !== key(r.name)) {
    const [dup] = await db.select({ id: recruiters.id }).from(recruiters).where(and(eq(recruiters.tenantId, auth.tenantId), sql`lower(${recruiters.name}) = ${key(input.name)}`));
    if (dup) throw conflict("exists", `${input.name} is already on the list`);
  }
  await db.update(recruiters).set({ ...input, name: input.name.trim(), updatedAt: now }).where(eq(recruiters.id, r.id));
  return recruiterDetail(db, auth, r.id, now);
}

export async function deleteRecruiter(db: Db, auth: Auth, id: string) {
  const r = await load(db, auth.tenantId, id);
  await db.delete(recruiters).where(eq(recruiters.id, r.id));
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: "recruiters.delete", target: r.id, data: { name: r.name } });
  return { ok: true };
}

export async function recruiterDetail(db: Db, auth: Auth, id: string, now: Date) {
  const r: Row = await load(db, auth.tenantId, id);
  const tenant = await getTenant(db, auth.tenantId);
  const today = tenantToday(tenant, now);
  const [contacts, interactions, drives] = await Promise.all([
    db.select().from(recruiterContacts).where(eq(recruiterContacts.recruiterId, r.id)).orderBy(asc(recruiterContacts.createdAt)),
    db
      .select({ i: recruiterInteractions, by: users.name })
      .from(recruiterInteractions)
      .leftJoin(users, eq(users.id, recruiterInteractions.byId))
      .where(eq(recruiterInteractions.recruiterId, r.id))
      .orderBy(desc(recruiterInteractions.on), desc(recruiterInteractions.createdAt)),
    db.select().from(placementDrives).where(and(eq(placementDrives.tenantId, auth.tenantId), sql`lower(trim(${placementDrives.company})) = ${key(r.name)}`)).orderBy(desc(placementDrives.driveDate)),
  ]);
  const offers = drives.length
    ? await db
        .select({ driveId: placementApplications.driveId, n: sql<number>`count(*)::int` })
        .from(placementApplications)
        .where(and(inArray(placementApplications.driveId, drives.map((d) => d.id)), eq(placementApplications.status, "offered")))
        .groupBy(placementApplications.driveId)
    : [];
  return {
    id: r.id,
    name: r.name,
    sector: r.sector,
    website: r.website,
    stage: r.stage,
    notes: r.notes,
    ownerId: r.ownerId,
    contacts: contacts.map(({ id: cid, name, designation, email, phone }) => ({ id: cid, name, designation, email, phone })),
    interactions: interactions.map(({ i, by }) => ({ id: i.id, kind: i.kind, on: i.on, note: i.note, followUpOn: i.followUpOn, followUpDone: i.followUpDone, state: i.followUpOn && !i.followUpDone ? followUpState(i.followUpOn, today) : null, by })),
    drives: drives.map((d) => ({ id: d.id, roleTitle: d.roleTitle, driveDate: d.driveDate, ctcRupees: d.ctcRupees, status: d.status, offers: offers.find((o) => o.driveId === d.id)?.n ?? 0 })),
  };
}

export async function addContact(db: Db, auth: Auth, id: string, input: { name: string; designation: string; email: string | null; phone: string | null }, now: Date) {
  const r = await load(db, auth.tenantId, id);
  if (!input.email && !input.phone) throw badRequest("Add an email or a phone number");
  await db.insert(recruiterContacts).values({ recruiterId: r.id, ...input, createdAt: now });
  return recruiterDetail(db, auth, r.id, now);
}

export async function removeContact(db: Db, auth: Auth, id: string, contactId: string, now: Date) {
  const r = await load(db, auth.tenantId, id);
  await db.delete(recruiterContacts).where(and(eq(recruiterContacts.id, contactId), eq(recruiterContacts.recruiterId, r.id)));
  return recruiterDetail(db, auth, r.id, now);
}

export interface InteractionInput {
  kind: InteractionKind;
  on: string;
  note: string;
  followUpOn: string | null;
  stage: CompanyStage | null;
}

/** Log a call or meeting; logging one closes the follow-ups it answers, and can move the company on. */
export async function logInteraction(db: Db, auth: Auth, id: string, input: InteractionInput, now: Date) {
  const r = await load(db, auth.tenantId, id);
  const today = tenantToday(await getTenant(db, auth.tenantId), now);
  if (input.on > today) throw badRequest("It can't have happened in the future");
  if (input.followUpOn && input.followUpOn < input.on) throw badRequest("The follow-up can't be before it");
  await db.transaction(async (tx) => {
    await tx.update(recruiterInteractions).set({ followUpDone: true }).where(and(eq(recruiterInteractions.recruiterId, r.id), eq(recruiterInteractions.followUpDone, false)));
    await tx.insert(recruiterInteractions).values({ recruiterId: r.id, tenantId: auth.tenantId, kind: input.kind, on: input.on, note: input.note, followUpOn: input.followUpOn, byId: auth.userId, createdAt: now });
    await tx.update(recruiters).set({ stage: input.stage ?? r.stage, updatedAt: now }).where(eq(recruiters.id, r.id));
  });
  return recruiterDetail(db, auth, r.id, now);
}

export async function completeFollowUp(db: Db, auth: Auth, id: string, interactionId: string, now: Date) {
  const r = await load(db, auth.tenantId, id);
  await db.update(recruiterInteractions).set({ followUpDone: true }).where(and(eq(recruiterInteractions.id, interactionId), eq(recruiterInteractions.recruiterId, r.id)));
  return recruiterDetail(db, auth, r.id, now);
}

/** Follow-ups not done yet between two days, for the console calendar. */
export async function openFollowUps(db: DbOrTx, tenantId: string, fromDay: string, toDay: string) {
  return db
    .select({ id: recruiterInteractions.id, recruiterId: recruiters.id, name: recruiters.name, on: recruiterInteractions.followUpOn, note: recruiterInteractions.note })
    .from(recruiterInteractions)
    .innerJoin(recruiters, eq(recruiters.id, recruiterInteractions.recruiterId))
    .where(and(eq(recruiterInteractions.tenantId, tenantId), eq(recruiterInteractions.followUpDone, false), sql`${recruiterInteractions.followUpOn} between ${fromDay} and ${toDay}`));
}
