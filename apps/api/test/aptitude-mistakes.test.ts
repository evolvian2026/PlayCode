import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateQuestion } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { adaptiveAttempts, aptitudeDrillAnswers, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let riyaId: string;
let faculty: string;

type Mistake = { key: string; template: string; level: number; seed: number; from: string; at: string; chosen: number | null; answer: number; prompt: string };

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("aptitude mistakes to retry", () => {
  it("list wrong answers from homework and drills, newest first, with the student's answer and the working", async () => {
    const r = (await t.get(riya, "/student/aptitude/mistakes")).body;
    expect(r.total).toBeGreaterThan(3);
    const froms = new Set(r.mistakes.map((m: Mistake) => m.from));
    expect(froms).toContain("drill");
    expect(froms).toContain("homework");
    const at = r.mistakes.map((m: Mistake) => Date.parse(m.at));
    expect(at).toEqual([...at].sort((a, b) => b - a));
    const drill = r.mistakes.find((m: Mistake) => m.from === "drill" && m.template === "probability")!;
    expect(drill.chosen).not.toBeNull();
    expect(drill.chosen).not.toBe(drill.answer);
    expect(drill.answer).toBe(generateQuestion(drill.template, drill.level, drill.seed).answer);
    expect((await t.get(riya, "/student/aptitude/topics")).body.mistakes).toBe(r.total);
  });

  it("don't show a test's answers while it's still open", async () => {
    const id = (await t.post(riya, "/student/aptitude/tests", {})).body.id;
    const view = (await t.get(riya, `/student/aptitude/tests/${id}`)).body;
    const [row] = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.id, id));
    const answer = row!.sections[0]!.items[0]!.answer;
    await t.post(riya, `/student/aptitude/tests/${id}/answer`, { number: view.question.number, chosen: (answer + 1) % 4 });
    const r = (await t.get(riya, "/student/aptitude/mistakes")).body;
    expect(r.mistakes.some((m: Mistake) => m.from === "test")).toBe(false);
  });

  it("are put right by getting a similar question right, not by a wrong try", async () => {
    const before = (await t.get(riya, "/student/aptitude/mistakes")).body;
    const m: Mistake = before.mistakes.find((x: Mistake) => x.from === "drill")!;
    const fresh = async () => (await t.get(riya, `/student/aptitude/drill?template=${m.template}&level=${m.level}`)).body;
    let q = await fresh();
    const right = (seed: number) => generateQuestion(m.template, m.level, seed).answer;
    const miss = (await t.post(riya, "/student/aptitude/drill/check", { template: q.template, level: q.level, seed: q.seed, chosen: (right(q.seed) + 1) % 4, seconds: 70, retryOf: { seed: m.seed } })).body;
    expect(miss).toMatchObject({ correct: false, fixed: false });
    q = await fresh();
    const hit = (await t.post(riya, "/student/aptitude/drill/check", { template: q.template, level: q.level, seed: q.seed, chosen: right(q.seed), seconds: 64, retryOf: { seed: m.seed } })).body;
    expect(hit).toMatchObject({ correct: true, fixed: true });
    const after = (await t.get(riya, "/student/aptitude/mistakes")).body;
    expect(after.mistakes.map((x: Mistake) => x.key)).not.toContain(m.key);
    // The wrong try is a mistake of its own now; the original is gone.
    expect(after.total).toBe(before.total);
    const [kept] = await db.select().from(aptitudeDrillAnswers).where(eq(aptitudeDrillAnswers.seed, q.seed));
    expect(kept).toMatchObject({ userId: riyaId, seconds: 64, correct: true });
    expect((await t.get(riya, "/privacy/export")).body.aptitudeMistakesFixed).toEqual([expect.objectContaining({ template: m.template, level: m.level })]);
  });
});

describe("pace by topic", () => {
  it("shows a student the middle time a question against what tests allow", async () => {
    const { topics } = (await t.get(riya, "/student/aptitude/topics")).body;
    const by = (id: string) => topics.find((x: { template: string }) => x.template === id);
    expect(by("probability")).toMatchObject({ targetSeconds: 90, pace: "slow" });
    expect(by("probability").medianSeconds).toBeGreaterThan(112);
    expect(by("syllogisms")).toMatchObject({ targetSeconds: 72, pace: "on_pace" });
    // Homework isn't timed, so a topic only done as homework has no pace.
    expect(by("percentages")).toMatchObject({ medianSeconds: null, pace: null });
  });

  it("shows staff the batch's pace from tests", async () => {
    const { topics } = (await t.get(faculty, "/console/aptitude/topics")).body;
    const timed = topics.filter((x: { medianSeconds: number | null }) => x.medianSeconds !== null);
    expect(timed.length).toBeGreaterThan(3);
    for (const x of timed) expect(["slow", "on_pace"]).toContain(x.pace);
  });
});
