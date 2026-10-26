import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WRITING_PER_DAY } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { aiUsage, tenants } from "../src/db/schema";
import { setAiProvider, type AiProvider, type WritingInput } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const calls: WritingInput[] = [];
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
  reviewCode: notUsed,
  gdTurn: notUsed,
  gdScorecard: notUsed,
  async writingFeedback(input) {
    calls.push(input);
    return {
      value: {
        scores: { task: 4, organisation: 3, language: 2, tone: 8 },
        overall: 3,
        pointsCovered: [2, 0, 0, 7],
        strengths: ["A clear subject line."],
        improvements: ["Say what support you need from the department."],
        corrections: [
          { original: "kindly do the needful", better: "please let me know", why: "A plain request reads better." },
          { original: "words that are not in the text", better: "x", why: "Invented." },
          { original: "Respected  Sir", better: "Respected Sir", why: "Same text after spacing is ignored." },
        ],
        improved: "Subject: Permission for a coding contest\n\nDear Sir, ...",
      },
      usage: { inputTokens: 700, outputTokens: 400, cacheReadTokens: 0 },
    };
  },
};

const EMAIL = `Subject: Permission for a coding contest

Respected Sir,

I am writing on behalf of CSE third year to ask permission to hold an inter-section coding contest on 14 November in Lab 3. It will help students practise timed problem solving before placements begin. Kindly do the needful.

Regards,
Riya Kapoor`;

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

describe("written English practice", () => {
  let id: string;

  it("lists the tasks and how many answers can be marked today", async () => {
    const home = (await t.get(riya, "/student/writing")).body;
    expect(home).toMatchObject({ available: true, leftToday: WRITING_PER_DAY, attempts: [] });
    expect(home.tasks.find((x: { id: string }) => x.id === "email-contest")).toMatchObject({ kind: "email", minWords: 80, maxWords: 150, minutes: 10, best: null });
  });

  it("marks an email against the task, keeping the feedback inside the rubric", async () => {
    expect((await t.post(riya, "/student/writing", { taskId: "email-contest", text: "Too short to mark.", timeMs: 30_000 })).status).toBe(400);
    expect((await t.post(riya, "/student/writing", { taskId: "no-such-task", text: EMAIL, timeMs: 1000 })).status).toBe(400);
    const res = await t.post(riya, "/student/writing", { taskId: "email-contest", text: EMAIL, timeMs: 7 * 60_000 });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(calls[0]).toMatchObject({ kind: "email", points: expect.arrayContaining(["why it will help students before placements"]), words: 50, minutesTaken: 7 });
    expect(res.body.feedback).toMatchObject({ scores: { task: 4, language: 2, tone: 5 }, overall: 3, pointsCovered: [0, 2] });
    // Only corrections that quote the text (case and spacing aside) and change something.
    expect(res.body.feedback.corrections.map((c: { better: string }) => c.better)).toEqual(["please let me know"]);
    expect((await t.get(riya, "/student/writing")).body).toMatchObject({ leftToday: WRITING_PER_DAY - 1, attempts: [{ id, overall: 3, words: 50 }] });
    expect((await t.get(riya, `/student/writing/${id}`)).body.text).toBe(EMAIL);
    expect((await db.select().from(aiUsage)).filter((u) => u.feature === "writing_feedback")).toHaveLength(1);
  });

  it("limits marking to five a day, and respects the institution's AI switch", async () => {
    for (let i = 1; i < WRITING_PER_DAY; i++) expect((await t.post(riya, "/student/writing", { taskId: "essay-ai", text: EMAIL, timeMs: 60_000 })).status).toBe(200);
    expect((await t.post(riya, "/student/writing", { taskId: "essay-ai", text: EMAIL, timeMs: 60_000 })).body.error.code).toBe("writing_daily_limit");

    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ settings: { ...demo!.settings, aiHints: false } }).where(eq(tenants.id, demo!.id));
    expect((await t.get(riya, "/student/writing")).body).toMatchObject({ available: false, reason: expect.stringContaining("not switched on") });
    await db.update(tenants).set({ settings: demo!.settings }).where(eq(tenants.id, demo!.id));
  });

  it("shows marked answers to the student's teachers only", async () => {
    const faculty = await t.login("faculty@demo.edu");
    const list = (await t.get(faculty, "/console/writing")).body;
    expect(list.averages).toMatchObject({ count: WRITING_PER_DAY, overall: 3, language: 2 });
    expect((await t.get(faculty, `/console/writing/${id}`)).body).toMatchObject({ student: { name: "Riya Kapoor" }, task: { id: "email-contest" } });
    expect((await t.get(await t.login("admin@sunrise.edu"), `/console/writing/${id}`)).status).toBe(404);
    expect((await t.get(await t.login("aarav.sharma1@demo.edu"), `/student/writing/${id}`)).status).toBe(404);
  });
});
