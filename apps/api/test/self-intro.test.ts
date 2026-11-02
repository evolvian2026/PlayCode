import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTRO_DRAFTS_PER_DAY } from "@playcode/core";
import { pool } from "../src/db/client";
import { setAiProvider, type AiProvider, type IntroInput } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const calls: IntroInput[] = [];
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
  jamFeedback: notUsed,
  async introDraft(input) {
    calls.push(input);
    return {
      value: {
        script: `Good morning. I am ${input.fullName}, studying ${input.program} at ${input.institution}.\n\nI built ${input.projects[0]?.title ?? "a project"}.\n\nI want to work as a ${input.targetRole}.`,
        used: ["Canteen ordering app", "NPTEL Java"],
      },
      usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0 },
    };
  },
};

const SCRIPT =
  "Good morning. I am Riya Kapoor, a final year computer science student. I built a canteen ordering app in Flutter for Smart India Hackathon and wrote its order queue. I am looking for a software engineer role where I can build apps people use every day.";

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

describe("tell me about yourself", () => {
  it("starts empty, with what a draft could draw on", async () => {
    const body = (await t.get(riya, "/student/intro")).body;
    expect(body.intro).toMatchObject({ script: "", practice: { runs: 0, best: null, last: null }, draftedAt: null });
    expect(body.draft).toEqual({ available: true, reason: null, leftToday: INTRO_DRAFTS_PER_DAY });
    expect(body.profile).toMatchObject({ projects: 0, internships: 0 });
  });

  it("drafts from the student's profile, without marks or contact details", async () => {
    await t.post(riya, "/student/resume/entries", { kind: "project", title: "Canteen ordering app", organisation: "Smart India Hackathon", startMonth: "2025-09", endMonth: null, description: "Flutter app with a Firebase backend.", link: null });
    const res = await t.post(riya, "/student/intro/draft", { targetRole: "Software engineer", extra: "I play chess for the college." });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ firstName: "Riya", fullName: "Riya Kapoor", targetRole: "Software engineer", extra: "I play chess for the college.", projects: [{ title: "Canteen ordering app", description: "Flutter app with a Firebase backend." }] });
    expect(JSON.stringify(calls[0])).not.toMatch(/@demo\.edu|CSE27A001|cgpa/i);
    expect(res.body.intro.script).toContain("I built Canteen ordering app.");
    expect(res.body.intro.draftedAt).not.toBeNull();
    expect(res.body.used).toEqual(["Canteen ordering app", "NPTEL Java"]);
    expect(res.body.draft.leftToday).toBe(INTRO_DRAFTS_PER_DAY - 1);
  });

  it("keeps the student's own edits, and limits drafts a day", async () => {
    const saved = await t.put(riya, "/student/intro", { script: SCRIPT, targetRole: "Software engineer", extra: "" });
    expect(saved.body.intro).toMatchObject({ script: SCRIPT, targetRole: "Software engineer", seconds: 20 });
    for (let i = 1; i < INTRO_DRAFTS_PER_DAY; i++) expect((await t.post(riya, "/student/intro/draft", { targetRole: "Analyst" })).status).toBe(200);
    expect((await t.post(riya, "/student/intro/draft", { targetRole: "Analyst" })).body.error.code).toBe("intro_daily_limit");
    await t.put(riya, "/student/intro", { script: SCRIPT, targetRole: "Software engineer", extra: "" });
  });

  it("scores a spoken run-through against the script, keeping only the numbers", async () => {
    expect((await t.post(await t.login("rohan.mehta3@demo.edu"), "/student/intro/practice", { heard: "hello", spokenMs: 5000 })).body.error.message).toBe("Save your introduction first");
    const heard = "good morning I am riya kapoor a final year computer science student I built a canteen ordering app in flutter um for smart india hackathon";
    const res = await t.post(riya, "/student/intro/practice", { heard, spokenMs: 20_000, hidden: true });
    expect(res.status).toBe(200);
    expect(res.body.result.coverage).toBe(52);
    expect(res.body.result.length).toBe("short");
    expect(res.body.practice).toMatchObject({ runs: 1, best: 52, last: { coverage: 52, seconds: 20, hidden: true } });
    const again = await t.post(riya, "/student/intro/practice", { heard: SCRIPT, spokenMs: 25_000 });
    expect(again.body.practice).toMatchObject({ runs: 2, best: 100 });
  });

  it("shows staff in scope the script and practice", async () => {
    const [me] = (await t.get(await t.login("faculty@demo.edu"), "/console/students")).body.students.filter((s: { name: string }) => s.name === "Riya Kapoor");
    const res = await t.get(await t.login("faculty@demo.edu"), `/console/students/${me.id}/intro`);
    expect(res.body.intro).toMatchObject({ script: SCRIPT, targetRole: "Software engineer", practice: { runs: 2, best: 100 } });
    expect((await t.get(await t.login("admin@sunrise.edu"), `/console/students/${me.id}/intro`)).status).toBe(404);
    expect((await t.get(riya, "/privacy/export")).body.selfIntroduction).toMatchObject({ script: SCRIPT });
  });
});
