import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateQuestion } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { aptitudeHomeworkWork, notifications, orgUnits, users } from "../src/db/schema";
import { homeworkReminders } from "../src/services/aptitude-homework";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let faculty: string;
let riya: string;
let aarav: string;
let riyaId: string;
let hw: string;
const HOUR = 3_600_000;

beforeAll(async () => {
  t = await setup();
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("aptitude homework", () => {
  it("is set by a teacher for their sections, who are told", async () => {
    const unit = async (name: string) => (await db.select().from(orgUnits).where(eq(orgUnits.name, name)))[0]!.id;
    const body = {
      title: "Time and work, week 1",
      unitIds: [await unit("CSE 2027 - A")],
      parts: [
        { template: "time-work", level: 2, count: 3 },
        { template: "trains", level: 3, count: 2 },
      ],
      dueAt: new Date(START.getTime() + 48 * HOUR).toISOString(),
    };
    expect((await t.post(faculty, "/console/aptitude/homework", { ...body, unitIds: [await unit("CSE 2027 - B")] })).status).toBe(400);
    expect((await t.post(faculty, "/console/aptitude/homework", { ...body, parts: [{ template: "astrology", level: 1, count: 2 }] })).status).toBe(400);
    expect((await t.post(faculty, "/console/aptitude/homework", { ...body, parts: [{ template: "trains", level: 1, count: 20 }, { template: "averages", level: 1, count: 20 }, { template: "ratios", level: 1, count: 1 }] })).status).toBe(400);
    const res = (await t.post(faculty, "/console/aptitude/homework", body)).body;
    hw = res.id;
    expect(res.invited).toBeGreaterThan(5);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Aptitude homework:%")));
    expect(note!.body).toContain("5 questions on time and work, speed, time and distance");
    expect((await t.get(riya, "/student/aptitude/homework")).body.homework).toContainEqual(expect.objectContaining({ id: hw, questions: 5, answered: 0, done: false }));
  });

  it("gives each student their own numbers, and the working after each answer", async () => {
    const mine = (await t.get(riya, `/student/aptitude/homework/${hw}`)).body;
    const his = (await t.get(aarav, `/student/aptitude/homework/${hw}`)).body;
    expect(mine.total).toBe(5);
    expect(mine.next).toMatchObject({ index: 0, topic: "Time and work" });
    expect(mine.next).not.toHaveProperty("answer");
    expect(mine.next.prompt === his.next.prompt && mine.next.options.join() === his.next.options.join()).toBe(false);
    // Opening again keeps the same questions.
    expect((await t.get(riya, `/student/aptitude/homework/${hw}`)).body.next.prompt).toBe(mine.next.prompt);

    const [work] = await db.select().from(aptitudeHomeworkWork).where(and(eq(aptitudeHomeworkWork.homeworkId, hw), eq(aptitudeHomeworkWork.userId, riyaId)));
    expect((await t.post(riya, `/student/aptitude/homework/${hw}/answer`, { index: 1, chosen: 0 })).status).toBe(409);
    let view = mine;
    for (const [i, q] of work!.questions.entries()) {
      const answer = generateQuestion(q.template, q.level, q.seed).answer;
      view = (await t.post(riya, `/student/aptitude/homework/${hw}/answer`, { index: i, chosen: i === 4 ? (answer + 1) % 4 : answer })).body;
    }
    expect(view).toMatchObject({ done: true, correct: 4, next: null });
    expect(view.answered[4]).toMatchObject({ correct: false, explanation: expect.stringContaining("m/s") });
    expect(view.topics).toEqual([
      { label: "Time and work", answered: 3, correct: 3 },
      { label: "Speed, time and distance", answered: 2, correct: 1 },
    ]);
    expect((await t.post(riya, `/student/aptitude/homework/${hw}/answer`, { index: 4, chosen: 0 })).status).toBe(409);
    expect((await t.get(await t.login("kavya.singh8@demo.edu"), `/student/aptitude/homework/${hw}`)).status).toBe(404);
  });

  it("shows teachers who has done it and how each topic went", async () => {
    const r = (await t.get(faculty, `/console/aptitude/homework/${hw}`)).body;
    expect(r.students[0]).toMatchObject({ name: "Riya Kapoor", status: "done", correct: 4, late: false });
    expect(r.students.find((s: { name: string }) => s.name === "Aarav Sharma").status).toBe("started");
    expect(r.topics).toEqual([
      { template: "time-work", label: "Time and work", answered: 3, accuracyPct: 100 },
      { template: "trains", label: "Speed, time and distance", answered: 2, accuracyPct: 50 },
    ]);
    const list = (await t.get(faculty, "/console/aptitude/homework")).body.homework;
    expect(list.find((h: { id: string }) => h.id === hw)).toMatchObject({ questions: 5, started: 2, finished: 1, averagePct: 80 });
    expect((await t.get(riya, `/console/aptitude/homework/${hw}`)).status).toBe(403);
  });

  it("reminds those who haven't finished a day before it's due, once", async () => {
    t.clock.now = new Date(START.getTime() + 36 * HOUR);
    const sent = await homeworkReminders(db, t.clock.now);
    expect(sent).toBeGreaterThan(0);
    const [mine] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Due tomorrow:%")));
    expect(mine).toBeUndefined(); // Riya has finished
    expect(await homeworkReminders(db, t.clock.now)).toBe(0);
  });

  it("feeds the batch's accuracy by topic", async () => {
    const topics = (await t.get(faculty, "/console/aptitude/topics")).body.topics;
    const tw = topics.find((x: { template: string }) => x.template === "time-work");
    expect(tw.answered).toBeGreaterThanOrEqual(3);
    expect(topics.map((x: { accuracyPct: number }) => x.accuracyPct)).toEqual([...topics.map((x: { accuracyPct: number }) => x.accuracyPct)].sort((a, b) => a - b));
  });
});
