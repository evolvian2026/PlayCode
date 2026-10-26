import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { aiUsage, coachHintCache, coachHints } from "../src/db/schema";
import { setAiProvider, type AiProvider, type CoachHintInput } from "../src/lib/ai";
import { rightAnswer, setup, type TestApp } from "./helpers";

let t: TestApp;
const calls: CoachHintInput[] = [];
let nextHints: string[] = [];
const usage = { inputTokens: 900, outputTokens: 60, cacheReadTokens: 400 };

const fake: AiProvider = {
  gdTurn: async () => { throw new Error("not used"); },
  gdScorecard: async () => { throw new Error("not used"); },
  writingFeedback: async () => { throw new Error("not used"); },
  async coachHint(input) {
    calls.push(input);
    return { value: nextHints.shift() ?? `Look closely at the code (hint ${calls.length}).`, usage };
  },
  async draftQuestions() {
    throw new Error("not used");
  },
  async reviewSnapshot() {
    throw new Error("not used");
  },
  async draftCodingProblems() {
    throw new Error("not used");
  },
  async draftSqlProblems() {
    throw new Error("not used");
  },
  async reviewCode() {
    throw new Error("not used");
  },
  async interviewTurn() {
    throw new Error("not used");
  },
  async interviewScorecard() {
    throw new Error("not used");
  },
  async weeklyInsights() {
    throw new Error("not used");
  },
};

beforeAll(async () => {
  t = await setup();
  setAiProvider(fake);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("AI coach", () => {
  it("gives tailored hints that cost XP and never repeat", async () => {
    const student = await t.login("student@demo.edu");
    expect((await t.get(student, "/student/coach")).body.available).toBe(true);
    const session = (await t.post(student, "/student/sessions", { kind: "skill", skillId: "loops.for" })).body;
    const qid = session.question.id;

    const first = await t.post(student, `/student/sessions/${session.id}/coach`, { questionId: qid });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ coachUsed: 1, coachLeft: 2 });
    expect(calls[0]!.answer).toBeTruthy();
    expect(calls[0]!.previousHints).toEqual([]);

    const second = await t.post(student, `/student/sessions/${session.id}/coach`, { questionId: qid });
    expect(calls[1]!.previousHints).toEqual([first.body.hint]);
    expect(second.body.coachUsed).toBe(2);
    expect((await t.get(student, `/student/sessions/${session.id}`)).body.question.coachUsed).toBe(2);

    // Two coach hints cost half the XP compared with answering unaided.
    const res = await t.post(student, `/student/sessions/${session.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 20_000 });
    expect(res.body.correct).toBe(true);
    expect(res.body.xpBreakdown.some((b: { label: string }) => b.label === "2 hints")).toBe(true);

    const usageRows = await db.select().from(aiUsage).where(eq(aiUsage.feature, "coach_hint"));
    expect(usageRows.length).toBe(2);
    expect(usageRows[0]).toMatchObject({ model: "claude-opus-5-5", inputTokens: 900 });
  });

  it("reuses generic hints across students and limits each question", async () => {
    // Today's daily challenge is the same for everyone, so two fresh students see the same first question.
    const admin = await t.login("admin@demo.edu");
    const idle = ((await t.get(admin, "/console/students")).body.students as { email: string; xp: number }[]).filter((s) => s.xp === 0);
    const a = await t.login(idle[0]!.email);
    const b = await t.login(idle[1]!.email);
    const sa = (await t.post(a, "/student/sessions", { kind: "daily" })).body;
    const sb = (await t.post(b, "/student/sessions", { kind: "daily" })).body;
    const qid = sa.question.id;
    expect(sb.question.id).toBe(qid);

    const before = calls.length;
    await t.post(a, `/student/sessions/${sa.id}/coach`, { questionId: qid });
    expect(calls.length).toBe(before + 1);
    const hit = await t.post(b, `/student/sessions/${sb.id}/coach`, { questionId: qid });
    expect(hit.status).toBe(200);
    expect(calls.length).toBe(before + 1);
    const [row] = await db.select().from(coachHints).where(eq(coachHints.sessionId, sb.id));
    expect(row!.cached).toBe(true);

    await t.post(a, `/student/sessions/${sa.id}/coach`, { questionId: qid });
    await t.post(a, `/student/sessions/${sa.id}/coach`, { questionId: qid });
    expect((await t.post(a, `/student/sessions/${sa.id}/coach`, { questionId: qid })).status).toBe(409);
  });

  it("retries a hint that gives the answer away", async () => {
    await db.delete(coachHintCache); // a cached hint would skip the AI call this test is about
    const admin = await t.login("admin@demo.edu");
    const bank = (await t.get(admin, "/console/questions")).body.questions as { id: string; skillId: string; body: { options?: { id: string; text: string }[] }; answer: { kind: string; accepted?: string[]; optionId?: string } }[];
    const secretOf = (q: (typeof bank)[number]) =>
      q.answer.kind === "text" ? (q.answer.accepted?.[0] ?? "") : q.answer.kind === "option" ? (q.body.options?.find((o) => o.id === q.answer.optionId)?.text ?? "") : "";
    const student = await t.login("student@demo.edu");
    // Find a practice question whose answer is long enough to spot in a hint.
    for (const skillId of [...new Set(bank.map((q) => q.skillId))]) {
      const session = (await t.post(student, "/student/sessions", { kind: "skill", skillId })).body;
      const q = bank.find((x) => x.id === session.question?.id);
      if (!q || secretOf(q).trim().length < 3) continue;
      nextHints = [`The answer is ${secretOf(q)}.`, "Think about when the loop condition is checked."];
      const res = await t.post(student, `/student/sessions/${session.id}/coach`, { questionId: q.id });
      expect(res.body.hint).toBe("Think about when the loop condition is checked.");
      nextHints = [];
      return;
    }
    throw new Error("no question with a long enough answer");
  });

  it("can be switched off per institution", async () => {
    const admin = await t.login("admin@demo.edu");
    expect((await t.get(admin, "/console/ai")).body).toEqual({ configured: true, hints: true, proctoring: true });
    await t.put(admin, "/console/ai", { hints: false, proctoring: true });
    const student = await t.login("student@demo.edu");
    expect((await t.get(student, "/student/coach")).body.available).toBe(false);
    const session = (await t.post(student, "/student/sessions", { kind: "skill", skillId: "loops.for" })).body;
    expect((await t.post(student, `/student/sessions/${session.id}/coach`, { questionId: session.question.id })).status).toBe(400);
    await t.put(admin, "/console/ai", { hints: true, proctoring: true });

    setAiProvider(null);
    expect((await t.get(student, "/student/coach")).body.available).toBe(false);
    expect((await t.get(admin, "/console/ai")).body.configured).toBe(false);
    setAiProvider(fake);
  });
});
