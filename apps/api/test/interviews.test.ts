import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { aiUsage, tenants } from "../src/db/schema";
import { setAiProvider, type AiProvider, type InterviewInput } from "../src/lib/ai";
import { MAX_ANSWERS } from "../src/services/interviews";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const calls: InterviewInput[] = [];
const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 };

const notUsed = async () => {
  throw new Error("not used");
};
const fakeAi: AiProvider = {
  coachHint: notUsed,
  draftQuestions: notUsed,
  draftCodingProblems: notUsed,
  draftSqlProblems: notUsed,
  reviewSnapshot: notUsed,
  async interviewTurn(input) {
    calls.push(input);
    const answers = input.turns.filter((x) => x.role === "candidate").length;
    if (input.answersLeft === 0) return { value: { message: "Thank you, that's all for today.", done: true }, usage };
    return { value: { message: `Question ${answers + 1}: what does a for loop do?`, done: false }, usage };
  },
  async interviewScorecard(input) {
    calls.push(input);
    return {
      value: {
        scores: { problemSolving: 4, fundamentals: 3, communication: 5, code: 3 },
        overall: 4,
        strengths: ["Explained the loop bounds clearly."],
        improvements: ["State the time complexity without being asked."],
        summary: "You stayed calm and structured.",
        practise: ["not.a.skill", input.skillChoices[0]!.id],
      },
      usage,
    };
  },
};

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  setAiProvider(fakeAi);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("mock interviews", () => {
  let id: string;

  it("starts with a question pitched at the student's weakest skills", async () => {
    // The seeded interview from last week doesn't count against this week.
    const before = (await t.get(riya, "/student/interviews")).body;
    expect(before).toMatchObject({ available: true, weeklyLeft: 3, active: null });
    expect(before.interviews).toHaveLength(1);
    const res = await t.post(riya, "/student/interviews", { track: "service" });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body).toMatchObject({ track: "service", status: "active", answersLeft: MAX_ANSWERS, turns: [{ role: "interviewer", text: "Question 1: what does a for loop do?" }] });
    expect(res.body.focusSkills).toHaveLength(3);
    expect(calls[0]).toMatchObject({ track: "service", turns: [], answersLeft: MAX_ANSWERS });
    // Starting again resumes the same interview.
    expect((await t.post(riya, "/student/interviews", { track: "product" })).body.id).toBe(id);
  });

  it("carries the whole conversation into each turn", async () => {
    expect((await t.post(riya, `/student/interviews/${id}/answer`, { text: "   " })).status).toBe(400);
    const res = await t.post(riya, `/student/interviews/${id}/answer`, { text: "It repeats a block a fixed number of times." });
    expect(res.body.turns.map((x: { role: string }) => x.role)).toEqual(["interviewer", "candidate", "interviewer"]);
    expect(res.body.answersLeft).toBe(MAX_ANSWERS - 1);
    expect(calls.at(-1)!.turns).toEqual([
      { role: "interviewer", text: "Question 1: what does a for loop do?" },
      { role: "candidate", text: "It repeats a block a fixed number of times." },
    ]);
    expect(calls.at(-1)!.answersLeft).toBe(MAX_ANSWERS - 1);
    // Another student can't see it, and staff don't use the student endpoints.
    const tpo = await t.login("tpo@demo.edu");
    const unitId = (await t.get(tpo, "/console/org-units")).body.units.find((u: { name: string }) => u.name === "CSE 2027 - A").id;
    await t.post(tpo, "/console/students/import", { unitId, csv: "Other Student,other.student@demo.edu,X1", defaultPassword: "student-pass-1" });
    const other = await t.login("other.student@demo.edu", "student-pass-1");
    expect((await t.get(other, `/student/interviews/${id}`)).status).toBe(404);
    expect((await t.get(tpo, `/student/interviews/${id}`)).status).toBe(403);
  });

  it("closes after the last answer with a scorecard", async () => {
    let res;
    for (let i = 2; i <= MAX_ANSWERS; i++) res = await t.post(riya, `/student/interviews/${id}/answer`, { text: `Answer ${i}` });
    expect(res!.body.status).toBe("finished");
    expect(res!.body.turns.at(-1)).toMatchObject({ role: "interviewer", text: "Thank you, that's all for today." });
    expect(res!.body.scorecard).toMatchObject({ overall: 4, scores: { communication: 5 }, summary: "You stayed calm and structured." });
    // Skills the model made up are dropped; real ones come back with names.
    expect(res!.body.scorecard.practise).toHaveLength(1);
    expect(res!.body.scorecard.practise[0].name).toBeTruthy();
    expect((await t.post(riya, `/student/interviews/${id}/answer`, { text: "More" })).status).toBe(400);
    const tenantId = (await db.select().from(tenants).where(eq(tenants.slug, "demo-tech")))[0]!.id;
    const rows = (await db.select().from(aiUsage).where(eq(aiUsage.tenantId, tenantId))).filter((r) => r.feature === "mock_interview");
    expect(rows).toHaveLength(MAX_ANSWERS + 2); // opening question, a turn per answer, the scorecard
  });

  it("sets aside an interview ended before there is enough to score", async () => {
    const started = await t.post(riya, "/student/interviews", { track: "product" });
    await t.post(riya, `/student/interviews/${started.body.id}/answer`, { text: "Arrays are contiguous." });
    const res = await t.post(riya, `/student/interviews/${started.body.id}/finish`);
    expect(res.body).toMatchObject({ status: "abandoned", scorecard: null });
  });

  it("limits interviews per week and by plan", async () => {
    const third = await t.post(riya, "/student/interviews", { track: "service" });
    await t.post(riya, `/student/interviews/${third.body.id}/finish`);
    const fourth = await t.post(riya, "/student/interviews", { track: "service" });
    expect(fourth.status).toBe(400);
    expect(fourth.body.error.message).toContain("3 mock interviews a week");
    t.clock.now = new Date(START.getTime() + 8 * 86_400_000);
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ plan: "starter" }).where(eq(tenants.id, demo!.id));
    const list = (await t.get(riya, "/student/interviews")).body;
    expect(list).toMatchObject({ available: false, weeklyLeft: 3 });
    expect(list.reason).toContain("AI mock interviews");
    expect((await t.post(riya, "/student/interviews", { track: "service" })).status).toBe(400);
    await db.update(tenants).set({ plan: "enterprise" }).where(eq(tenants.id, demo!.id));
  });

  it("shows scorecards to the student's teachers", async () => {
    const faculty = await t.login("faculty@demo.edu");
    const list = (await t.get(faculty, "/console/interviews")).body;
    expect(list.interviews).toHaveLength(2);
    expect(list.interviews.find((r: { id: string }) => r.id === id)).toMatchObject({ name: "Riya Kapoor", overall: 4 });
    expect(list.averages.overall).toBe(4);
    const detail = (await t.get(faculty, `/console/interviews/${id}`)).body;
    expect(detail.turns).toHaveLength(2 * MAX_ANSWERS + 1);
    expect(detail.student.name).toBe("Riya Kapoor");
    // Students don't see the console list.
    expect((await t.get(riya, "/console/interviews")).status).toBe(403);
  });

  it("runs a spoken interview with delivery feedback", async () => {
    const started = (await t.post(riya, "/student/interviews", { track: "product", mode: "voice" })).body;
    expect(started.mode).toBe("voice");
    expect(calls.at(-1)).toMatchObject({ mode: "voice", turns: [] });
    // 40 words in 20 seconds (120 a minute), two fillers.
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const res = await t.post(riya, `/student/interviews/${started.id}/answer`, { text: `um basically ${words(38)}`, voice: { durationMs: 20_000, edited: false } });
    expect(res.body.turns[1].voice).toEqual({ durationMs: 20_000, words: 40, wpm: 120, fillers: 2, edited: false });
    expect((await t.post(riya, `/student/interviews/${started.id}/answer`, { text: "x", voice: { durationMs: 10, edited: false } })).status).toBe(400);
    // A typed answer in a voice interview carries no delivery stats.
    const typed = await t.post(riya, `/student/interviews/${started.id}/answer`, { text: words(30) });
    expect(typed.body.turns[3].voice).toBeUndefined();
    const done = (await t.post(riya, `/student/interviews/${started.id}/finish`)).body;
    expect(done.scorecard.delivery).toMatchObject({ spokenAnswers: 1, wordsPerMinute: 120, fillersPer100Words: 5, pace: "good" });
    expect(done.scorecard.delivery.tips[0]).toContain("filler");
    expect(calls.at(-1)).toMatchObject({ mode: "voice", delivery: { wordsPerMinute: 120 } });
    // Voice stats are ignored in a text interview.
    const text = (await t.post(riya, "/student/interviews", { track: "service" })).body;
    const r = await t.post(riya, `/student/interviews/${text.id}/answer`, { text: "Loops repeat.", voice: { durationMs: 5_000, edited: false } });
    expect(r.body.turns[1].voice).toBeUndefined();
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, "/console/interviews")).body.interviews.find((x: { id: string }) => x.id === started.id).mode).toBe("voice");
  });
});
