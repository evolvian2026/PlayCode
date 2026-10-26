import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { skillRatings, users } from "../src/db/schema";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let faculty: string;
let unitA: string;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const SKILL = "aptitude.time";
const window = { openAt: new Date(START.getTime() - 60_000).toISOString(), closeAt: new Date(START.getTime() + 7 * 86_400_000).toISOString() };

beforeAll(async () => {
  t = await setup();
  const tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  // Three students: one struggling with time and work (rating 900 = mastery 25), one doing fine (1200 = 50), one who never tried it.
  await t.post(tpo, "/console/students/import", { unitId: unitA, csv: "Low Lata,low.lata@demo.edu,R1\nMid Manoj,mid.manoj@demo.edu,R2\nNew Neha,new.neha@demo.edu,R3", defaultPassword: "student-pass-1" });
  for (const [key, email] of [["low", "low.lata@demo.edu"], ["mid", "mid.manoj@demo.edu"], ["new", "new.neha@demo.edu"]]) {
    ids[key] = (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
    tokens[key] = await t.login(email, "student-pass-1");
  }
  await db.insert(skillRatings).values([
    { userId: ids.low!, skillId: SKILL, rating: 900, attempts: 6, correct: 1 },
    { userId: ids.mid!, skillId: SKILL, rating: 1200, attempts: 6, correct: 4 },
  ]);
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("remedial assignments", () => {
  let id: string;

  it("finds the students below a mastery threshold", async () => {
    const preview = async (extra = {}) =>
      (await t.post(faculty, "/console/assignments/remedial/preview", { skillIds: [SKILL], unitIds: [unitA], below: 40, ...extra })).body.students as { id: string; name: string; mastery: number }[];
    const weak = await preview();
    expect(weak.find((s) => s.id === ids.low)).toMatchObject({ name: "Low Lata", mastery: 25, attempts: 6 });
    expect(weak.some((s) => s.id === ids.mid)).toBe(false); // 50% is above the line
    expect(weak.some((s) => s.id === ids.new)).toBe(false); // never tried: a different problem
    expect((await preview({ includeUnpractised: true })).some((s) => s.id === ids.new)).toBe(true);
    expect((await preview({ below: 60 })).some((s) => s.id === ids.mid)).toBe(true);
    expect((await t.post(faculty, "/console/assignments/remedial/preview", { skillIds: ["nope.skill"], unitIds: [unitA] })).status).toBe(400);
    // Faculty only see their own sections.
    const other = ((await t.get(await t.login("tpo@demo.edu"), "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "ECE 2027 - A")!.id;
    expect((await t.post(faculty, "/console/assignments/remedial/preview", { skillIds: [SKILL], unitIds: [other] })).status).toBe(403);
  });

  it("sets work for just those students, who are the only ones to see it", async () => {
    // Staff can untick students from the preview, but can't add one who isn't weak.
    const res = await t.post(faculty, "/console/assignments/remedial", { title: "Time and work catch-up", skillIds: [SKILL], unitIds: [unitA], below: 40, count: 4, studentIds: [ids.low, ids.mid], ...window });
    expect(res.status).toBe(200);
    expect(res.body.assignment.students).toBe(1);
    id = res.body.assignment.id;
    expect((await t.post(faculty, "/console/assignments/remedial", { title: "Nobody", skillIds: [SKILL], unitIds: [unitA], below: 10, ...window })).status).toBe(400);

    expect((await t.get(tokens.low!, "/student/assignments")).body.assignments.map((a: { id: string }) => a.id)).toContain(id);
    expect((await t.get(tokens.mid!, "/student/assignments")).body.assignments.map((a: { id: string }) => a.id)).not.toContain(id);
    expect((await t.post(tokens.mid!, "/student/sessions", { kind: "assignment", assignmentId: id })).status).toBe(403);

    const list = (await t.get(faculty, "/console/assignments")).body.assignments.find((a: { id: string }) => a.id === id);
    expect(list).toMatchObject({ remedial: true, targeted: 1, started: 0 });
  });

  it("shows how far each student has come since it was set", async () => {
    let s = (await t.post(tokens.low!, "/student/sessions", { kind: "assignment", assignmentId: id })).body;
    while (!s.finished) {
      const qid = s.question.id;
      s = (await t.post(tokens.low!, `/student/sessions/${s.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 20_000 })).body.session;
    }
    const detail = (await t.get(faculty, `/console/assignments/${id}`)).body;
    expect(detail.remedial).toMatchObject({ skills: [{ id: SKILL, name: "Time, speed and work" }], below: 40, avgBefore: 25, improved: 1 });
    expect(detail.remedial.avgNow).toBeGreaterThan(25);
    expect(detail.students).toEqual([expect.objectContaining({ id: ids.low, status: "completed", masteryBefore: 25, masteryNow: detail.remedial.avgNow })]);
  });
});
