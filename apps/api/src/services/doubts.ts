import { and, desc, eq, inArray } from "drizzle-orm";
import { describeAnswer } from "@playcode/core";
import type { Db } from "../db/client";
import { doubts, questions, responses, users } from "../db/schema";
import { audit } from "../lib/audit";
import { conflict, forbidden, notFound } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { appLink, enqueue, processOutbox } from "./notifications";
import { scopedUnitIds, studentIdsInUnits, type AuthContext } from "./scope";

// Doubts: a student stuck on a question they've answered asks their teachers.
// The question goes to staff whose scope includes the student; the answer
// comes back as a notification. An answer marked "shared" is shown without
// names to the institution's other students, but only once they have answered
// that question too, so it never gives an answer away.

const PER_DAY = 10;
type Ctx = { tenantId: string; userId: string; now: Date };
type Doubt = typeof doubts.$inferSelect;

async function hasAnswered(db: Db, userId: string, questionId: string) {
  const [r] = await db.select({ id: responses.id }).from(responses).where(and(eq(responses.userId, userId), eq(responses.questionId, questionId))).limit(1);
  return Boolean(r);
}

const mine = (d: Doubt) => ({ id: d.id, questionId: d.questionId, text: d.text, status: d.status, answer: d.answer, answeredAt: d.answeredAt, createdAt: d.createdAt });

export async function askDoubt(db: Db, ctx: Ctx, questionId: string, text: string) {
  if (!(await hasAnswered(db, ctx.userId, questionId))) throw forbidden("Answer the question first, then ask about it");
  await rateLimit(`doubt:${ctx.userId}`, PER_DAY, 86_400_000, ctx.now, "You've asked a lot of doubts today");
  const [d] = await db.insert(doubts).values({ tenantId: ctx.tenantId, userId: ctx.userId, questionId, text, createdAt: ctx.now }).returning();
  return mine(d!);
}

/** On one question: the student's own doubts, and shared answers to others'. */
export async function doubtsOnQuestion(db: Db, ctx: Ctx, questionId: string) {
  if (!(await hasAnswered(db, ctx.userId, questionId))) throw forbidden("Answer the question first");
  const rows = await db
    .select()
    .from(doubts)
    .where(and(eq(doubts.tenantId, ctx.tenantId), eq(doubts.questionId, questionId)))
    .orderBy(desc(doubts.createdAt))
    .limit(50);
  return {
    mine: rows.filter((d) => d.userId === ctx.userId).map(mine),
    shared: rows.filter((d) => d.userId !== ctx.userId && d.shared && d.status === "answered").map((d) => ({ id: d.id, text: d.text, answer: d.answer, answeredAt: d.answeredAt })),
  };
}

export async function myDoubts(db: Db, ctx: Ctx) {
  const rows = await db
    .select({ d: doubts, stem: questions.body })
    .from(doubts)
    .innerJoin(questions, eq(questions.id, doubts.questionId))
    .where(eq(doubts.userId, ctx.userId))
    .orderBy(desc(doubts.createdAt))
    .limit(100);
  return { doubts: rows.map((r) => ({ ...mine(r.d), stem: r.stem.stem })) };
}

/** Students the staff member may answer for. */
async function studentsInScope(db: Db, auth: AuthContext) {
  return new Set(await studentIdsInUnits(db, auth.tenantId!, await scopedUnitIds(db, auth)));
}

export async function staffDoubts(db: Db, auth: AuthContext, status: "open" | "answered" | "closed") {
  const scope = await studentsInScope(db, auth);
  const rows = (
    await db
      .select({ d: doubts, q: questions, name: users.name, rollNo: users.rollNo })
      .from(doubts)
      .innerJoin(questions, eq(questions.id, doubts.questionId))
      .innerJoin(users, eq(users.id, doubts.userId))
      .where(and(eq(doubts.tenantId, auth.tenantId!), eq(doubts.status, status)))
      .orderBy(status === "open" ? doubts.createdAt : desc(doubts.answeredAt))
      .limit(500)
  ).filter((r) => scope.has(r.d.userId));
  // What the student answered, so the teacher can see where they went wrong.
  const theirs = rows.length
    ? await db
        .select({ userId: responses.userId, questionId: responses.questionId, response: responses.response, correct: responses.correct, at: responses.createdAt })
        .from(responses)
        .where(and(inArray(responses.userId, [...new Set(rows.map((r) => r.d.userId))]), inArray(responses.questionId, [...new Set(rows.map((r) => r.d.questionId))])))
        .orderBy(desc(responses.createdAt))
    : [];
  return {
    doubts: rows.slice(0, 200).map(({ d, q, name, rollNo }) => {
      const last = theirs.find((x) => x.userId === d.userId && x.questionId === d.questionId);
      return {
        id: d.id,
        student: { id: d.userId, name, rollNo },
        question: { id: q.id, type: q.type, stem: q.body.stem, code: q.body.code ?? null, options: q.body.options ?? null, correctAnswer: describeAnswer(q), explanation: q.explanation },
        lastAnswer: last ? { response: last.response, correct: last.correct } : null,
        text: d.text,
        status: d.status,
        answer: d.answer,
        shared: d.shared,
        createdAt: d.createdAt,
        answeredAt: d.answeredAt,
      };
    }),
    openCount: status === "open" ? rows.length : undefined,
  };
}

async function loadForStaff(db: Db, auth: AuthContext, id: string) {
  const [d] = await db.select().from(doubts).where(and(eq(doubts.id, id), eq(doubts.tenantId, auth.tenantId!)));
  if (!d || !(await studentsInScope(db, auth)).has(d.userId)) throw notFound("Doubt");
  return d;
}

export async function answerDoubt(db: Db, auth: AuthContext, id: string, input: { answer: string; shared: boolean }, now: Date) {
  const d = await loadForStaff(db, auth, id);
  if (d.status === "closed") throw conflict("doubt_closed", "This doubt was closed");
  const [updated] = await db
    .update(doubts)
    .set({ status: "answered", answer: input.answer, shared: input.shared, answeredBy: auth.userId, answeredAt: now })
    .where(eq(doubts.id, d.id))
    .returning();
  const [staff] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
  // An edited answer doesn't notify twice.
  await enqueue(db, [
    {
      tenantId: d.tenantId,
      userId: d.userId,
      template: "doubt",
      title: `${staff!.name} answered your doubt`,
      body: input.answer.length > 140 ? `${input.answer.slice(0, 137)}...` : input.answer,
      link: appLink("/play/doubts"),
      dedupeKey: `doubt:${d.id}`,
      sentBy: auth.userId,
    },
  ]);
  void processOutbox(db, now).catch(() => {});
  await audit(db, { tenantId: d.tenantId, actorId: auth.userId, action: "doubt.answer", target: d.id, data: { shared: input.shared } });
  return { id: updated!.id, status: updated!.status };
}

/** Close without an answer (a duplicate, or not about the question). */
export async function closeDoubt(db: Db, auth: AuthContext, id: string) {
  const d = await loadForStaff(db, auth, id);
  if (d.status !== "open") return { id: d.id, status: d.status };
  await db.update(doubts).set({ status: "closed", answeredBy: auth.userId }).where(eq(doubts.id, d.id));
  await audit(db, { tenantId: d.tenantId, actorId: auth.userId, action: "doubt.close", target: d.id });
  return { id: d.id, status: "closed" as const };
}

/** Open doubts in the staff member's scope, for the console's navigation badge. */
export async function openDoubtCount(db: Db, auth: AuthContext) {
  const scope = await studentsInScope(db, auth);
  const rows = await db.select({ userId: doubts.userId }).from(doubts).where(and(eq(doubts.tenantId, auth.tenantId!), eq(doubts.status, "open")));
  return rows.filter((r) => scope.has(r.userId)).length;
}
