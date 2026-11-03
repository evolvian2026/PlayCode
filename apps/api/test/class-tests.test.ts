import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, questions, users } from "../src/db/schema";
import { markAnswers, setKey, type KeyItem } from "../src/services/paper-results";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let faculty: string;
let riya: string;
let unitA: string;
let paperId: string;
let keyA: KeyItem[];
let keyB: KeyItem[];
let riyaId: string;
let aaravId: string;

/** Answers for a key: right on the first `right` questions, then wrong, with the last left blank. */
function typed(key: KeyItem[], right: number) {
  return key
    .map((k, i) => {
      if (i === key.length - 1) return "-";
      if (i < right) return k.expect;
      return k.kind === "option" ? "abcdefgh".slice(0, k.options).replace(k.expect, "")[0] : "n";
    })
    .join("");
}

beforeAll(async () => {
  t = await setup();
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  unitA = ((await t.get(faculty, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  const paper = (await t.post(faculty, "/console/papers", { title: "Unit test 2", durationMinutes: 30, marksPerQuestion: 2, sets: 2, picks: [{ skillId: "strings.basics", count: 3 }, { skillId: "dbms.keys", count: 3 }] })).body;
  paperId = paper.id;
  const qs = await db.select().from(questions).where(inArray(questions.id, paper.items.map((i: { id: string }) => i.id)));
  const ordered = paper.items.map((i: { id: string }) => qs.find((q) => q.id === i.id)!);
  keyA = setKey(paperId, ordered, "A");
  keyB = setKey(paperId, ordered, "B");
  const ids = await Promise.all(["student@demo.edu", "aarav.sharma1@demo.edu"].map(async (e) => (await db.select().from(users).where(eq(users.email, e)))[0]!.id));
  riyaId = ids[0]!;
  aaravId = ids[1]!;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("marking typed answers", () => {
  const key: KeyItem[] = [
    { questionId: "q1", kind: "option", options: 4, expect: "b" },
    { questionId: "q2", kind: "mark", options: 0, expect: "y" },
    { questionId: "q3", kind: "option", options: 3, expect: "c" },
  ];
  it("marks letters and y/n, ignoring case, spaces and commas", () => {
    expect(markAnswers(key, "B, y -")).toEqual({ answers: "by-", outcomes: { q1: "right", q2: "right", q3: "blank" }, right: 2 });
    expect(markAnswers(key, "ana").outcomes).toEqual({ q1: "wrong", q2: "wrong", q3: "wrong" });
  });
  it("says which question is wrong", () => {
    expect(() => markAnswers(key, "by")).toThrow(/each of the 3 questions/);
    expect(() => markAnswers(key, "byd")).toThrow(/Question 3: "d" isn't allowed; use a to c/);
    expect(() => markAnswers(key, "bxc")).toThrow(/Question 2: "x".*y \(right\) or n \(wrong\)/);
  });
});

describe("class test results", () => {
  it("gives a marks sheet for a section, with the format of each set", async () => {
    const sheet = (await t.get(faculty, `/console/papers/${paperId}/results?unitId=${unitA}`)).body;
    expect(sheet.paper).toMatchObject({ questions: 6, marks: 12, sets: 2 });
    expect(sheet.format.A).toHaveLength(6);
    expect(sheet.format.B).toHaveLength(6);
    expect(sheet.students.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([riyaId, aaravId]));
    expect(sheet.students.every((s: { result: unknown }) => s.result === null)).toBe(true);
    expect((await t.get(faculty, `/console/papers/${paperId}/results`)).status).toBe(400); // a section is required
  });

  it("marks each student against their set's key, and reports bad rows", async () => {
    const res = await t.post(faculty, `/console/papers/${paperId}/results`, {
      entries: [
        { userId: riyaId, set: "A", answers: typed(keyA, 4) },
        { userId: aaravId, set: "B", answers: typed(keyB, 2) },
        { userId: riyaId, set: "B", answers: "abc" }, // a typo in the same batch
      ],
    });
    expect(res.body.saved).toBe(2);
    expect(res.body.errors).toEqual([{ userId: riyaId, message: expect.stringContaining("6 questions") }]);
    const sheet = (await t.get(faculty, `/console/papers/${paperId}/results?unitId=${unitA}`)).body;
    expect(sheet.students.find((s: { id: string }) => s.id === riyaId).result).toMatchObject({ set: "A", score: 8 });
    expect(sheet.students.find((s: { id: string }) => s.id === aaravId).result).toMatchObject({ set: "B", score: 4 });
    // Another college's student, or a student outside the teacher's sections, can't be entered.
    const kavya = (await db.select().from(users).where(eq(users.email, "kavya.singh8@demo.edu")))[0]!.id;
    expect((await t.post(faculty, `/console/papers/${paperId}/results`, { entries: [{ userId: kavya, set: "A", answers: typed(keyA, 1) }] })).body.errors[0].message).toContain("isn't in your");
  });

  it("tells the student once, without a score that a correction could make stale", async () => {
    await t.post(faculty, `/console/papers/${paperId}/results`, { entries: [{ userId: riyaId, set: "A", answers: typed(keyA, 5) }] });
    const notes = (await db.select().from(notifications).where(eq(notifications.userId, riyaId))).filter((n) => n.template === "class_test");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: "Class test result: Unit test 2", body: expect.not.stringContaining("/12") });
  });

  it("reports how the class did on each question and skill", async () => {
    const report = (await t.get(faculty, `/console/papers/${paperId}/report?unitId=${unitA}`)).body;
    expect(report).toMatchObject({ entered: 2, average: 7, highest: 10, lowest: 4 });
    expect(report.distribution).toEqual([0, 1, 0, 0, 1]); // 33% and 83%
    expect(report.questions).toHaveLength(6);
    // Riya left the last question of set A blank; Aarav, in set B, may have answered it.
    expect(report.questions.find((q: { id: string }) => q.id === keyA.at(-1)!.questionId).blankPct).toBeGreaterThanOrEqual(50);
    expect(report.skills.map((s: { id: string }) => s.id).sort()).toEqual(["dbms.keys", "strings.basics"]);
    expect(report.results[0]).toMatchObject({ userId: aaravId, score: 4, pct: 33 });
  });

  it("shows the student every question with their answer and the right one", async () => {
    const list = (await t.get(riya, "/student/class-tests")).body.tests;
    expect(list).toEqual([expect.objectContaining({ title: "Unit test 2", score: 10, marks: 12, pct: 83 })]);
    const detail = (await t.get(riya, `/student/class-tests/${list[0].id}`)).body;
    expect(detail).toMatchObject({ set: "A", score: 10, classAverage: null }); // too few results for an average
    expect(detail.items.map((i: { outcome: string }) => i.outcome)).toEqual(["right", "right", "right", "right", "right", "blank"]);
    expect(detail.items[0]).toMatchObject({ n: 1, correctAnswer: expect.any(String), explanation: expect.any(String) });
    expect((await t.get(await t.login("aarav.sharma1@demo.edu"), `/student/class-tests/${list[0].id}`)).status).toBe(404);
  });

  it("clears a result when the answers are emptied", async () => {
    await t.post(faculty, `/console/papers/${paperId}/results`, { entries: [{ userId: aaravId, set: "B", answers: "" }] });
    expect((await t.get(faculty, `/console/papers/${paperId}/report?unitId=${unitA}`)).body.entered).toBe(1);
  });
});
