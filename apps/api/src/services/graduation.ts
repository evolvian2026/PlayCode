import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { EXIT_ITEMS, EXIT_SURVEY_MIN_RESPONSES, exitSummary, GRADUATION_UNDO_DAYS, type ExitItem } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { academicRecords, alumni, batchGraduations, graduateResponses, memberships, placementApplications, placementDrives, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { descendants, scopedUnitIds, studentUnitIdsWithAncestors, tenantUnits, type AuthContext } from "./scope";

// Graduating a batch. At the end of the final year the institution marks a
// batch as graduated: its students' accounts become read-only (they can still
// sign in, see and download their resume, certificates and records, and
// answer offers and joining), they stop using seats, and nothing reaches
// them any more as current students. Each graduate is asked to join the
// alumni list, so juniors can ask them for advice, and to answer a short exit
// survey on training and placement, which staff see only in aggregate.

type Ctx = { tenantId: string; userId: string; now: Date };
const DAY = 86_400_000;

// ---------- Graduates' accounts ----------

/** What a graduate can still change: their sign-in and privacy, offers and joining, and their graduation answers. */
const GRADUATE_ALLOWED = ["/auth/", "/privacy", "/push/", "/me", "/student/notifications/read", "/student/settings", "/student/graduation"];
const GRADUATE_ALLOWED_RE = /^\/student\/placements\/[^/]+\/(decision|joining)(\?|$)/;

/** When the student graduated in this institution, or null for a current student. */
export async function graduatedAt(db: DbOrTx, userId: string, tenantId: string): Promise<Date | null> {
  const rows = await db.select({ at: memberships.graduatedAt }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId), eq(memberships.role, "student")));
  if (!rows.length || rows.some((r) => !r.at)) return null;
  return rows.map((r) => r.at!).sort((a, b) => b.getTime() - a.getTime())[0]!;
}

/** Refuse a change from a graduate's account, outside what graduates can still do. */
export async function assertNotGraduated(db: DbOrTx, args: { userId: string; tenantId: string | null; roles: string[]; method: string; url: string }) {
  if (!args.tenantId || args.method === "GET" || args.method === "HEAD" || args.method === "OPTIONS") return;
  if (args.roles.length !== 1 || args.roles[0] !== "student") return;
  if (GRADUATE_ALLOWED.some((p) => args.url.startsWith(p)) || GRADUATE_ALLOWED_RE.test(args.url)) return;
  if (await graduatedAt(db, args.userId, args.tenantId)) throw new HttpError(403, "graduated", "You've graduated, so practice is closed. You can still see and download your resume, certificates and records.");
}

// ---------- The institution ----------

async function batchesInScope(db: Db, auth: AuthContext) {
  const tenantId = auth.tenantId!;
  const [units, scoped] = await Promise.all([tenantUnits(db, tenantId), scopedUnitIds(db, auth)]);
  const inScope = new Set(scoped);
  return { units, batches: units.filter((u) => u.kind === "batch" && inScope.has(u.id)) };
}

/** Student memberships in a batch and its sections, with whether each has graduated. */
async function batchMembers(db: DbOrTx, tenantId: string, units: { id: string; parentId: string | null }[], batchId: string) {
  const unitIds = descendants(units, [batchId]);
  return db
    .select({ id: memberships.id, userId: memberships.userId, graduatedAt: memberships.graduatedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student"), inArray(memberships.orgUnitId, unitIds), eq(users.status, "active")));
}

async function acceptedOffers(db: DbOrTx, tenantId: string, userIds: string[]) {
  if (!userIds.length) return [];
  return db
    .select({ userId: placementApplications.userId, company: placementDrives.company, roleTitle: placementDrives.roleTitle, location: placementDrives.location, decision: placementApplications.decision, joiningStatus: placementApplications.joiningStatus })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.tenantId, tenantId), inArray(placementApplications.userId, userIds), eq(placementApplications.status, "offered")));
}

/** Every batch: who's still current, who graduated, and for graduated batches, the alumni list and exit survey. */
export async function graduationOverview(db: Db, auth: AuthContext, now: Date) {
  const tenantId = auth.tenantId!;
  const { units, batches } = await batchesInScope(db, auth);
  const [records, responses, byNames] = await Promise.all([
    db.select().from(batchGraduations).where(and(eq(batchGraduations.tenantId, tenantId), isNull(batchGraduations.undoneAt))).orderBy(desc(batchGraduations.graduatedAt)),
    db.select().from(graduateResponses).where(eq(graduateResponses.tenantId, tenantId)),
    db.select({ id: users.id, name: users.name }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(eq(memberships.tenantId, tenantId)),
  ]);
  const name = new Map(byNames.map((u) => [u.id, u.name]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const out = [];
  for (const b of batches) {
    const members = await batchMembers(db, tenantId, units, b.id);
    const graduated = members.filter((m) => m.graduatedAt);
    const record = records.find((r) => r.unitId === b.id) ?? null;
    const answers = responses.filter((r) => r.unitId === b.id);
    const surveyed = answers.filter((r) => r.ratings && r.recommend !== null);
    const summary = exitSummary(surveyed.map((r) => ({ ratings: r.ratings!, recommend: r.recommend! })));
    const enough = surveyed.length >= EXIT_SURVEY_MIN_RESPONSES;
    out.push({
      id: b.id,
      name: b.name,
      department: b.parentId ? (unitName.get(b.parentId) ?? null) : null,
      current: members.length - graduated.length,
      graduated: graduated.length,
      graduation: record ? { id: record.id, graduatedAt: record.graduatedAt, by: name.get(record.byId) ?? null, canUndo: now.getTime() - record.graduatedAt.getTime() < GRADUATION_UNDO_DAYS * DAY } : null,
      alumniJoined: answers.filter((r) => r.alumniChoice === "joined").length,
      survey: {
        ...summary,
        // Too few answers and the averages would point to a person.
        averages: enough ? summary.averages : null,
        recommendPct: enough ? summary.recommendPct : null,
        // Sorted by their words, not by when they came in, so a comment can't be matched to a person by timing.
        comments: enough ? surveyed.map((r) => r.comment.trim()).filter(Boolean).sort((x, y) => x.localeCompare(y)) : [],
      },
    });
  }
  return {
    batches: out.sort((a, b) => b.current - a.current || a.name.localeCompare(b.name)),
    items: Object.entries(EXIT_ITEMS).map(([key, label]) => ({ key, label })),
    minResponses: EXIT_SURVEY_MIN_RESPONSES,
  };
}

/** What graduating a batch will do, before it's done. */
export async function graduationPreview(db: Db, auth: AuthContext, unitId: string) {
  const { units, batches } = await batchesInScope(db, auth);
  if (!batches.some((b) => b.id === unitId)) throw notFound("Batch");
  const current = (await batchMembers(db, auth.tenantId!, units, unitId)).filter((m) => !m.graduatedAt);
  const offers = await acceptedOffers(db, auth.tenantId!, current.map((m) => m.userId));
  const placed = new Set(offers.filter((o) => o.decision === "accepted").map((o) => o.userId));
  return {
    students: current.length,
    placed: placed.size,
    undecidedOffers: offers.filter((o) => o.decision === null).length,
    seatsFreed: new Set(current.map((m) => m.userId)).size,
  };
}

export async function graduateBatch(db: Db, auth: AuthContext, unitId: string, now: Date) {
  const tenantId = auth.tenantId!;
  const { units, batches } = await batchesInScope(db, auth);
  const batch = batches.find((b) => b.id === unitId);
  if (!batch) throw notFound("Batch");
  const current = (await batchMembers(db, tenantId, units, unitId)).filter((m) => !m.graduatedAt);
  if (!current.length) throw conflict("nobody", "Everyone in this batch has already graduated");
  const userIds = [...new Set(current.map((m) => m.userId))];
  await db.transaction(async (tx) => {
    await tx.update(memberships).set({ graduatedAt: now }).where(inArray(memberships.id, current.map((m) => m.id)));
    await tx.insert(batchGraduations).values({ tenantId, unitId, userIds, byId: auth.userId, graduatedAt: now });
    await tx
      .insert(graduateResponses)
      .values(userIds.map((userId) => ({ userId, tenantId, unitId, updatedAt: now })))
      .onConflictDoUpdate({ target: graduateResponses.userId, set: { unitId, updatedAt: now } });
  });
  await enqueue(
    db,
    userIds.map((userId) => ({
      tenantId,
      userId,
      template: "placement",
      title: "Congratulations on graduating",
      body: "Your account stays open to see and download your resume and records. Join the alumni list so juniors can ask you for advice, and tell us how training and placement went.",
      link: appLink("/play/graduated"),
      dedupeKey: `graduated:${unitId}:${userId}:${now.getTime()}`,
      sentBy: auth.userId,
    })),
  );
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId, actorId: auth.userId, action: "batch.graduate", target: unitId, data: { students: userIds.length } });
  return { graduated: userIds.length };
}

export async function undoGraduation(db: Db, auth: AuthContext, id: string, now: Date) {
  const tenantId = auth.tenantId!;
  const [r] = await db.select().from(batchGraduations).where(and(eq(batchGraduations.id, id), eq(batchGraduations.tenantId, tenantId), isNull(batchGraduations.undoneAt)));
  const { units, batches } = await batchesInScope(db, auth);
  if (!r || !batches.some((b) => b.id === r.unitId)) throw notFound("Graduation");
  if (now.getTime() - r.graduatedAt.getTime() >= GRADUATION_UNDO_DAYS * DAY) throw badRequest(`A graduation can be undone for ${GRADUATION_UNDO_DAYS} days`);
  const members = (await batchMembers(db, tenantId, units, r.unitId)).filter((m) => r.userIds.includes(m.userId) && m.graduatedAt?.getTime() === r.graduatedAt.getTime());
  await db.transaction(async (tx) => {
    if (members.length) await tx.update(memberships).set({ graduatedAt: null }).where(inArray(memberships.id, members.map((m) => m.id)));
    await tx.update(batchGraduations).set({ undoneAt: now }).where(eq(batchGraduations.id, r.id));
  });
  await audit(db, { tenantId, actorId: auth.userId, action: "batch.graduate.undo", target: r.unitId });
  return { restored: new Set(members.map((m) => m.userId)).size };
}

// ---------- Graduates ----------

async function loadGraduate(db: Db, ctx: Ctx) {
  const at = await graduatedAt(db, ctx.userId, ctx.tenantId);
  if (!at) throw badRequest("This is for students whose batch has graduated");
  return at;
}

async function prefill(db: Db, ctx: Ctx, at: Date) {
  const [[user], offers, [rec], unitIds, units] = await Promise.all([
    db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, ctx.userId)),
    acceptedOffers(db, ctx.tenantId, [ctx.userId]),
    db.select({ graduationYear: academicRecords.graduationYear }).from(academicRecords).where(eq(academicRecords.userId, ctx.userId)),
    studentUnitIdsWithAncestors(db, ctx.tenantId, ctx.userId),
    tenantUnits(db, ctx.tenantId),
  ]);
  const offer = offers.find((o) => o.decision === "accepted" && o.joiningStatus !== "revoked");
  const department = units.find((u) => unitIds.includes(u.id) && u.kind === "department")?.name ?? "";
  return {
    name: user!.name,
    email: user!.email,
    graduationYear: rec?.graduationYear ?? at.getUTCFullYear(),
    department,
    company: offer?.company ?? "",
    role: offer?.roleTitle ?? "",
    city: offer && !/pan india/i.test(offer.location) ? offer.location : "",
  };
}

export async function myGraduation(db: Db, ctx: Ctx) {
  const at = await graduatedAt(db, ctx.userId, ctx.tenantId);
  if (!at) return { graduated: null };
  const [[resp], [entry]] = await Promise.all([
    db.select().from(graduateResponses).where(eq(graduateResponses.userId, ctx.userId)),
    db.select().from(alumni).where(and(eq(alumni.tenantId, ctx.tenantId), eq(alumni.userId, ctx.userId))),
  ]);
  return {
    graduated: { at },
    alumni: {
      choice: resp?.alumniChoice ?? null,
      entry: entry?.active ? { email: entry.email, company: entry.company, role: entry.role, city: entry.city, openToReferrals: entry.openToReferrals, openToAdvice: entry.openToAdvice } : null,
      prefill: await prefill(db, ctx, at),
    },
    survey: {
      done: Boolean(resp?.surveyAt),
      items: Object.entries(EXIT_ITEMS).map(([key, label]) => ({ key, label })),
    },
  };
}

export interface AlumniInput {
  email: string;
  company: string;
  role: string;
  city: string;
  openToReferrals: boolean;
  openToAdvice: boolean;
}

/** Join (or update) the alumni list juniors browse, as yourself. */
export async function joinAlumni(db: Db, ctx: Ctx, input: AlumniInput) {
  const at = await loadGraduate(db, ctx);
  if (!input.company.trim()) throw badRequest("Say where you work or study now");
  if (!input.openToAdvice && !input.openToReferrals) throw badRequest("Choose advice, referrals or both, so juniors know what to ask");
  const p = await prefill(db, ctx, at);
  const values = { email: input.email.trim().toLowerCase(), company: input.company.trim(), role: input.role.trim(), city: input.city.trim(), openToReferrals: input.openToReferrals, openToAdvice: input.openToAdvice, active: true };
  const [existing] = await db.select().from(alumni).where(and(eq(alumni.tenantId, ctx.tenantId), eq(alumni.userId, ctx.userId)));
  if (existing) await db.update(alumni).set(values).where(eq(alumni.id, existing.id));
  else await db.insert(alumni).values({ tenantId: ctx.tenantId, userId: ctx.userId, name: p.name, graduationYear: p.graduationYear, department: p.department, ...values, createdAt: ctx.now });
  await setChoice(db, ctx, "joined");
  return myGraduation(db, ctx);
}

/** Not now, or leave the list: juniors stop seeing them; introductions already sent stay sent. */
export async function declineAlumni(db: Db, ctx: Ctx) {
  await loadGraduate(db, ctx);
  await db.update(alumni).set({ active: false }).where(and(eq(alumni.tenantId, ctx.tenantId), eq(alumni.userId, ctx.userId)));
  await setChoice(db, ctx, "declined");
  return myGraduation(db, ctx);
}

async function setChoice(db: Db, ctx: Ctx, choice: "joined" | "declined") {
  await db
    .insert(graduateResponses)
    .values({ userId: ctx.userId, tenantId: ctx.tenantId, alumniChoice: choice, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: graduateResponses.userId, set: { alumniChoice: choice, updatedAt: ctx.now } });
}

export async function submitExitSurvey(db: Db, ctx: Ctx, input: { ratings: Record<ExitItem, number>; recommend: boolean; comment: string }) {
  await loadGraduate(db, ctx);
  const [resp] = await db.select().from(graduateResponses).where(eq(graduateResponses.userId, ctx.userId));
  if (resp?.surveyAt) throw conflict("answered", "You've already answered, thank you");
  const set = { ratings: input.ratings, recommend: input.recommend, comment: input.comment.trim(), surveyAt: ctx.now, updatedAt: ctx.now };
  await db
    .insert(graduateResponses)
    .values({ userId: ctx.userId, tenantId: ctx.tenantId, ...set })
    .onConflictDoUpdate({ target: graduateResponses.userId, set });
  return myGraduation(db, ctx);
}

/** For the accreditation report: exit survey answers given in a period, by students in scope. */
export async function exitSurveyStats(db: DbOrTx, tenantId: string, studentIds: Set<string>, from: Date, to: Date) {
  const rows = (await db.select().from(graduateResponses).where(and(eq(graduateResponses.tenantId, tenantId), isNotNull(graduateResponses.surveyAt)))).filter(
    (r) => studentIds.has(r.userId) && r.surveyAt! >= from && r.surveyAt! < to && r.ratings && r.recommend !== null,
  );
  const s = exitSummary(rows.map((r) => ({ ratings: r.ratings!, recommend: r.recommend! })));
  return rows.length >= EXIT_SURVEY_MIN_RESPONSES ? s : { responses: rows.length, averages: null, recommendPct: null };
}
