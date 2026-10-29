import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { assessmentAttempts, notifications } from "../src/db/schema";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let drive: string;
let test: string;
let students: { id: string; email: string; rollNo: string; token: string }[] = [];
let kavya: string;
const MIN = 60_000;
const DAY = 86_400_000;
type App = { status: string; roundsCleared: number; test: { id: string; title: string } | null; slots: { feedback: { ratings: Record<string, number>; workOn: string } | null }[] };
const mine = async (token: string) => ((await t.get(token, "/student/placements")).body.drives as { id: string; application: App | null }[]).find((d) => d.id === drive)!.application!;

async function take(token: string, right: number) {
  const attempt = (await t.post(token, `/student/assessments/${test}/start`, { deviceId: `dev-${token.slice(-8)}` })).body;
  for (const [i, q] of (attempt.questions as { question: { id: string } }[]).entries()) {
    await t.put(token, `/student/attempts/${attempt.id}/answers`, { questionId: q.question.id, response: i < right ? rightAnswer(q.question.id) : wrongAnswer(q.question.id) });
  }
  await t.post(token, `/student/attempts/${attempt.id}/submit`, {});
  return attempt.id as string;
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  const units = Object.fromEntries((await t.get(tpo, "/console/org-units")).body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
  test = (
    await t.post(tpo, "/console/assessments", {
      title: "Juspay online test",
      durationMinutes: 30,
      openAt: new Date(START.getTime() - MIN).toISOString(),
      closeAt: new Date(START.getTime() + 120 * MIN).toISOString(),
      unitIds: [units["CSE 2027 - A"]],
      sections: [{ title: "Aptitude for code", skillIds: ["loops.for", "loops.while", "arrays.basics"], pick: 4, marks: 1, negative: 0 }],
    })
  ).body.assessment.id;
  drive = (
    await t.post(tpo, "/console/placements", {
      company: "Juspay",
      companyType: "product",
      roleTitle: "Software engineer",
      ctcRupees: 900_000,
      driveDate: "2026-10-30",
      registerBy: new Date(START.getTime() + DAY).toISOString(),
      criteria: { unitIds: [], allowPlaced: true },
      rounds: ["Online test", "Technical interview"],
    })
  ).body.drive.id;
  const list = ((await t.get(tpo, "/console/students")).body.students as { id: string; email: string; rollNo: string; unitName: string }[]).filter((s) => s.unitName === "CSE 2027 - A").sort((a, b) => a.rollNo.localeCompare(b.rollNo)).slice(0, 4);
  for (const s of list) {
    const token = await t.login(s.email);
    await t.post(token, `/student/placements/${drive}/register`, {});
    students.push({ ...s, token });
  }
  kavya = await t.login("kavya.singh8@demo.edu");
  await t.post(kavya, `/student/placements/${drive}/register`, {});
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("a drive round taken as a PlayCode test", () => {
  it("links the test to the round, and students see it on the drive card", async () => {
    expect((await t.put(tpo, `/console/placements/${drive}/round-tests/5`, { assessmentId: test, cutoffPct: 50 })).status).toBe(400);
    const res = await t.put(tpo, `/console/placements/${drive}/round-tests/0`, { assessmentId: test, cutoffPct: 50 });
    expect(res.body.rounds[0]).toMatchObject({ roundName: "Online test", cutoffPct: 50, test: { title: "Juspay online test", closed: false } });
    expect((await mine(students[0]!.token)).test).toMatchObject({ id: test, title: "Juspay online test" });
  });

  it("previews results against the cut-off, holding back risky attempts", async () => {
    await take(students[0]!.token, 3); // 75%
    await take(students[1]!.token, 1); // 25%
    const risky = await take(students[3]!.token, 4);
    await db.update(assessmentAttempts).set({ riskScore: 80 }).where(eq(assessmentAttempts.id, risky));
    const [r] = (await t.get(tpo, `/console/placements/${drive}/round-tests`)).body.rounds;
    expect(r.counts).toMatchObject({ pass: 1, fail: 1, review: 1, not_taken: 1, not_invited: 1 });
    expect(r.students[0]).toMatchObject({ userId: students[3]!.id, result: "review", pct: 100 });
    expect((await t.post(tpo, `/console/placements/${drive}/round-tests/0/apply`, {})).status).toBe(400); // still open
  });

  it("moves students on once the test closes", async () => {
    t.clock.now = new Date(START.getTime() + 121 * MIN);
    const res = (await t.post(tpo, `/console/placements/${drive}/round-tests/0/apply`, {})).body;
    expect(res).toMatchObject({ cleared: 1, notSelected: 1 });
    expect(await mine(students[0]!.token)).toMatchObject({ status: "shortlisted", roundsCleared: 1, test: null });
    expect((await mine(students[1]!.token)).status).toBe("rejected");
    expect(await mine(students[2]!.token)).toMatchObject({ status: "registered", roundsCleared: 0 });
    expect((await mine(students[3]!.token)).roundsCleared).toBe(0); // for a person to look at
    expect(res.rounds[0].appliedAt).toBeTruthy();
  });

  it("passes interview feedback on to the student", async () => {
    const sched = (await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 1, startsAt: new Date(START.getTime() + DAY).toISOString(), slotMinutes: 30, panels: [{ name: "Panel 1", room: "Room 204", interviewer: "Ms. Priya Nair" }] })).body.schedules[0];
    const feedback = { ratings: { communication: 4, technical: 3, problemSolving: 4 }, wentWell: "Explained the approach clearly before coding.", workOn: "Revise joins and indexing in SQL." };
    expect((await t.put(tpo, `/console/placements/${drive}/schedules/${sched.id}/slots/${students[0]!.id}/feedback`, { ...feedback, ratings: { ...feedback.ratings, technical: 6 } })).status).toBe(400);
    const res = await t.put(tpo, `/console/placements/${drive}/schedules/${sched.id}/slots/${students[0]!.id}/feedback`, feedback);
    expect(res.body.schedules.find((s: { round: number }) => s.round === 1).slots[0]).toMatchObject({ status: "done", feedback: expect.objectContaining({ workOn: "Revise joins and indexing in SQL.", by: "Rajesh Sharma (TPO)" }) });
    const card = await mine(students[0]!.token);
    expect(card.slots.at(-1)!.feedback).toMatchObject({ ratings: { technical: 3 }, workOn: "Revise joins and indexing in SQL." });
    expect(JSON.stringify(card)).not.toContain("Rajesh");
    const note = (await db.select().from(notifications).where(eq(notifications.userId, students[0]!.id))).find((n) => n.title === "Feedback from your Juspay Technical interview");
    expect(note!.body).toContain("Revise joins");
    expect((await t.get(students[0]!.token, "/privacy/export")).body.driveInterviews).toEqual(expect.arrayContaining([expect.objectContaining({ company: "Juspay", feedback: expect.objectContaining({ wentWell: expect.any(String) }) })]));
  });

  it("puts the applicants' resumes in one PDF for the company", async () => {
    const res = await t.app.inject({ method: "GET", url: `/console/placements/${drive}/resume-book?stage=registered`, headers: { authorization: `Bearer ${tpo}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["x-students"]).toBe("5");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const inSelection = await t.app.inject({ method: "GET", url: `/console/placements/${drive}/resume-book?stage=in_selection`, headers: { authorization: `Bearer ${tpo}` } });
    expect(inSelection.headers["x-students"]).toBe("4");
    expect((await t.app.inject({ method: "GET", url: `/console/placements/${drive}/resume-book?stage=offered`, headers: { authorization: `Bearer ${tpo}` } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "GET", url: `/console/placements/${drive}/resume-book`, headers: { authorization: `Bearer ${await t.login("faculty@demo.edu")}` } })).statusCode).toBe(403);
  });
});
