import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { interviewExperiences, placementApplications, placementDrives, users, type ExperienceRound } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { getTenant, tenantToday } from "./tenant";

// Interview experiences: after a drive, students who took part write up each
// round (what happened, what was asked) and their tips, the way seniors pass
// it on in a hostel corridor. The placement cell reads each one before it is
// published, so nothing goes out that breaks a company's confidentiality rules
// or names someone. Students can post anonymously; staff still see who wrote it.

type Ctx = { tenantId: string; userId: string; now: Date };
type Row = typeof interviewExperiences.$inferSelect;
export type Result = Row["result"];

export interface ExperienceInput {
  result: Result;
  difficulty: number;
  rounds: ExperienceRound[];
  tips: string;
  anonymous: boolean;
}

const view = (e: Row, drive: typeof placementDrives.$inferSelect, author: string | null) => ({
  id: e.id,
  driveId: drive.id,
  company: drive.company,
  roleTitle: drive.roleTitle,
  driveDate: drive.driveDate,
  result: e.result,
  difficulty: e.difficulty,
  rounds: e.rounds,
  tips: e.tips,
  author,
  publishedAt: e.publishedAt,
});

/** Drives the student took part in that have happened, with what they've written so far. */
export async function experienceOptions(db: Db, ctx: Ctx) {
  const today = tenantToday(await getTenant(db, ctx.tenantId), ctx.now);
  const rows = await db
    .select({ drive: placementDrives, status: placementApplications.status })
    .from(placementApplications)
    .innerJoin(placementDrives, eq(placementDrives.id, placementApplications.driveId))
    .where(and(eq(placementApplications.userId, ctx.userId), eq(placementApplications.tenantId, ctx.tenantId), ne(placementApplications.status, "withdrawn")));
  const mine = await db.select().from(interviewExperiences).where(eq(interviewExperiences.userId, ctx.userId));
  return {
    drives: rows
      .filter((r) => r.drive.driveDate <= today)
      .sort((a, b) => b.drive.driveDate.localeCompare(a.drive.driveDate))
      .map(({ drive, status }) => {
        const e = mine.find((x) => x.driveId === drive.id);
        return {
          driveId: drive.id,
          company: drive.company,
          roleTitle: drive.roleTitle,
          driveDate: drive.driveDate,
          rounds: drive.rounds,
          applicationStatus: status,
          experience: e ? { status: e.status, reviewNote: e.reviewNote, result: e.result, difficulty: e.difficulty, rounds: e.rounds, tips: e.tips, anonymous: e.anonymous } : null,
        };
      }),
  };
}

export async function submitExperience(db: Db, ctx: Ctx, driveId: string, input: ExperienceInput) {
  const [drive] = await db.select().from(placementDrives).where(and(eq(placementDrives.id, driveId), eq(placementDrives.tenantId, ctx.tenantId)));
  if (!drive) throw notFound("Placement drive");
  const [app] = await db.select().from(placementApplications).where(and(eq(placementApplications.driveId, driveId), eq(placementApplications.userId, ctx.userId)));
  if (!app || app.status === "withdrawn") throw forbidden("Only students who took part in this drive can write about it");
  if (drive.driveDate > tenantToday(await getTenant(db, ctx.tenantId), ctx.now)) throw conflict("drive_not_held", "Write about the drive once it has happened");
  const rounds = input.rounds.filter((r) => r.description.trim());
  if (!rounds.length) throw badRequest("Describe at least one round");
  if (rounds.some((r) => !drive.rounds.includes(r.name))) throw badRequest("Pick rounds from this drive");
  const values = { result: input.result, difficulty: input.difficulty, rounds, tips: input.tips.trim(), anonymous: input.anonymous, status: "pending" as const, reviewNote: null, reviewedBy: null, publishedAt: null, updatedAt: ctx.now };
  // Editing a published write-up sends it back for review.
  await db
    .insert(interviewExperiences)
    .values({ tenantId: ctx.tenantId, driveId, userId: ctx.userId, ...values, createdAt: ctx.now })
    .onConflictDoUpdate({ target: [interviewExperiences.driveId, interviewExperiences.userId], set: values });
  return experienceOptions(db, ctx);
}

/** Published experiences in the institution, by company, newest first. */
export async function readExperiences(db: Db, tenantId: string, company?: string) {
  const rows = await db
    .select({ e: interviewExperiences, drive: placementDrives, name: users.name })
    .from(interviewExperiences)
    .innerJoin(placementDrives, eq(placementDrives.id, interviewExperiences.driveId))
    .innerJoin(users, eq(users.id, interviewExperiences.userId))
    .where(and(eq(interviewExperiences.tenantId, tenantId), eq(interviewExperiences.status, "published")))
    .orderBy(desc(placementDrives.driveDate), desc(interviewExperiences.publishedAt));
  const wanted = company?.trim().toLowerCase();
  const byCompany = new Map<string, ReturnType<typeof view>[]>();
  for (const r of rows) {
    if (wanted && r.drive.company.toLowerCase() !== wanted) continue;
    byCompany.set(r.drive.company, [...(byCompany.get(r.drive.company) ?? []), view(r.e, r.drive, r.e.anonymous ? null : r.name)]);
  }
  return {
    companies: [...byCompany].map(([name, list]) => ({
      company: name,
      count: list.length,
      averageDifficulty: Math.round((list.reduce((n, e) => n + e.difficulty, 0) / list.length) * 10) / 10,
      selected: list.filter((e) => e.result === "selected").length,
      experiences: list,
    })),
  };
}

/** How many published experiences each company has, for the drive cards. */
export async function experienceCounts(db: Db, tenantId: string) {
  const rows = await db
    .select({ company: placementDrives.company })
    .from(interviewExperiences)
    .innerJoin(placementDrives, eq(placementDrives.id, interviewExperiences.driveId))
    .where(and(eq(interviewExperiences.tenantId, tenantId), eq(interviewExperiences.status, "published")));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.company.toLowerCase()] = (counts[r.company.toLowerCase()] ?? 0) + 1;
  return { counts };
}

// ---------- Placement cell ----------

export async function reviewQueue(db: Db, tenantId: string, status: Row["status"]) {
  const rows = await db
    .select({ e: interviewExperiences, drive: placementDrives, name: users.name, rollNo: users.rollNo })
    .from(interviewExperiences)
    .innerJoin(placementDrives, eq(placementDrives.id, interviewExperiences.driveId))
    .innerJoin(users, eq(users.id, interviewExperiences.userId))
    .where(and(eq(interviewExperiences.tenantId, tenantId), eq(interviewExperiences.status, status)))
    .orderBy(desc(interviewExperiences.updatedAt))
    .limit(200);
  return { experiences: rows.map((r) => ({ ...view(r.e, r.drive, r.name), rollNo: r.rollNo, anonymous: r.e.anonymous, status: r.e.status, reviewNote: r.e.reviewNote, updatedAt: r.e.updatedAt })) };
}

export async function reviewExperience(db: Db, auth: { tenantId: string; userId: string }, id: string, decision: { publish: boolean; note: string | null }, now: Date) {
  const [e] = await db.select().from(interviewExperiences).where(and(eq(interviewExperiences.id, id), eq(interviewExperiences.tenantId, auth.tenantId)));
  if (!e) throw notFound("Interview experience");
  if (!decision.publish && !decision.note?.trim()) throw badRequest("Tell the student what to change");
  const [drive] = await db.select().from(placementDrives).where(eq(placementDrives.id, e.driveId));
  await db
    .update(interviewExperiences)
    .set(decision.publish ? { status: "published", reviewNote: null, reviewedBy: auth.userId, publishedAt: now } : { status: "rejected", reviewNote: decision.note!.trim(), reviewedBy: auth.userId, publishedAt: null })
    .where(eq(interviewExperiences.id, e.id));
  await enqueue(db, [
    {
      tenantId: e.tenantId,
      userId: e.userId,
      template: "placement",
      title: decision.publish ? `Your ${drive!.company} interview experience is live` : `Please revise your ${drive!.company} interview experience`,
      body: decision.publish ? "Thank you: juniors and batchmates can read it now." : decision.note!.trim(),
      link: appLink("/play/experiences?write=1"),
      // One message per decision on each version, so a later change of mind still reaches the author.
      dedupeKey: `experience:${e.id}:${e.updatedAt.getTime()}:${decision.publish ? "live" : "revise"}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: auth.tenantId, actorId: auth.userId, action: decision.publish ? "experience.publish" : "experience.reject", target: e.id });
  return { ok: true };
}

/** Counts per status, for the console badge. */
export async function pendingCount(db: Db, tenantId: string) {
  const rows = await db.select({ id: interviewExperiences.id }).from(interviewExperiences).where(and(eq(interviewExperiences.tenantId, tenantId), inArray(interviewExperiences.status, ["pending"])));
  return { pending: rows.length };
}
