import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JAM_PER_DAY } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { aiUsage, tenants } from "../src/db/schema";
import { setAiProvider, type AiProvider, type JamInput } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const calls: JamInput[] = [];
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
  writingFeedback: notUsed,
  introDraft: notUsed,
  async jamFeedback(input) {
    calls.push(input);
    return {
      value: {
        // Out of range on purpose: the API keeps scores to 1-5.
        scores: { content: 4, structure: 2, language: 9 },
        overall: 3,
        strengths: ["A personal example: \"my cousin pays the vegetable seller by UPI\"."],
        improvements: ["End with a line that sums up your view.", "Give a second example.", "Slow down.", "A fourth point that should be dropped."],
        betterOpening: "Five years ago, paying a vegetable seller meant counting coins; today it takes one scan.",
        outline: ["Speed and convenience", "Small sellers joined the formal economy", "Risks: fraud and dependence on phones", "Extra"],
      },
      usage: { inputTokens: 600, outputTokens: 300, cacheReadTokens: 0 },
    };
  },
};

// About 130 words, as a browser transcript: no punctuation, a few fillers.
const TALK =
  "um UPI has changed the way we pay in India completely five years ago my family paid for everything in cash and my father always carried coins for the vegetable seller now even the vegetable seller has a QR code basically everybody from my cousin to my grandmother pays by scanning it is fast it is free and it works on any phone with an internet connection " +
  "it also helped small shop owners because every payment is recorded so they can show their income to a bank and get a loan but there are risks too people get calls from fraudsters asking for their PIN and older people find it hard to know what is safe so I think UPI is one of the best things to happen to payments in India but we need to teach people to use it safely";

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

describe("JAM speaking practice", () => {
  let id: string;

  it("lists the topics and how many talks can be marked today", async () => {
    const home = (await t.get(riya, "/student/jam")).body;
    expect(home).toMatchObject({ available: true, leftToday: JAM_PER_DAY, attempts: [] });
    expect(home.topics.find((x: { id: string }) => x.id === "upi")).toMatchObject({ category: "technology", topic: "How UPI changed the way we pay", best: null });
  });

  it("marks a talk, with delivery measured from the transcript and time spoken", async () => {
    expect((await t.post(riya, "/student/jam", { topicId: "upi", transcript: "um I think UPI is good", spokenMs: 20_000 })).body.error.message).toMatch(/only 6 words/);
    expect((await t.post(riya, "/student/jam", { topicId: "no-such-topic", transcript: TALK, spokenMs: 60_000 })).status).toBe(400);
    const res = await t.post(riya, "/student/jam", { topicId: "upi", transcript: TALK, spokenMs: 58_000 });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(calls[0]).toMatchObject({ topic: "How UPI changed the way we pay", seconds: 58, words: res.body.delivery.words });
    expect(res.body.delivery).toMatchObject({ pace: "good", usedPct: 97, fillers: 2 });
    expect(res.body.delivery.wpm).toBeGreaterThan(130);
    // Feedback stays in shape: scores 1-5, at most three improvements and three outline points.
    expect(res.body.feedback).toMatchObject({ scores: { content: 4, structure: 2, language: 5 }, overall: 3 });
    expect(res.body.feedback.improvements).toHaveLength(3);
    expect(res.body.feedback.outline).toHaveLength(3);
    expect((await t.get(riya, "/student/jam")).body).toMatchObject({ leftToday: JAM_PER_DAY - 1, attempts: [{ id, topicId: "upi", overall: 3 }] });
    expect((await t.get(riya, `/student/jam/${id}`)).body.transcript).toBe(TALK);
    expect((await db.select().from(aiUsage)).filter((u) => u.feature === "jam_feedback")).toHaveLength(1);
  });

  it("limits marking to five a day, and respects the institution's AI switch", async () => {
    for (let i = 1; i < JAM_PER_DAY; i++) expect((await t.post(riya, "/student/jam", { topicId: "silence", transcript: TALK, spokenMs: 60_000 })).status).toBe(200);
    expect((await t.post(riya, "/student/jam", { topicId: "silence", transcript: TALK, spokenMs: 60_000 })).body.error.code).toBe("jam_daily_limit");

    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ settings: { ...demo!.settings, aiHints: false } }).where(eq(tenants.id, demo!.id));
    expect((await t.get(riya, "/student/jam")).body).toMatchObject({ available: false, reason: expect.stringContaining("not switched on") });
    await db.update(tenants).set({ settings: demo!.settings }).where(eq(tenants.id, demo!.id));
  });

  it("shows talks to the student's teachers only", async () => {
    const faculty = await t.login("faculty@demo.edu");
    const list = (await t.get(faculty, "/console/jam")).body;
    expect(list.averages).toMatchObject({ count: JAM_PER_DAY, students: 1, overall: 3, structure: 2 });
    expect(list.attempts.find((a: { id: string }) => a.id === id)).toMatchObject({ name: "Riya Kapoor", topic: "How UPI changed the way we pay", usedPct: 97 });
    expect((await t.get(faculty, `/console/jam/${id}`)).body).toMatchObject({ student: { name: "Riya Kapoor" }, topic: { id: "upi" }, transcript: TALK });
    expect((await t.get(await t.login("admin@sunrise.edu"), `/console/jam/${id}`)).status).toBe(404);
    expect((await t.get(await t.login("aarav.sharma1@demo.edu"), `/student/jam/${id}`)).status).toBe(404);
  });

  it("appear in the student's data export", async () => {
    const exported = await t.get(riya, "/privacy/export");
    expect(exported.status).toBe(200);
    expect(exported.body.speaking).toHaveLength(JAM_PER_DAY);
    expect(exported.body.speaking[0].transcript).toBe(TALK);
  });
});
