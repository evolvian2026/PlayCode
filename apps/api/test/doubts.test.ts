import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { memberships, notifications, questions, responses, users } from "../src/db/schema";
import { studentIdsInUnits } from "../src/services/scope";
import { rightAnswer, setup, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let classmate: string;
let faculty: string;
let questionId: string;

/** Answer the first question of today's daily challenge (the same five for everyone in the college). */
async function answerFirstDaily(token: string, correct: boolean) {
  const s = (await t.post(token, "/student/sessions", { kind: "daily" })).body;
  const qid = s.question.id as string;
  await t.post(token, `/student/sessions/${s.id}/answer`, { questionId: qid, response: correct ? rightAnswer(qid) : wrongAnswer(qid), timeMs: 20_000 });
  return qid;
}

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  faculty = await t.login("faculty@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("doubts", () => {
  let id: string;

  it("lets a student ask about a question they've answered", async () => {
    // The seeded practice history shifts whenever the question bank changes, so find a question Riya really hasn't answered.
    const riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
    const answered = new Set((await db.select({ id: responses.questionId }).from(responses).where(eq(responses.userId, riyaId))).map((r) => r.id));
    const unseen = (await db.select({ id: questions.id }).from(questions)).find((q) => !answered.has(q.id))!.id;
    expect((await t.post(riya, `/student/questions/${unseen}/doubts`, { text: "Why is this the answer?" })).status).toBe(403);
    questionId = await answerFirstDaily(riya, false);
    // Today's daily depends on the tenant id, which changes with every seed, so pick a sectionmate who hasn't seen it yet.
    const [mine] = await db.select().from(memberships).where(eq(memberships.userId, riyaId));
    const seen = new Set((await db.select({ id: responses.userId }).from(responses).where(eq(responses.questionId, questionId))).map((r) => r.id));
    const mateId = (await studentIdsInUnits(db, mine!.tenantId!, [mine!.orgUnitId!])).find((id) => !seen.has(id))!;
    classmate = await t.login((await db.select().from(users).where(eq(users.id, mateId)))[0]!.email);
    expect((await t.post(riya, `/student/questions/${questionId}/doubts`, { text: "Hm" })).status).toBe(400); // too short
    const res = await t.post(riya, `/student/questions/${questionId}/doubts`, { text: "I don't see why my answer is wrong. Can you explain the second step?" });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body).toMatchObject({ status: "open", answer: null });
  });

  it("sends it to the student's teachers, with what they answered", async () => {
    const list = (await t.get(faculty, "/console/doubts")).body;
    const d = list.doubts.find((x: { id: string }) => x.id === id);
    expect(d).toMatchObject({ student: { name: "Riya Kapoor" }, question: { id: questionId }, lastAnswer: { correct: false }, status: "open" });
    expect(d.question.correctAnswer.length).toBeGreaterThan(0);
    expect((await t.get(faculty, "/console/doubts/count")).body.open).toBe(1);
    // Students and other colleges' staff can't see it.
    expect((await t.get(riya, "/console/doubts")).status).toBe(403);
    expect((await t.get(await t.login("admin@sunrise.edu"), "/console/doubts")).body.doubts).toEqual([]);
    expect((await t.post(await t.login("admin@sunrise.edu"), `/console/doubts/${id}/answer`, { answer: "No." })).status).toBe(404);
  });

  it("notifies the student when a teacher answers", async () => {
    const res = await t.post(faculty, `/console/doubts/${id}/answer`, { answer: "Trace the loop: after the second pass i is 4, not 3, because it starts at 0.", shared: true });
    expect(res.body.status).toBe("answered");
    const riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
    const note = (await db.select().from(notifications).where(eq(notifications.userId, riyaId))).find((n) => n.template === "doubt");
    expect(note).toMatchObject({ title: "Prof. Anil Kumar answered your doubt" });
    expect((await t.get(riya, "/student/doubts")).body.doubts[0]).toMatchObject({ id, status: "answered", answer: expect.stringContaining("Trace the loop") });
    expect((await t.get(faculty, "/console/doubts/count")).body.open).toBe(0);
  });

  it("shows shared answers, without names, only after a classmate answers the question too", async () => {
    expect((await t.get(classmate, `/student/questions/${questionId}/doubts`)).status).toBe(403);
    expect(await answerFirstDaily(classmate, true)).toBe(questionId);
    const view = (await t.get(classmate, `/student/questions/${questionId}/doubts`)).body;
    expect(view.mine).toEqual([]);
    expect(view.shared).toEqual([{ id, text: expect.stringContaining("second step"), answer: expect.stringContaining("Trace the loop"), answeredAt: expect.any(String) }]);
    expect(JSON.stringify(view)).not.toContain("Riya");
  });

  it("lets a teacher close a doubt that isn't one", async () => {
    const asked = (await t.post(classmate, `/student/questions/${questionId}/doubts`, { text: "Is there a contest this week?" })).body;
    expect((await t.post(faculty, `/console/doubts/${asked.id}/close`)).body.status).toBe("closed");
    expect((await t.post(faculty, `/console/doubts/${asked.id}/answer`, { answer: "Yes, Friday." })).status).toBe(409);
    expect((await t.get(faculty, "/console/doubts?status=closed")).body.doubts.map((d: { id: string }) => d.id)).toEqual([asked.id]);
  });
});
