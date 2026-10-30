import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { RESUME_SECTIONS, resumeChecks, resumeScore, REVIEW_VERDICTS, type ResumeSection, type ReviewVerdict } from "@playcode/core";
import type { Db } from "../db/client";
import { resumeComments, resumeReviews, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { appLink, enqueue, processOutbox } from "./notifications";
import { resumeData, type ResumeData } from "./resume";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";

// A second pair of eyes on the resume before drives start. Checks run by
// themselves (a missing headline, projects without detail); a student can
// also ask for a review, and a faculty member or the placement cell comments
// section by section and says whether it's ready to send. Students tick off
// each comment as they fix it, and ask again when they're done.

type Ctx = { tenantId: string; userId: string; now: Date };
type Review = typeof resumeReviews.$inferSelect;
const DAY = 86_400_000;

/** The automatic checks on a resume, and its score. */
export function checksFor(r: ResumeData) {
  const checks = resumeChecks({
    headline: r.headline,
    about: r.about,
    links: r.links,
    academic: r.academic,
    projects: r.projects,
    internships: r.internships,
    certifications: r.certifications,
    skills: r.skills.length,
  });
  return { checks: checks.map((c) => ({ ...c, sectionLabel: RESUME_SECTIONS[c.section] })), score: resumeScore(checks) };
}

async function withComments(db: Db, r: Review) {
  const [comments, reviewer] = await Promise.all([
    db.select().from(resumeComments).where(eq(resumeComments.reviewId, r.id)).orderBy(asc(resumeComments.createdAt)),
    r.reviewerId ? db.select({ name: users.name }).from(users).where(eq(users.id, r.reviewerId)) : [],
  ]);
  return {
    id: r.id,
    status: r.status,
    note: r.note,
    requestedAt: r.requestedAt,
    verdict: r.verdict,
    verdictLabel: r.verdict ? REVIEW_VERDICTS[r.verdict] : null,
    summary: r.summary,
    reviewedAt: r.reviewedAt,
    reviewer: reviewer[0]?.name ?? null,
    comments: comments.map((c) => ({ id: c.id, section: c.section, sectionLabel: RESUME_SECTIONS[c.section], body: c.body, resolved: c.resolved })),
  };
}

// ---------- Students ----------

/** The latest review (waiting or done), with how many there have been. */
export async function myReview(db: Db, ctx: Ctx) {
  const rows = await db
    .select()
    .from(resumeReviews)
    .where(and(eq(resumeReviews.tenantId, ctx.tenantId), eq(resumeReviews.userId, ctx.userId), inArray(resumeReviews.status, ["waiting", "reviewed"])))
    .orderBy(desc(resumeReviews.requestedAt));
  return { review: rows[0] ? await withComments(db, rows[0]) : null, reviews: rows.length };
}

export async function requestReview(db: Db, ctx: Ctx, note: string) {
  const [waiting] = await db.select({ id: resumeReviews.id }).from(resumeReviews).where(and(eq(resumeReviews.userId, ctx.userId), eq(resumeReviews.status, "waiting")));
  if (waiting) throw conflict("waiting", "Your resume is already waiting for a review");
  const { checks } = checksFor(await resumeData(db, ctx.userId, ctx.now));
  const fixes = checks.filter((c) => c.level === "fix");
  if (fixes.length) throw badRequest(`Fix these first, so the reviewer can spend their time on the rest: ${fixes.map((f) => f.sectionLabel.toLowerCase()).join(", ")}`);
  await db.insert(resumeReviews).values({ tenantId: ctx.tenantId, userId: ctx.userId, note: note.trim(), requestedAt: ctx.now });
  return myReview(db, ctx);
}

export async function withdrawReview(db: Db, ctx: Ctx) {
  const [w] = await db.select().from(resumeReviews).where(and(eq(resumeReviews.userId, ctx.userId), eq(resumeReviews.status, "waiting")));
  if (!w) throw notFound("Review request");
  await db.update(resumeReviews).set({ status: "withdrawn" }).where(eq(resumeReviews.id, w.id));
  return myReview(db, ctx);
}

export async function resolveComment(db: Db, ctx: Ctx, commentId: string, resolved: boolean) {
  const [c] = await db
    .select({ id: resumeComments.id, userId: resumeReviews.userId })
    .from(resumeComments)
    .innerJoin(resumeReviews, eq(resumeReviews.id, resumeComments.reviewId))
    .where(eq(resumeComments.id, commentId));
  if (!c || c.userId !== ctx.userId) throw notFound("Comment");
  await db.update(resumeComments).set({ resolved }).where(eq(resumeComments.id, c.id));
  return myReview(db, ctx);
}

// ---------- Reviewers ----------

async function inScope(db: Db, auth: AuthContext) {
  return new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
}

export async function reviewQueue(db: Db, auth: AuthContext, status: "waiting" | "reviewed", now: Date) {
  const scope = await inScope(db, auth);
  const rows = (
    await db
      .select({ r: resumeReviews, name: users.name, rollNo: users.rollNo })
      .from(resumeReviews)
      .innerJoin(users, eq(users.id, resumeReviews.userId))
      .where(and(eq(resumeReviews.tenantId, auth.tenantId!), eq(resumeReviews.status, status)))
      .orderBy(status === "waiting" ? asc(resumeReviews.requestedAt) : desc(resumeReviews.reviewedAt))
  ).filter((x) => scope.has(x.r.userId));
  const waiting = status === "waiting" ? rows.length : (await db.select({ userId: resumeReviews.userId }).from(resumeReviews).where(and(eq(resumeReviews.tenantId, auth.tenantId!), eq(resumeReviews.status, "waiting")))).filter((x) => scope.has(x.userId)).length;
  return {
    waiting,
    reviews: rows.slice(0, 200).map(({ r, name, rollNo }) => ({
      id: r.id,
      student: { id: r.userId, name, rollNo },
      note: r.note,
      requestedAt: r.requestedAt,
      daysWaiting: Math.floor((now.getTime() - r.requestedAt.getTime()) / DAY),
      verdict: r.verdict,
      reviewedAt: r.reviewedAt,
    })),
  };
}

async function loadForReviewer(db: Db, auth: AuthContext, id: string) {
  const [r] = await db.select().from(resumeReviews).where(and(eq(resumeReviews.id, id), eq(resumeReviews.tenantId, auth.tenantId!)));
  if (!r || !(await inScope(db, auth)).has(r.userId)) throw notFound("Review");
  return r;
}

/** The review with the student's resume as it stands, its checks, and the earlier reviews. */
export async function reviewDetail(db: Db, auth: AuthContext, id: string, now: Date) {
  const r = await loadForReviewer(db, auth, id);
  const resume = await resumeData(db, r.userId, now);
  const earlier = await db
    .select()
    .from(resumeReviews)
    .where(and(eq(resumeReviews.userId, r.userId), eq(resumeReviews.status, "reviewed")))
    .orderBy(desc(resumeReviews.reviewedAt));
  return {
    review: await withComments(db, r),
    studentId: r.userId,
    resume,
    ...checksFor(resume),
    earlier: await Promise.all(earlier.filter((e) => e.id !== r.id).map((e) => withComments(db, e))),
  };
}

export interface ReviewInput {
  verdict: ReviewVerdict;
  summary: string;
  comments: { section: ResumeSection; body: string }[];
}

export async function submitReview(db: Db, auth: AuthContext, id: string, input: ReviewInput, now: Date) {
  const r = await loadForReviewer(db, auth, id);
  if (r.status !== "waiting") throw badRequest("This review is done");
  const comments = input.comments.map((c) => ({ ...c, body: c.body.trim() })).filter((c) => c.body);
  if (input.verdict === "changes" && !comments.length && !input.summary.trim()) throw badRequest("Say what needs to change");
  await db.transaction(async (tx) => {
    if (comments.length) await tx.insert(resumeComments).values(comments.map((c, i) => ({ reviewId: r.id, section: c.section, body: c.body, createdAt: new Date(now.getTime() + i) })));
    await tx.update(resumeReviews).set({ status: "reviewed", verdict: input.verdict, summary: input.summary.trim(), reviewerId: auth.userId, reviewedAt: now }).where(eq(resumeReviews.id, r.id));
  });
  await enqueue(db, [
    {
      tenantId: r.tenantId,
      userId: r.userId,
      template: "placement",
      title: input.verdict === "ready" ? "Your resume is ready to send" : `Your resume review: ${comments.length} thing${comments.length === 1 ? "" : "s"} to change`,
      body: input.summary.trim().slice(0, 160) || (input.verdict === "ready" ? "Good work." : "See the comments on your resume page."),
      link: appLink("/play/resume"),
      dedupeKey: `resume-review:${r.id}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: r.tenantId, actorId: auth.userId, action: "resume.review", target: r.userId, data: { verdict: input.verdict, comments: comments.length } });
  return reviewDetail(db, auth, r.id, now);
}

/** For the data export: every review with its comments. */
export async function reviewsForExport(db: Db, userId: string) {
  const rows = await db.select().from(resumeReviews).where(eq(resumeReviews.userId, userId)).orderBy(asc(resumeReviews.requestedAt));
  return Promise.all(rows.map((r) => withComments(db, r)));
}
