import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateQuestion } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { adaptiveAttempts } from "../src/db/schema";
import { finalizeAbandonedAdaptive } from "../src/services/adaptive";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let kavya: string;
const MIN = 60_000;

/** The open question's right answer, read from the stored attempt. */
async function rightAnswer(id: string) {
  const [row] = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.id, id));
  const section = row!.sections.find((s) => !s.done)!;
  return { answer: section.items.at(-1)!.answer, level: section.items.at(-1)!.level, options: section.items.at(-1)!.options.length };
}

async function answerAll(token: string, id: string, right: (n: number) => boolean, count: number) {
  const levels: number[] = [];
  let view = (await t.get(token, `/student/aptitude/tests/${id}`)).body;
  for (let i = 0; i < count; i++) {
    const { answer, level } = await rightAnswer(id);
    levels.push(level);
    view = (await t.post(token, `/student/aptitude/tests/${id}/answer`, { number: view.question.number, chosen: right(i) ? answer : (answer + 1) % 4 })).body;
    t.clock.now = new Date(t.clock.now.getTime() + 20_000);
  }
  return { view, levels };
}

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("aptitude drills", () => {
  it("give a fresh question without its answer, and check it from the seed", async () => {
    const q = (await t.get(riya, "/student/aptitude/drill?template=time-work&level=2")).body;
    expect(q).toMatchObject({ template: "time-work", level: 2 });
    expect(q).not.toHaveProperty("answer");
    expect(q).not.toHaveProperty("explanation");
    const right = generateQuestion(q.template, q.level, q.seed).answer;
    expect((await t.post(riya, "/student/aptitude/drill/check", { ...q, chosen: right })).body).toMatchObject({ correct: true, answer: right });
    const wrong = await t.post(riya, "/student/aptitude/drill/check", { ...q, chosen: (right + 1) % 4 });
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.explanation).toContain("days");
    expect((await t.get(riya, "/student/aptitude/drill?template=astrology")).status).toBe(404);
  });
});

describe("the adaptive test", () => {
  let first: string;

  it("climbs with right answers and drops with wrong ones, then scores each section", async () => {
    first = (await t.post(riya, "/student/aptitude/tests", {})).body.id;
    expect((await t.post(riya, "/student/aptitude/tests", {})).body.id).toBe(first); // resumes
    const view = (await t.get(riya, `/student/aptitude/tests/${first}`)).body;
    expect(view.section).toMatchObject({ index: 0, key: "quant", items: 12 });
    expect(view.question.number).toBe(1);
    expect(JSON.stringify(view)).not.toMatch(/"answer"|explanation/);

    const quant = await answerAll(riya, first, () => true, 12);
    expect(quant.levels[0]).toBe(3);
    expect(quant.levels.at(-1)).toBe(5);
    expect(quant.view.section).toMatchObject({ index: 1, key: "reasoning" });
    const reasoning = await answerAll(riya, first, () => false, 10);
    expect(reasoning.levels.at(-1)).toBe(1);

    const r = reasoning.view;
    expect(r.status).toBe("finished");
    const [q, lr] = r.sections;
    expect(q.score).toBeGreaterThanOrEqual(650);
    expect(q.band).toBe("strong");
    expect(q.highestLevel).toBe(5);
    expect(lr.score).toBeLessThan(400);
    expect(lr.correct).toBe(0);
    expect(r.score).toBe(Math.round((q.score + lr.score) / 2 / 5) * 5);
    expect(q.range[0]).toBeLessThan(q.score);
    expect(q.items[0]).toHaveProperty("explanation");
    // 20 classmates took it in the seed: the percentile is against their latest scores.
    expect(r.others).toBe(20);
    expect(r.percentile).toBeGreaterThanOrEqual(0);
    expect((await t.post(riya, `/student/aptitude/tests/${first}/answer`, { number: 11, chosen: 0 })).status).toBe(409);
  });

  it("counts questions not reached as wrong when a section's time runs out", async () => {
    const id = (await t.post(riya, "/student/aptitude/tests", {})).body.id;
    expect(id).not.toBe(first);
    await answerAll(riya, id, () => true, 3);
    t.clock.now = new Date(t.clock.now.getTime() + 19 * MIN);
    const view = (await t.get(riya, `/student/aptitude/tests/${id}`)).body;
    expect(view.section.key).toBe("reasoning"); // the quant section closed
    const [row] = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.id, id));
    expect(row!.sections[0]!.done).toBe(true);
    expect(row!.sections[0]!.theta).toBeLessThan(0); // 3 right, 9 not reached
    // Left there: a day after the reasoning section's time is up, the attempt is finished.
    t.clock.now = new Date(t.clock.now.getTime() + 2 * 24 * 60 * MIN);
    expect(await finalizeAbandonedAdaptive(db, t.clock.now)).toBe(1);
    expect((await t.get(riya, "/student/aptitude")).body).toMatchObject({ inProgress: null, attempts: [expect.objectContaining({ id }), expect.objectContaining({ id: first })] });
  });

  it("shows staff each student's latest score", async () => {
    await answerAll(kavya, (await t.post(kavya, "/student/aptitude/tests", {})).body.id, (i) => i % 2 === 0, 22);
    const tpo = await t.login("tpo@demo.edu");
    const res = (await t.get(tpo, "/console/aptitude")).body;
    expect(res.summary.tested).toBe(22); // 20 from the seed, Riya and Kavya
    expect(Object.values(res.summary.bands).reduce((a: number, b) => a + (b as number), 0)).toBe(22);
    const riyaRow = res.students.find((s: { name: string }) => s.name === "Riya Kapoor");
    expect(riyaRow.score).toBeLessThan(500); // the latest, cut short
    expect(res.students.find((s: { name: string }) => s.name === "Kavya Singh").scores).toHaveProperty("quant");
    expect((await t.get(riya, "/console/aptitude")).status).toBe(403);
    const graduate = await t.login("graduate@demo.edu");
    expect((await t.post(graduate, "/student/aptitude/tests", {})).status).toBe(403);
  });
});
