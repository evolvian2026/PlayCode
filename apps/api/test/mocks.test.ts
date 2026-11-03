import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODING_QUESTIONS } from "../src/content/coding";
import { db, pool } from "../src/db/client";
import { memberships, mockAttempts, users } from "../src/db/schema";
import { finalizeExpiredMocks } from "../src/services/mocks";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
type View = { id: string; section: number | null; timeLeftMs: number; status: string; questions: { question: { id: string } }[]; sections: { title: string; state: string; answered: number; count: number }[]; result: any };

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("mock tests", () => {
  let first: View;

  it("lists the patterns and starts a timed first section", async () => {
    const list = (await t.get(riya, "/student/mocks")).body;
    expect(list.patterns.map((p: { id: string; minutes: number }) => [p.id, p.minutes])).toEqual([
      ["service", 60],
      ["product", 67],
    ]);
    expect(list.attempts).toEqual([]);
    expect((await t.post(riya, "/student/mocks", { pattern: "gate" })).status).toBe(400);

    t.clock.now = at(0);
    first = (await t.post(riya, "/student/mocks", { pattern: "service" })).body;
    expect(first).toMatchObject({ status: "in_progress", section: 0, timeLeftMs: 10 * 60_000 });
    expect(first.sections.map((s) => [s.title, s.state, s.count])).toEqual([
      ["Quantitative aptitude", "open", 6],
      ["Logical reasoning", "upcoming", 5],
      ["Verbal ability", "upcoming", 6],
      ["Programming logic", "upcoming", 6],
      ["Hands-on coding", "upcoming", 1],
    ]);
    // Only the open section's questions, and no answers.
    expect(first.questions).toHaveLength(6);
    expect(first.questions.every((q) => q.question.id.startsWith("apt-"))).toBe(true);
    expect(JSON.stringify(first)).not.toContain('"answer"');
    // One at a time.
    const again = await t.post(riya, "/student/mocks", { pattern: "product" });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ id: first.id });
  });

  it("saves answers only for the open section, and keeps the clock running", async () => {
    const [a, b, c, d] = first.questions.map((q) => q.question.id);
    const save = (questionId: string, response: unknown) => t.put(riya, `/student/mocks/${first.id}/answers`, { questionId, response });
    for (const id of [a!, b!, c!]) expect((await save(id, rightAnswer(id))).status).toBe(200);
    await save(d!, wrongAnswer(d!));
    const all = (await db.select().from(mockAttempts).where(eq(mockAttempts.id, first.id)))[0]!;
    const later = all.questions.find((q) => q.section === 1)!.questionId;
    expect((await save(later, rightAnswer(later))).body.error.code).toBe("section_closed");

    // The student wanders off; the first section closes at minute 10 and the second runs from then.
    t.clock.now = at(12);
    const view: View = (await t.get(riya, `/student/mocks/${first.id}`)).body;
    expect(view).toMatchObject({ section: 1, timeLeftMs: 6 * 60_000 });
    expect(view.sections[0]).toMatchObject({ state: "closed", answered: 4 });
    expect((await save(a!, wrongAnswer(a!))).body.error.code).toBe("section_closed");

    // Finishing a section early starts the next one now; a double click doesn't skip one.
    await save(later, rightAnswer(later));
    expect((await t.post(riya, `/student/mocks/${first.id}/next`, { section: 1 })).body).toMatchObject({ section: 2, timeLeftMs: 8 * 60_000 });
    expect((await t.post(riya, `/student/mocks/${first.id}/next`, { section: 1 })).body.section).toBe(2);
  });

  it("marks the paper and reports sections, focus and every answer", async () => {
    await t.post(riya, `/student/mocks/${first.id}/next`, { section: 2 });
    const coding: View = (await t.post(riya, `/student/mocks/${first.id}/next`, { section: 3 })).body;
    expect(coding.section).toBe(4);
    const problem = coding.questions[0]!.question.id;
    const source = CODING_QUESTIONS.find((q) => q.id === problem)!.solutions!.python!;
    const run = await t.post(riya, `/student/mocks/${first.id}/run`, { questionId: problem, response: { kind: "code", language: "python", source } });
    expect(run.body.correct).toBe(true);
    await t.put(riya, `/student/mocks/${first.id}/answers`, { questionId: problem, response: { kind: "code", language: "python", source } });

    const done: View = (await t.post(riya, `/student/mocks/${first.id}/finish`, {})).body;
    expect(done.status).toBe("submitted");
    const r = done.result;
    // Aptitude 3 of 6, reasoning 1 of 5, verbal and logic 0, coding 5 of 5: 9 of 28.
    expect(r.sections.map((s: { title: string; score: number; max: number }) => [s.title, s.score, s.max])).toEqual([
      ["Quantitative aptitude", 3, 6],
      ["Logical reasoning", 1, 5],
      ["Verbal ability", 0, 6],
      ["Programming logic", 0, 6],
      ["Hands-on coding", 5, 5],
    ]);
    expect(r).toMatchObject({ score: 9, maxScore: 28, pct: 32, percentile: null, compared: 1 });
    expect(r.focus.map((f: { title: string }) => f.title)).toEqual(["Verbal ability", "Programming logic", "Logical reasoning", "Quantitative aptitude"]);
    expect(r.focus[0].skillId).toMatch(/^verbal\./);
    expect(r.review).toHaveLength(24);
    const wrong = r.review.find((x: { correct: boolean; yourAnswer: string | null }) => !x.correct && x.yourAnswer);
    expect(wrong.correctAnswer).not.toBe(wrong.yourAnswer);
    expect(wrong.explanation.length).toBeGreaterThan(10);
    expect((await t.put(riya, `/student/mocks/${first.id}/answers`, { questionId: problem, response: null })).status).toBe(409);
  });

  it("draws a fresh paper next time and closes abandoned ones", async () => {
    const second: View = (await t.post(riya, "/student/mocks", { pattern: "service" })).body;
    const ids = async (id: string) => (await db.select().from(mockAttempts).where(eq(mockAttempts.id, id)))[0]!.questions.filter((q) => q.section === 0).map((q) => q.questionId);
    const firstApt = await ids(first.id);
    expect((await ids(second.id)).filter((q) => firstApt.includes(q))).toEqual([]); // 13 aptitude questions: 6 then 6 unseen

    t.clock.now = at(200);
    expect((await finalizeExpiredMocks(db, t.clock.now)).finalized).toBe(1);
    const list = (await t.get(riya, "/student/mocks")).body.attempts;
    expect(list.map((a: { status: string; pct: number }) => [a.status, a.pct])).toEqual([
      ["submitted", 0],
      ["submitted", 32],
    ]);
  });

  it("gives a percentile once 20 students have a result, and limits mocks a day", async () => {
    const others = await db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(eq(memberships.role, "student"))
      .limit(40);
    const riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
    const rows = others.filter((p) => p.id !== riyaId).slice(0, 24);
    await db.insert(mockAttempts).values(
      rows.map((p, i) => ({ userId: p.id, tenantId: p.tenantId!, pattern: "service" as const, questions: [], status: "submitted" as const, sectionDeadline: at(0), startedAt: at(0), submittedAt: at(1), score: i * 100, maxScore: 2900 })),
    );
    const r = (await t.get(riya, `/student/mocks/${first.id}`)).body.result;
    // Peers score 0..23 of 29 (0% to 79%). Riya's 32% beats the ten up to 9 of 29 (31%), and her own
    // score counts among the 25 as a tie with itself: (10 + 1/2) / 25.
    expect(r.compared).toBe(25);
    expect(r.percentile).toBe(42);

    for (let i = 0; i < 3; i++) {
      const m = (await t.post(riya, "/student/mocks", { pattern: "product" })).body;
      await t.post(riya, `/student/mocks/${m.id}/finish`, {});
    }
    // Five started since minute 0 of the same day.
    expect((await t.post(riya, "/student/mocks", { pattern: "product" })).body.error.code).toBe("mock_limit");
    await db.delete(mockAttempts).where(inArray(mockAttempts.userId, rows.map((p) => p.id)));
  });

  it("shows staff the scores but not the answers", async () => {
    const tpo = await t.login("tpo@demo.edu");
    const riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
    const detail = (await t.get(tpo, `/console/students/${riyaId}`)).body;
    expect(detail.mockTests.at(-1)).toMatchObject({ pattern: "Service-company pattern", pct: 32 });
    expect(detail.mockTests[0].sections.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail.mockTests)).not.toContain("answers");
    // Other students can't open someone's mock.
    const dev = await t.login("aarav.sharma1@demo.edu");
    expect((await t.get(dev, `/student/mocks/${first.id}`)).status).toBe(404);
  });
});
