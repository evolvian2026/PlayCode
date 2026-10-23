import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { dueForReview, masteryFromRating, REVIEW_MAX_SKILLS, REVIEW_PER_SKILL, START_RATING, hashString } from "@playcode/core";
import type { DbOrTx } from "../db/client";
import { questions, responses, skillRatings, skills } from "../db/schema";
import { quickVisibleTo } from "./practice";

// Spaced review sessions: a few quick questions from each skill that is due,
// interleaved. Skills whose only questions need code execution are left out
// (a review should take minutes, not a coding round).

const DAY_MS = 86_400_000;
/** Questions answered this recently are avoided in a review, so it tests memory, not the last session. */
const RECENT_DAYS = 7;

export async function reviewDue(db: DbOrTx, tenantId: string, userId: string, today: string) {
  const rows = await db
    .select({ skillId: skillRatings.skillId, rating: skillRatings.rating, step: skillRatings.reviewStep, dueOn: skillRatings.reviewDueOn, name: skills.name, topicName: skills.topicName })
    .from(skillRatings)
    .innerJoin(skills, eq(skills.id, skillRatings.skillId))
    .where(and(eq(skillRatings.userId, userId), isNotNull(skillRatings.reviewDueOn), lte(skillRatings.reviewDueOn, today)));
  if (rows.length === 0) return [];
  const withQuick = new Set(
    (
      await db
        .selectDistinct({ skillId: questions.skillId })
        .from(questions)
        .where(and(quickVisibleTo(tenantId), inArray(questions.skillId, rows.map((r) => r.skillId))))
    ).map((r) => r.skillId),
  );
  return dueForReview(
    rows.filter((r) => withQuick.has(r.skillId)).map((r) => ({ ...r, mastery: masteryFromRating(r.rating) })),
    today,
  );
}

/** Question ids for a review session, interleaved across the due skills. */
export async function pickReviewQuestions(db: DbOrTx, args: { tenantId: string; userId: string; today: string; now: Date }) {
  const due = (await reviewDue(db, args.tenantId, args.userId, args.today)).slice(0, REVIEW_MAX_SKILLS);
  if (due.length === 0) return { skills: [], questionIds: [] };
  const pool = await db
    .select({ id: questions.id, skillId: questions.skillId, rating: questions.rating })
    .from(questions)
    .where(and(quickVisibleTo(args.tenantId), inArray(questions.skillId, due.map((d) => d.skillId))));
  const recent = new Set(
    (
      await db
        .selectDistinct({ questionId: responses.questionId })
        .from(responses)
        .where(and(eq(responses.userId, args.userId), gte(responses.createdAt, new Date(args.now.getTime() - RECENT_DAYS * DAY_MS))))
    ).map((r) => r.questionId),
  );
  const perSkill = due.map((d) => {
    const target = d.rating ?? START_RATING;
    return pool
      .filter((q) => q.skillId === d.skillId)
      .sort(
        (a, b) =>
          Number(recent.has(a.id)) - Number(recent.has(b.id)) ||
          Math.abs(a.rating - target) - Math.abs(b.rating - target) ||
          hashString(`${args.userId}:${args.today}:${a.id}`) - hashString(`${args.userId}:${args.today}:${b.id}`),
      )
      .slice(0, REVIEW_PER_SKILL)
      .map((q) => q.id);
  });
  // Interleave: one from each skill, then the second from each.
  const questionIds: string[] = [];
  for (let i = 0; i < REVIEW_PER_SKILL; i++) for (const ids of perSkill) if (ids[i]) questionIds.push(ids[i]!);
  return { skills: due.map((d) => d.skillId), questionIds };
}
