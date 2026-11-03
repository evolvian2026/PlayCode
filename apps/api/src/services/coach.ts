import { and, count, eq, gte } from "drizzle-orm";
import { describeAnswer, EXECUTION_TYPES, normalizeText, QUESTION_TYPE_LABELS } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { aiUsage, coachHintCache, coachHints, questions, sessions, type AiFeature } from "../db/schema";
import { AI_MODEL, aiProvider, AiUnavailableError, type AiUsage } from "../lib/ai";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import type { StudentCtx } from "./practice";
import { getTenant } from "./tenant";
import { aiAllowed } from "./plan";

// The AI coach: when the written hints are not enough, a student can ask for
// a hint tailored to the question (and, for code, to their own attempt).
// Coach hints cost XP like written hints, so they are not free answers.

export const COACH_PER_QUESTION = 3;
export const COACH_PER_DAY = 25;

export async function recordAiUsage(db: DbOrTx, entry: { tenantId: string | null; userId: string | null; feature: AiFeature; usage: AiUsage; now?: Date }) {
  await db.insert(aiUsage).values({
    tenantId: entry.tenantId,
    userId: entry.userId,
    feature: entry.feature,
    model: AI_MODEL,
    inputTokens: entry.usage.inputTokens,
    outputTokens: entry.usage.outputTokens,
    cacheReadTokens: entry.usage.cacheReadTokens,
    ...(entry.now ? { createdAt: entry.now } : {}),
  });
}

export async function coachAvailable(db: DbOrTx, tenantId: string, now = new Date()): Promise<boolean> {
  if (!aiProvider()) return false;
  if ((await getTenant(db, tenantId)).settings.aiHints === false) return false;
  return (await aiAllowed(db, tenantId, "ai_coach", now)).ok;
}

/** A hint gives the answer away if it contains an accepted answer or the right option's text. */
function leaksAnswer(hint: string, q: typeof questions.$inferSelect): boolean {
  const text = normalizeText(hint);
  const secrets =
    q.answer.kind === "text"
      ? q.answer.accepted
      : q.answer.kind === "option"
        ? [q.body.options?.find((o) => o.id === (q.answer as { optionId: string }).optionId)?.text ?? ""]
        : [];
  return secrets.some((s) => s.trim().length >= 3 && text.includes(normalizeText(s)));
}

export async function coachHint(db: Db, ctx: StudentCtx, sessionId: string, input: { questionId: string; draft?: string }) {
  const provider = aiProvider();
  if (!provider || (await getTenant(db, ctx.tenantId)).settings.aiHints === false) throw badRequest("The AI coach is not switched on for your institution");
  const allowed = await aiAllowed(db, ctx.tenantId, "ai_coach", ctx.now);
  if (!allowed.ok) throw badRequest(allowed.reason);

  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!s || s.userId !== ctx.userId) throw notFound("Session");
  if (s.finishedAt || s.questionIds[s.currentIndex] !== input.questionId) throw conflict("not_current", "That question is not the current one");
  const [q] = await db.select().from(questions).where(eq(questions.id, input.questionId));
  if (!q) throw notFound("Question");

  const coachKey = `coach:${q.id}`;
  const level = s.hintsUsed[coachKey] ?? 0;
  if (level >= COACH_PER_QUESTION) throw conflict("coach_limit", "That's all the coaching for this question. Give it your best try!");
  const since = new Date(ctx.now.getTime() - 86_400_000);
  const [{ n }] = (await db.select({ n: count() }).from(coachHints).where(and(eq(coachHints.userId, ctx.userId), gte(coachHints.createdAt, since)))) as [{ n: number }];
  if (n >= COACH_PER_DAY) throw new HttpError(429, "coach_daily_limit", `You have used all ${COACH_PER_DAY} coach hints for today. Written hints are still available.`);

  const shownWritten = q.hints.slice(0, s.hintsUsed[q.id] ?? 0);
  const earlierCoach = (
    await db
      .select({ hint: coachHints.hint })
      .from(coachHints)
      .where(and(eq(coachHints.sessionId, s.id), eq(coachHints.questionId, q.id)))
      .orderBy(coachHints.level)
  ).map((r) => r.hint);
  const draft = EXECUTION_TYPES.includes(q.type) && input.draft?.trim() ? input.draft.slice(0, 8000) : undefined;

  // Hints that don't depend on the student's own code are shared across students.
  let hint: string | undefined;
  let cached = false;
  if (!draft && shownWritten.length === 0) {
    const [hit] = await db
      .select()
      .from(coachHintCache)
      .where(and(eq(coachHintCache.questionId, q.id), eq(coachHintCache.version, q.version), eq(coachHintCache.level, level)));
    if (hit) {
      hint = hit.hint;
      cached = true;
    }
  }
  if (!hint) {
    const ask = () =>
      provider.coachHint({
        typeLabel: QUESTION_TYPE_LABELS[q.type],
        language: q.language,
        stem: q.body.stem,
        code: q.body.code,
        options: q.body.options?.map((o) => ({ id: o.id, text: o.text })),
        answer: describeAnswer(q),
        explanation: q.explanation,
        previousHints: [...shownWritten, ...earlierCoach],
        draft: draft ? { source: draft } : undefined,
      });
    try {
      for (let attempt = 0; attempt < 2 && !hint; attempt++) {
        const res = await ask();
        await recordAiUsage(db, { tenantId: ctx.tenantId, userId: ctx.userId, feature: "coach_hint", usage: res.usage, now: ctx.now });
        if (!leaksAnswer(res.value, q)) hint = res.value;
      }
    } catch (err) {
      if (err instanceof AiUnavailableError) throw new HttpError(502, "coach_unavailable", err.message);
      throw new HttpError(503, "coach_unavailable", "The coach is busy right now. Try again in a moment, or use a written hint.");
    }
    if (!hint) throw new HttpError(502, "coach_unavailable", "The coach could not find a hint that doesn't give the answer away. Try a written hint.");
    if (!draft && shownWritten.length === 0) {
      await db.insert(coachHintCache).values({ questionId: q.id, version: q.version, level, hint }).onConflictDoNothing();
    }
  }

  // Record it against the session (so it costs XP like a written hint), unless the student moved on meanwhile.
  return db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(sessions).where(eq(sessions.id, s.id)).for("update");
    if (!fresh || fresh.finishedAt || fresh.questionIds[fresh.currentIndex] !== q.id) throw conflict("not_current", "That question is not the current one");
    const used = (fresh.hintsUsed[coachKey] ?? 0) + 1;
    await tx.update(sessions).set({ hintsUsed: { ...fresh.hintsUsed, [coachKey]: used } }).where(eq(sessions.id, s.id));
    await tx.insert(coachHints).values({ tenantId: ctx.tenantId, userId: ctx.userId, sessionId: s.id, questionId: q.id, level, hint: hint!, cached, createdAt: ctx.now });
    return { hint: hint!, coachUsed: used, coachLeft: COACH_PER_QUESTION - used };
  });
}
