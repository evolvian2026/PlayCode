import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { ITEM_FLAG_LABELS, itemFlags, itemStats, QUESTION_TYPE_LABELS, type ItemFlag } from "@playcode/core";
import type { Db } from "../db/client";
import { questionReports, questions, responses, tenants, type ReportReason } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { createQuestion, runCheck, setStatus, type Bank, type StudioInput } from "./studio";

// Keeping a large question bank correct: bulk import for the content team
// (every question checked as in the studio), reports from students, and item
// analysis that flags questions whose numbers suggest a flaw. Flagged and
// reported questions make up the review queue.

const DAY_MS = 86_400_000;
/** Item analysis looks at the last six months of first attempts. */
const WINDOW_DAYS = 180;

const bankWhere = (bank: Bank) => (bank.tenantId ? eq(questions.tenantId, bank.tenantId) : isNull(questions.tenantId));

// ---------- Bulk import ----------

export interface ImportResult {
  index: number;
  id: string | null;
  ok: boolean;
  problems: string[];
}

/** Save each question as a draft and run its check. Invalid items are reported by position, not saved. */
export async function importQuestions(db: Db, bank: Bank, actorId: string, items: ({ input: StudioInput } | { error: string[] })[], now: Date) {
  const results: ImportResult[] = [];
  for (const [index, item] of items.entries()) {
    if ("error" in item) {
      results.push({ index, id: null, ok: false, problems: item.error });
      continue;
    }
    try {
      const q = await createQuestion(db, bank, actorId, { ...item.input, origin: "studio" }, now);
      const check = await runCheck(db, bank, q.id, now);
      results.push({ index, id: q.id, ok: check.ok, problems: check.problems });
    } catch (err) {
      results.push({ index, id: null, ok: false, problems: [(err as Error).message] });
    }
  }
  await audit(db, { tenantId: bank.tenantId, actorId, action: "content.import", data: { total: items.length, saved: results.filter((r) => r.id).length, passed: results.filter((r) => r.ok).length } });
  return { results, saved: results.filter((r) => r.id).length, passed: results.filter((r) => r.ok).length };
}

/** Publish the given drafts; each must pass its check. */
export async function publishMany(db: Db, bank: Bank, actorId: string, ids: string[], now: Date) {
  const published: string[] = [];
  const failed: { id: string; problem: string }[] = [];
  for (const id of ids) {
    try {
      await setStatus(db, bank, actorId, id, "live", now);
      published.push(id);
    } catch (err) {
      failed.push({ id, problem: (err as Error).message });
    }
  }
  return { published, failed };
}

// ---------- Student reports ----------

export async function reportQuestion(db: Db, ctx: { userId: string; tenantId: string; now: Date }, questionId: string, reason: ReportReason, note: string) {
  const [q] = await db.select({ id: questions.id, version: questions.version, tenantId: questions.tenantId }).from(questions).where(eq(questions.id, questionId));
  if (!q || (q.tenantId && q.tenantId !== ctx.tenantId)) throw notFound("Question");
  // Only questions the student has actually been given can be reported.
  const [seen] = await db.select({ id: responses.id }).from(responses).where(and(eq(responses.userId, ctx.userId), eq(responses.questionId, questionId))).limit(1);
  if (!seen) throw badRequest("Answer the question first, then report it if something is wrong");
  const [open] = await db
    .select({ id: questionReports.id })
    .from(questionReports)
    .where(and(eq(questionReports.userId, ctx.userId), eq(questionReports.questionId, questionId), eq(questionReports.status, "open")));
  if (open) throw conflict("already_reported", "You have already reported this question. Thank you; the content team will look at it.");
  await db.insert(questionReports).values({ questionId, questionVersion: q.version, userId: ctx.userId, tenantId: ctx.tenantId, reason, note, createdAt: ctx.now });
}

export async function resolveReports(db: Db, bank: Bank, actorId: string, questionId: string, status: "resolved" | "dismissed", resolution: string, now: Date) {
  const [q] = await db.select({ id: questions.id }).from(questions).where(and(eq(questions.id, questionId), bankWhere(bank)));
  if (!q) throw notFound("Question");
  const rows = await db
    .update(questionReports)
    .set({ status, resolution, resolvedBy: actorId, resolvedAt: now })
    .where(and(eq(questionReports.questionId, questionId), eq(questionReports.status, "open")))
    .returning({ id: questionReports.id });
  await audit(db, { tenantId: bank.tenantId, actorId, action: `content.reports_${status}`, target: questionId, data: { reports: rows.length } });
  return { updated: rows.length };
}

// ---------- Item analysis and the review queue ----------

export async function reviewQueue(db: Db, bank: Bank, now: Date) {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const bankQuestions = await db.select().from(questions).where(and(bankWhere(bank), eq(questions.status, "live")));
  const ids = bankQuestions.map((q) => q.id);
  if (ids.length === 0) return { questions: [], analysed: 0 };

  // Each student's first attempt at each question in the bank.
  const first = await db.execute<{ question_id: string; user_id: string; correct: boolean; option_id: string | null }>(sql`
    select distinct on (question_id, user_id) question_id, user_id, correct, response->>'optionId' as option_id
    from responses
    where question_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and created_at >= ${since}
    order by question_id, user_id, created_at`);
  // Ability: each student's accuracy over the window (their answer to the item itself barely moves it).
  const users = [...new Set(first.rows.map((r) => r.user_id))];
  const totals = users.length
    ? await db
        .select({ userId: responses.userId, n: sql<number>`count(*)::int`, correct: sql<number>`sum(case when ${responses.correct} then 1 else 0 end)::int` })
        .from(responses)
        .where(and(inArray(responses.userId, users), gte(responses.createdAt, since)))
        .groupBy(responses.userId)
    : [];
  const ability = new Map(totals.map((t) => [t.userId, t.n ? t.correct / t.n : 0]));
  const byQuestion = new Map<string, { userId: string; correct: boolean; optionId: string | null }[]>();
  for (const r of first.rows) (byQuestion.get(r.question_id) ?? byQuestion.set(r.question_id, []).get(r.question_id)!).push({ userId: r.user_id, correct: r.correct, optionId: r.option_id });

  const reports = await db.select().from(questionReports).where(and(inArray(questionReports.questionId, ids), eq(questionReports.status, "open"))).orderBy(desc(questionReports.createdAt));
  const tenantNames = new Map((await db.select({ id: tenants.id, name: tenants.name }).from(tenants)).map((t) => [t.id, t.name]));

  const severity: Record<ItemFlag, number> = { key_suspect: 6, negative_discrimination: 5, reported: 4, too_hard: 3, low_discrimination: 2, too_easy: 1 };
  const rows = bankQuestions
    .map((q) => {
      const attempts = byQuestion.get(q.id) ?? [];
      const keyed = q.answer.kind === "option" ? q.answer.optionId : null;
      const stats = itemStats(attempts, ability, keyed);
      const open = reports.filter((r) => r.questionId === q.id);
      const flags = itemFlags(stats, { difficulty: q.difficulty, openReports: open.length });
      return {
        id: q.id,
        stem: q.body.stem,
        type: q.type,
        typeLabel: QUESTION_TYPE_LABELS[q.type],
        skillId: q.skillId,
        difficulty: q.difficulty,
        stats: { ...stats, pValue: Math.round(stats.pValue * 100) / 100 },
        flags: flags.map((f) => ({ id: f, label: ITEM_FLAG_LABELS[f] })),
        score: flags.reduce((a, f) => a + severity[f], 0) + open.length,
        reports: open.map((r) => ({ id: r.id, reason: r.reason, note: r.note, version: r.questionVersion, staleVersion: r.questionVersion !== q.version, from: bank.tenantId ? null : (r.tenantId ? tenantNames.get(r.tenantId) ?? null : null), at: r.createdAt })),
      };
    })
    .filter((r) => r.flags.length > 0)
    .sort((a, b) => b.score - a.score);
  return { questions: rows, analysed: bankQuestions.filter((q) => (byQuestion.get(q.id)?.length ?? 0) > 0).length };
}
