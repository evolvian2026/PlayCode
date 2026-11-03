import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { questionReports, questions, responses, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let content: string;
let riya: string;

const question = (answer: string, stem = "What does this print?") => ({
  type: "predict_output",
  skillId: "loops.for",
  difficulty: 1,
  body: { stem, code: "for i in range(3):\n    print(i * 2, end=' ')\n", language: "python" },
  answer: { kind: "text", accepted: [answer] },
  explanation: "i takes 0, 1, 2, so it prints 0 2 4.",
  hints: [],
  tags: [],
  checkMode: "run",
});

beforeAll(async () => {
  t = await setup();
  content = await t.login("content@playcode.dev");
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("bulk import", () => {
  it("saves valid questions as drafts, runs their checks and reports the rest by position", async () => {
    const res = await t.post(content, "/console/studio/import", { questions: [question("0 2 4"), { type: "predict_output", skillId: "loops.for" }, question("0 1 2", "Wrong key")] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: 2, passed: 1 });
    const [ok, invalid, wrong] = res.body.results;
    expect(ok).toMatchObject({ index: 0, ok: true });
    expect(invalid).toMatchObject({ index: 1, id: null, ok: false });
    expect(invalid.problems.join(" ")).toContain("difficulty");
    expect(wrong.ok).toBe(false);
    expect(wrong.problems[0]).toContain("0 2 4");

    // Publishing in bulk only lets through questions that pass.
    const pub = await t.post(content, "/console/studio/publish", { ids: [ok.id, wrong.id] });
    expect(pub.body.published).toEqual([ok.id]);
    expect(pub.body.failed.map((f: { id: string }) => f.id)).toEqual([wrong.id]);
    expect((await db.select().from(questions).where(eq(questions.id, ok.id)))[0]!.status).toBe("live");
  });

  it("is limited to the bank the person manages", async () => {
    expect((await t.post(riya, "/console/studio/import", { questions: [question("0 2 4")] })).status).toBe(403);
    const hod = await t.login("hod.cse@demo.edu");
    const res = await t.post(hod, "/console/studio/import", { questions: [question("0 2 4")] });
    expect(res.body.saved).toBe(1);
    expect((await db.select().from(questions).where(eq(questions.id, res.body.results[0].id)))[0]!.tenantId).not.toBeNull();
  });
});

describe("question reports and the review queue", () => {
  let qid: string;

  it("lets students report questions they have answered", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    // A question she answered that nobody has reported yet (the seed reports one).
    const reported = new Set((await db.select({ id: questionReports.questionId }).from(questionReports)).map((r) => r.id));
    const answered = await db
      .select({ questionId: responses.questionId })
      .from(responses)
      .innerJoin(questions, eq(questions.id, responses.questionId))
      .where(and(eq(responses.userId, u!.id), eq(questions.status, "live")));
    qid = answered.find((a) => !reported.has(a.questionId))!.questionId;
    const res = await t.post(riya, `/student/questions/${qid}/report`, { reason: "wrong_answer", note: "Option b looks right to me" });
    expect(res.status).toBe(200);
    expect((await t.post(riya, `/student/questions/${qid}/report`, { reason: "typo" })).status).toBe(409);
    const seen = new Set((await db.select({ id: responses.questionId }).from(responses).where(eq(responses.userId, u!.id))).map((r) => r.id));
    const unanswered = (await db.select().from(questions).where(eq(questions.status, "live"))).find((q) => q.tenantId === null && !seen.has(q.id))!;
    expect((await t.post(riya, `/student/questions/${unanswered.id}/report`, { reason: "unclear" })).status).toBe(400);
  });

  it("puts reported and flagged questions in the content team's queue", async () => {
    const queue = (await t.get(content, "/console/studio/review")).body;
    expect(queue.analysed).toBeGreaterThan(0);
    const item = queue.questions.find((q: { id: string }) => q.id === qid);
    expect(item.flags.map((f: { id: string }) => f.id)).toContain("reported");
    // The content team sees which institution reported it, not which student.
    expect(item.reports[0]).toMatchObject({ reason: "wrong_answer", note: "Option b looks right to me", from: "Demo Institute of Technology", staleVersion: false });
    expect(JSON.stringify(item.reports)).not.toContain("Riya");
    // Every queued question has a reason to be there, most serious first.
    for (let i = 1; i < queue.questions.length; i++) expect(queue.questions[i - 1].score).toBeGreaterThanOrEqual(queue.questions[i].score);

    const resolved = await t.post(content, `/console/studio/questions/${qid}/reports`, { status: "resolved", resolution: "Checked: the key is right; explanation improved." });
    expect(resolved.body.updated).toBe(1);
    const after = (await t.get(content, "/console/studio/review")).body.questions.find((q: { id: string }) => q.id === qid);
    expect(after?.flags.map((f: { id: string }) => f.id) ?? []).not.toContain("reported");
    // Reporting again after a fix is allowed.
    expect((await t.post(riya, `/student/questions/${qid}/report`, { reason: "unclear" })).status).toBe(200);
  });
});
