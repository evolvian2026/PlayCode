import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODING_QUESTIONS } from "../src/content/coding";
import { db, pool } from "../src/db/client";
import { aiUsage, tenants } from "../src/db/schema";
import { setAiProvider, type AiProvider, type CodeReviewInput } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const calls: CodeReviewInput[] = [];
const notUsed = async () => {
  throw new Error("not used");
};
const fake: AiProvider = {
  coachHint: notUsed,
  draftQuestions: notUsed,
  draftCodingProblems: notUsed,
  draftSqlProblems: notUsed,
  reviewSnapshot: notUsed,
  interviewTurn: notUsed,
  interviewScorecard: notUsed,
  weeklyInsights: notUsed,
  async reviewCode(input) {
    calls.push(input);
    return {
      value: {
        summary: "Clean and correct. You read the input once and print the result directly.",
        timeComplexity: "O(1)",
        spaceComplexity: "O(1)",
        betterApproach: null,
        edgeCases: ["Very large numbers", "Negative numbers", "Extra spaces", "A fourth that should be dropped"],
        readability: ["Name a and b after what they hold."],
        improvedCode: "a, b = map(int, input().split())\nprint(a + b)",
      },
      usage: { inputTokens: 900, outputTokens: 300, cacheReadTokens: 0 },
    };
  },
};

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  setAiProvider(fake);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("AI code review", () => {
  let session: string;
  let qid: string;

  it("reviews only code that passed every test", async () => {
    const s = (await t.post(riya, "/student/sessions", { kind: "skill", skillId: "coding.basics" })).body;
    session = s.id;
    qid = s.question.id;
    expect((await t.post(riya, `/student/sessions/${session}/questions/${qid}/review`)).status).toBe(404); // not solved yet
    const q = CODING_QUESTIONS.find((x) => x.id === qid)!;
    const source = q.solutions!.python!;
    const res = await t.post(riya, `/student/sessions/${session}/answer`, { questionId: qid, response: { kind: "code", language: "python", source }, timeMs: 60_000 });
    expect(res.body.correct).toBe(true);

    const review = await t.post(riya, `/student/sessions/${session}/questions/${qid}/review`);
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({ language: "python", review: { timeComplexity: "O(1)", betterApproach: null } });
    expect(review.body.review.edgeCases).toHaveLength(3); // at most three
    expect(calls[0]).toMatchObject({ language: "python", source, reference: { language: "python" } });
    expect(calls[0]!.stem).toBe(q.body.stem);
  });

  it("is kept, so asking again doesn't pay twice", async () => {
    const again = await t.post(riya, `/student/sessions/${session}/questions/${qid}/review`);
    expect(again.body.review.summary).toContain("Clean and correct");
    expect(calls).toHaveLength(1);
    const used = (await db.select().from(aiUsage)).filter((u) => u.feature === "code_review");
    expect(used).toHaveLength(1);
  });

  it("refuses other students, quick questions and institutions that switched AI off", async () => {
    expect((await t.post(await t.login("aarav.sharma1@demo.edu"), `/student/sessions/${session}/questions/${qid}/review`)).status).toBe(404);
    expect((await t.post(riya, `/student/sessions/${session}/questions/py-basics-ops-1/review`)).status).toBe(400);
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ settings: { ...demo!.settings, aiHints: false } }).where(eq(tenants.id, demo!.id));
    expect((await t.post(riya, `/student/sessions/${session}/questions/${qid}/review`)).status).toBe(400);
    await db.update(tenants).set({ settings: demo!.settings }).where(eq(tenants.id, demo!.id));
  });
});
