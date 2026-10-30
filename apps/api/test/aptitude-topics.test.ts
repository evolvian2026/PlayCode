import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateQuestion } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { aptitudeDrillAnswers, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let kavya: string;
let kavyaId: string;

type Topic = { template: string; answered: number; correct: number; accuracyPct: number; drillLevel: number };
const find = (topics: Topic[], id: string) => topics.find((x) => x.template === id);

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  kavyaId = (await db.select().from(users).where(eq(users.email, "kavya.singh8@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

async function drill(template: string, level: number, right: boolean) {
  const q = (await t.get(kavya, `/student/aptitude/drill?template=${template}&level=${level}`)).body;
  const answer = generateQuestion(q.template, q.level, q.seed).answer;
  return { q, checked: (await t.post(kavya, "/student/aptitude/drill/check", { template: q.template, level: q.level, seed: q.seed, chosen: right ? answer : (answer + 1) % 4 })).body };
}

describe("a student's own aptitude topics", () => {
  it("send data interpretation questions with their table", async () => {
    const { q, checked } = await drill("data-interpretation", 2, true);
    expect(q.table).toMatchObject({ columns: ["Store", "2023", "2024", "2025"] });
    expect(q.table.rows).toHaveLength(4);
    expect(checked.correct).toBe(true);
    expect((await t.get(kavya, "/student/aptitude/drill?template=percentages&level=1")).body.table).toBeNull();
  });

  it("count each drill question once, however often it's checked", async () => {
    const { q } = await drill("blood-relations", 1, true);
    await t.post(kavya, "/student/aptitude/drill/check", { template: q.template, level: q.level, seed: q.seed, chosen: 0 });
    const rows = await db.select().from(aptitudeDrillAnswers).where(eq(aptitudeDrillAnswers.userId, kavyaId));
    expect(rows.filter((r) => r.template === "blood-relations")).toEqual([expect.objectContaining({ correct: true, level: 1 })]);
  });

  it("show weakest first, with a drill a level easier where most answers are wrong", async () => {
    const before = (await t.get(kavya, "/student/aptitude/topics")).body;
    const staffBefore = find((await t.get(tpo, "/console/aptitude/topics")).body.topics, "syllogisms")?.answered ?? 0;
    const had = find(before.topics, "syllogisms");
    for (let i = 0; i < 3; i++) await drill("syllogisms", 3, false);
    const after = (await t.get(kavya, "/student/aptitude/topics")).body;
    const syl = find(after.topics, "syllogisms")!;
    expect(syl).toMatchObject({ answered: (had?.answered ?? 0) + 3, correct: had?.correct ?? 0 });
    if (!had) expect(syl).toMatchObject({ accuracyPct: 0, drillLevel: 2 });
    expect(after.untried.map((x: { id: string }) => x.id)).not.toContain("syllogisms");
    expect(after.untried.map((x: { id: string }) => x.id)).not.toContain("data-interpretation");
    const pcts = after.topics.map((x: Topic) => x.accuracyPct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    // Staff's view is tests and homework: a student's drills are their own practice.
    expect(find((await t.get(tpo, "/console/aptitude/topics")).body.topics, "syllogisms")?.answered ?? 0).toBe(staffBefore);
  });

  it("are in the student's data export", async () => {
    const exported = (await t.get(kavya, "/privacy/export")).body;
    expect(exported.aptitudeDrills.length).toBeGreaterThanOrEqual(5);
  });
});
