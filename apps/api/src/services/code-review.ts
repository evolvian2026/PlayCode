import { and, count, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { codeReviews, questions, responses } from "../db/schema";
import { aiProvider, AiUnavailableError } from "../lib/ai";
import { badRequest, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { aiAllowed } from "./plan";
import type { StudentCtx } from "./practice";
import { getTenant } from "./tenant";

// AI code review: once a student's code passes every test, they can ask for
// the debrief an interviewer would give: complexity, a better approach if
// there is one, edge cases, readability, and a cleaner version. It sits with
// the AI coach (same plan feature and institution switch), and each accepted
// answer is reviewed at most once, so a review is never paid for twice.

export const REVIEWS_PER_DAY = 10;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function reviewMyCode(db: Db, ctx: StudentCtx, sessionId: string, questionId: string) {
  const provider = aiProvider();
  if (!provider || (await getTenant(db, ctx.tenantId)).settings.aiHints === false) throw badRequest("AI feedback is not switched on for your institution");
  const allowed = await aiAllowed(db, ctx.tenantId, "ai_coach", ctx.now);
  if (!allowed.ok) throw badRequest(allowed.reason);

  const [q] = await db.select().from(questions).where(eq(questions.id, questionId));
  if (!q) throw notFound("Question");
  if (q.type !== "write_code") throw badRequest("Code review is for coding problems");
  const [resp] = await db
    .select()
    .from(responses)
    .where(and(eq(responses.sessionId, sessionId), eq(responses.userId, ctx.userId), eq(responses.questionId, questionId), eq(responses.correct, true)))
    .orderBy(desc(responses.createdAt))
    .limit(1);
  if (!resp || resp.response.kind !== "code") throw notFound("An accepted solution to review");

  const [existing] = await db.select().from(codeReviews).where(eq(codeReviews.responseId, resp.id));
  if (existing) return { review: existing.review, language: resp.response.language };

  const [{ n }] = (await db.select({ n: count() }).from(codeReviews).where(and(eq(codeReviews.userId, ctx.userId), gte(codeReviews.createdAt, new Date(ctx.now.getTime() - 86_400_000))))) as [{ n: number }];
  if (n >= REVIEWS_PER_DAY) throw new HttpError(429, "review_daily_limit", `You've had ${REVIEWS_PER_DAY} code reviews today. Try again tomorrow.`);

  let res;
  try {
    res = await provider.reviewCode({
      stem: q.body.stem,
      language: resp.response.language,
      source: resp.response.source.slice(0, 12_000),
      reference: q.answer.kind === "tests" ? (q.answer.reference ?? null) : null,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof AiUnavailableError) throw new HttpError(502, "review_unavailable", err.message);
    throw new HttpError(503, "review_unavailable", "The reviewer is busy right now. Try again in a moment.");
  }
  await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "code_review", usage: res.usage, now: ctx.now });
  const r = res.value;
  const review = {
    summary: clip(r.summary, 600),
    timeComplexity: clip(r.timeComplexity, 80),
    spaceComplexity: clip(r.spaceComplexity, 80),
    betterApproach: r.betterApproach ? clip(r.betterApproach, 600) : null,
    edgeCases: r.edgeCases.slice(0, 3).map((x) => clip(x, 300)),
    readability: r.readability.slice(0, 3).map((x) => clip(x, 300)),
    improvedCode: r.improvedCode.slice(0, 12_000),
  };
  await db.insert(codeReviews).values({ responseId: resp.id, userId: ctx.userId, tenantId: ctx.tenantId, questionId, review, createdAt: ctx.now }).onConflictDoNothing();
  return { review, language: resp.response.language };
}
