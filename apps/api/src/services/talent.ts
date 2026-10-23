import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { localDate, masteryFromRating, type CompanyType } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { academicRecords, drives, memberships, orgUnits, skillRatings, studentProfiles, talentInvites, tenants, users, type TalentInviteStatus } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors";
import { readinessFor } from "./analytics";
import { tenantLicence } from "./licence";
import { appLink, enqueue } from "./notifications";
import { recordConsent } from "./privacy";
import { resumeData, shareableProfile } from "./resume";

// The talent pool: students who choose to be found, at institutions that allow
// it, can be searched by companies on PlayCode by what PlayCode has measured
// (readiness, mastered skills, graduation year). A company invites a student
// to apply; the student's email and phone are shared with that company only
// when the student accepts. The placement cell sees which companies invited
// its students.

const DAY_MS = 86_400_000;
/** An invitation the student hasn't answered lapses after this long. */
export const INVITE_DAYS = 30;
/** After a student declines, the same company can't invite them again for this long. */
const DECLINE_COOLDOWN_DAYS = 90;
/** Invitations a company may send per day. */
export const DAILY_INVITES = 50;
const MASTERED = 60;
const MIN_ATTEMPTS = 5;
const MAX_RESULTS = 50;

type Ctx = { tenantId: string; userId: string; now: Date };

const effective = (status: TalentInviteStatus, expiresAt: Date, now: Date) => (status === "pending" && expiresAt <= now ? "expired" : status);

async function institutionAllows(db: DbOrTx, tenantId: string) {
  const [t] = await db.select({ type: tenants.type, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.type === "institution" && t.settings.talentPool === true;
}

// ---------- Students ----------

export async function myTalent(db: Db, ctx: Ctx) {
  const [row] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, ctx.userId));
  const invites = await db
    .select({ invite: talentInvites, company: tenants.name, inviteCode: drives.inviteCode, driveOpen: drives.status })
    .from(talentInvites)
    .innerJoin(tenants, eq(tenants.id, talentInvites.companyId))
    .leftJoin(drives, eq(drives.id, talentInvites.driveId))
    .where(eq(talentInvites.userId, ctx.userId))
    .orderBy(desc(talentInvites.createdAt))
    .limit(50);
  return {
    allowed: await institutionAllows(db, ctx.tenantId),
    discoverable: row?.discoverable ?? false,
    lookingFor: row?.lookingFor ?? {},
    invites: invites.map((r) => {
      const status = effective(r.invite.status, r.invite.expiresAt, ctx.now);
      return {
        id: r.invite.id,
        company: r.company,
        roleTitle: r.invite.roleTitle,
        message: r.invite.message,
        status,
        createdAt: r.invite.createdAt,
        expiresAt: r.invite.expiresAt,
        // Once accepted, the drive's apply link (if the company named one and it's still open).
        applyUrl: status === "accepted" && r.inviteCode && r.driveOpen === "open" ? appLink(`/apply/${r.inviteCode}`) : null,
      };
    }),
  };
}

export async function setDiscoverable(db: Db, ctx: Ctx, input: { discoverable: boolean; lookingFor: { locations?: string[]; companyTypes?: CompanyType[] } }) {
  if (input.discoverable && !(await institutionAllows(db, ctx.tenantId))) throw forbidden("Your institution hasn't opened the talent pool yet");
  const lookingFor = {
    locations: [...new Set((input.lookingFor.locations ?? []).map((l) => l.trim()).filter(Boolean))].slice(0, 5),
    companyTypes: input.lookingFor.companyTypes ?? [],
  };
  const [before] = await db.select({ discoverable: studentProfiles.discoverable }).from(studentProfiles).where(eq(studentProfiles.userId, ctx.userId));
  await db
    .insert(studentProfiles)
    .values({ userId: ctx.userId, tenantId: ctx.tenantId, discoverable: input.discoverable, lookingFor, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: studentProfiles.userId, set: { discoverable: input.discoverable, lookingFor, updatedAt: ctx.now } });
  if ((before?.discoverable ?? false) !== input.discoverable) {
    await recordConsent(db, { tenantId: ctx.tenantId, userId: ctx.userId, purpose: "talent_pool", granted: input.discoverable, source: "settings", now: ctx.now });
    await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: input.discoverable ? "talent.join" : "talent.leave", target: ctx.userId });
  }
  return myTalent(db, ctx);
}

export async function respondToInvite(db: Db, ctx: Ctx, inviteId: string, accept: boolean) {
  const [invite] = await db.select().from(talentInvites).where(and(eq(talentInvites.id, inviteId), eq(talentInvites.userId, ctx.userId)));
  if (!invite) throw notFound("Invitation");
  if (effective(invite.status, invite.expiresAt, ctx.now) !== "pending") throw conflict("invite_closed", "This invitation has already been answered or has lapsed");
  await db.update(talentInvites).set({ status: accept ? "accepted" : "declined", respondedAt: ctx.now }).where(eq(talentInvites.id, invite.id));
  // Accepting is the student's consent to share their contact details with this company.
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: accept ? "talent.invite_accepted" : "talent.invite_declined", target: invite.id, data: { company: invite.companyId } });
  return myTalent(db, ctx);
}

// ---------- Companies ----------

export interface TalentQuery {
  track: "service" | "product";
  minReadiness: number;
  graduationYear?: number;
  skills: string[];
  location?: string;
  cursor?: number;
}

async function assertCompany(db: DbOrTx, tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (t?.type !== "company") throw forbidden("The talent pool is for companies hiring on PlayCode");
  return t;
}

/** Talent-pool students with what a company may see, before any filter on readiness or skills. */
async function poolRows(db: DbOrTx, now: Date, userIds?: string[]) {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      institutionId: tenants.id,
      institution: tenants.name,
      settings: tenants.settings,
      headline: studentProfiles.headline,
      lookingFor: studentProfiles.lookingFor,
      hide: studentProfiles.hide,
      graduationYear: academicRecords.graduationYear,
      cgpa: academicRecords.cgpa,
    })
    .from(studentProfiles)
    .innerJoin(users, eq(users.id, studentProfiles.userId))
    .innerJoin(tenants, eq(tenants.id, studentProfiles.tenantId))
    .leftJoin(academicRecords, eq(academicRecords.userId, studentProfiles.userId))
    .where(and(eq(studentProfiles.discoverable, true), eq(users.status, "active"), eq(tenants.type, "institution"), userIds ? inArray(users.id, userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]) : undefined));
  // The institution can close its pool at any time, which hides its students at once; so does a lapsed licence.
  const open = rows.filter((r) => r.settings.talentPool === true);
  const lapsed = new Set<string>();
  for (const id of new Set(open.map((r) => r.institutionId))) if ((await tenantLicence(db, id, now)).state === "expired") lapsed.add(id);
  return open.filter((r) => !lapsed.has(r.institutionId));
}

export async function searchTalent(db: Db, ctx: Ctx, q: TalentQuery) {
  await assertCompany(db, ctx.tenantId);
  const loc = q.location?.trim().toLowerCase();
  const pool = (await poolRows(db, ctx.now)).filter(
    (r) =>
      (!q.graduationYear || r.graduationYear === q.graduationYear) &&
      (!loc || !r.lookingFor.locations?.length || r.lookingFor.locations.some((l) => l.toLowerCase().includes(loc))) &&
      (!r.lookingFor.companyTypes?.length || r.lookingFor.companyTypes.includes(q.track)),
  );
  const ids = pool.map((r) => r.userId);
  const today = localDate(ctx.now);
  const [readiness, ratings, programs, invites] = await Promise.all([
    readinessFor(db, ids, today),
    ids.length ? db.select().from(skillRatings).where(inArray(skillRatings.userId, ids)) : [],
    ids.length
      ? db
          .select({ userId: memberships.userId, name: orgUnits.name })
          .from(memberships)
          .innerJoin(orgUnits, eq(orgUnits.id, memberships.orgUnitId))
          .where(and(inArray(memberships.userId, ids), eq(memberships.role, "student"), eq(orgUnits.kind, "batch")))
      : [],
    ids.length ? db.select().from(talentInvites).where(and(eq(talentInvites.companyId, ctx.tenantId), inArray(talentInvites.userId, ids))).orderBy(desc(talentInvites.createdAt)) : [],
  ]);
  const mastered = new Map<string, Set<string>>();
  for (const r of ratings) if (r.attempts >= MIN_ATTEMPTS && masteryFromRating(r.rating) >= MASTERED) (mastered.get(r.userId) ?? mastered.set(r.userId, new Set()).get(r.userId)!).add(r.skillId);
  const latestInvite = new Map<string, (typeof invites)[number]>();
  for (const i of invites) if (!latestInvite.has(i.userId)) latestInvite.set(i.userId, i);

  const matches = pool
    .map((r) => ({ ...r, readiness: readiness.get(r.userId) ?? { service: 0, product: 0 }, mastered: mastered.get(r.userId) ?? new Set<string>() }))
    .filter((r) => (r.readiness[q.track] ?? 0) >= q.minReadiness && q.skills.every((s) => r.mastered.has(s)))
    .sort((a, b) => (b.readiness[q.track] ?? 0) - (a.readiness[q.track] ?? 0) || a.userId.localeCompare(b.userId));
  const start = q.cursor ?? 0;
  const page = matches.slice(start, start + MAX_RESULTS);
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "talent.search", data: { ...q, results: matches.length } });
  return {
    total: matches.length,
    nextCursor: start + MAX_RESULTS < matches.length ? start + MAX_RESULTS : null,
    candidates: page.map((r) => {
      const invite = latestInvite.get(r.userId);
      return {
        userId: r.userId,
        name: r.name,
        institution: r.institution,
        program: programs.find((p) => p.userId === r.userId)?.name ?? null,
        graduationYear: r.graduationYear,
        headline: r.headline,
        readiness: { service: r.readiness.service ?? 0, product: r.readiness.product ?? 0 },
        cgpa: r.hide.marks ? null : r.cgpa,
        masteredSkills: r.mastered.size,
        locations: r.lookingFor.locations ?? [],
        invite: invite ? { id: invite.id, status: effective(invite.status, invite.expiresAt, ctx.now) } : null,
      };
    }),
  };
}

/** One talent-pool student as a company sees them: the public-profile view, plus marks if the student shares them. */
export async function candidateProfile(db: Db, ctx: Ctx, userId: string) {
  await assertCompany(db, ctx.tenantId);
  const [row] = await poolRows(db, ctx.now, [userId]);
  if (!row) throw notFound("Candidate");
  const d = await resumeData(db, userId, ctx.now);
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "talent.view", target: userId });
  return { userId, ...shareableProfile(d, ctx.now), academic: d.hide.marks ? null : d.academic, lookingFor: row.lookingFor };
}

export async function sendInvite(db: Db, ctx: Ctx, input: { userId: string; roleTitle: string; message: string; driveId: string | null }) {
  const company = await assertCompany(db, ctx.tenantId);
  const [student] = await poolRows(db, ctx.now, [input.userId]);
  if (!student) throw notFound("Candidate");
  if (input.driveId) {
    const [drive] = await db.select().from(drives).where(and(eq(drives.id, input.driveId), eq(drives.tenantId, ctx.tenantId)));
    if (!drive || drive.status !== "open") throw badRequest("Choose one of your open drives, or none");
  }
  const previous = await db.select().from(talentInvites).where(and(eq(talentInvites.companyId, ctx.tenantId), eq(talentInvites.userId, input.userId))).orderBy(desc(talentInvites.createdAt)).limit(1);
  const last = previous[0];
  if (last && effective(last.status, last.expiresAt, ctx.now) === "pending") throw conflict("already_invited", "You have already invited this student; wait for their answer");
  if (last?.status === "declined" && last.respondedAt && last.respondedAt.getTime() > ctx.now.getTime() - DECLINE_COOLDOWN_DAYS * DAY_MS) {
    throw conflict("recently_declined", `This student declined your last invitation. You can invite them again ${DECLINE_COOLDOWN_DAYS} days after that.`);
  }
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(talentInvites)
    .where(and(eq(talentInvites.companyId, ctx.tenantId), gte(talentInvites.createdAt, new Date(ctx.now.getTime() - DAY_MS))))) as [{ n: number }];
  if (n >= DAILY_INVITES) throw new HttpError(429, "invite_limit", `You can send ${DAILY_INVITES} invitations a day`);

  const [invite] = await db
    .insert(talentInvites)
    .values({
      companyId: ctx.tenantId,
      userId: input.userId,
      institutionId: student.institutionId,
      driveId: input.driveId,
      roleTitle: input.roleTitle,
      message: input.message,
      createdBy: ctx.userId,
      createdAt: ctx.now,
      expiresAt: new Date(ctx.now.getTime() + INVITE_DAYS * DAY_MS),
    })
    .returning();
  await enqueue(db, [
    {
      tenantId: student.institutionId,
      userId: input.userId,
      template: "talent_invite",
      title: `${company.name} invited you to apply`,
      body: `${input.roleTitle}. Open PlayCode to read their message and accept or decline.`,
      link: appLink("/play/talent"),
      dedupeKey: `talent:${invite!.id}`,
    },
  ]);
  await audit(db, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "talent.invite", target: input.userId, data: { invite: invite!.id, drive: input.driveId } });
  return invite!;
}

/** A company's invitations, with contact details for the ones accepted. */
export async function companyInvites(db: Db, ctx: Ctx) {
  await assertCompany(db, ctx.tenantId);
  const rows = await db
    .select({ invite: talentInvites, name: users.name, email: users.email, phone: users.phone, institution: tenants.name, drive: drives.title })
    .from(talentInvites)
    .innerJoin(users, eq(users.id, talentInvites.userId))
    .innerJoin(tenants, eq(tenants.id, talentInvites.institutionId))
    .leftJoin(drives, eq(drives.id, talentInvites.driveId))
    .where(eq(talentInvites.companyId, ctx.tenantId))
    .orderBy(desc(talentInvites.createdAt))
    .limit(500);
  const [{ n: sentToday }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(talentInvites)
    .where(and(eq(talentInvites.companyId, ctx.tenantId), gte(talentInvites.createdAt, new Date(ctx.now.getTime() - DAY_MS))))) as [{ n: number }];
  return {
    left: Math.max(0, DAILY_INVITES - sentToday),
    invites: rows.map((r) => {
      const status = effective(r.invite.status, r.invite.expiresAt, ctx.now);
      return {
        id: r.invite.id,
        userId: r.invite.userId,
        name: r.name,
        institution: r.institution,
        roleTitle: r.invite.roleTitle,
        drive: r.drive,
        status,
        createdAt: r.invite.createdAt,
        respondedAt: r.invite.respondedAt,
        contact: status === "accepted" ? { email: r.email, phone: r.phone } : null,
      };
    }),
  };
}

// ---------- Institutions ----------

/** For the placement cell: how many students are in the pool and which companies invited them. */
export async function institutionTalent(db: Db, tenantId: string, now: Date) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const [{ n: inPool }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(studentProfiles)
    .where(and(eq(studentProfiles.tenantId, tenantId), eq(studentProfiles.discoverable, true)))) as [{ n: number }];
  const rows = await db
    .select({ invite: talentInvites, company: tenants.name, student: users.name, rollNo: users.rollNo })
    .from(talentInvites)
    .innerJoin(tenants, eq(tenants.id, talentInvites.companyId))
    .innerJoin(users, eq(users.id, talentInvites.userId))
    .where(eq(talentInvites.institutionId, tenantId))
    .orderBy(desc(talentInvites.createdAt))
    .limit(500);
  const byCompany = new Map<string, { company: string; invited: number; accepted: number }>();
  for (const r of rows) {
    const c = byCompany.get(r.company) ?? byCompany.set(r.company, { company: r.company, invited: 0, accepted: 0 }).get(r.company)!;
    c.invited++;
    if (r.invite.status === "accepted") c.accepted++;
  }
  return {
    open: tenant?.settings.talentPool === true,
    inPool,
    companies: [...byCompany.values()].sort((a, b) => b.invited - a.invited),
    invites: rows.slice(0, 100).map((r) => ({ id: r.invite.id, userId: r.invite.userId, student: r.student, rollNo: r.rollNo, company: r.company, roleTitle: r.invite.roleTitle, status: effective(r.invite.status, r.invite.expiresAt, now), createdAt: r.invite.createdAt })),
  };
}

export async function setInstitutionPool(db: Db, args: { tenantId: string; actorId: string; open: boolean }) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, args.tenantId));
  if (t?.type !== "institution") throw badRequest("Only institutions have a talent pool");
  await db.update(tenants).set({ settings: { ...t.settings, talentPool: args.open } }).where(eq(tenants.id, t.id));
  await audit(db, { tenantId: t.id, actorId: args.actorId, action: args.open ? "talent.pool_open" : "talent.pool_close" });
  return { open: args.open };
}
