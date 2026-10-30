import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { adaptiveAttempts, notifications, orgUnits, users } from "../src/db/schema";
import { eligibilityChecker } from "../src/services/placements";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let riyaId: string;
let tenantId: string;
let sitting: string;
const HOUR = 3_600_000;

async function finish(token: string, id: string) {
  let view = (await t.get(token, `/student/aptitude/tests/${id}`)).body;
  while (view.status === "in_progress") {
    const [row] = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.id, id));
    const answer = row!.sections.find((s) => !s.done)!.items.at(-1)!.answer;
    view = (await t.post(token, `/student/aptitude/tests/${id}/answer`, { number: view.question.number, chosen: view.question.number % 3 === 0 ? (answer + 1) % 4 : answer })).body;
  }
  return view;
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
  riyaId = u!.id;
  tenantId = u!.tenantId!;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("official aptitude sittings", () => {
  it("are opened by the placement cell for chosen batches, who are told", async () => {
    const [cse27] = await db.select().from(orgUnits).where(eq(orgUnits.name, "CSE 2027"));
    const body = { title: "November aptitude sitting", unitIds: [cse27!.id], opensAt: START.toISOString(), closesAt: new Date(START.getTime() + 3 * HOUR).toISOString() };
    expect((await t.post(faculty, "/console/aptitude/sittings", body)).status).toBe(403);
    expect((await t.post(tpo, "/console/aptitude/sittings", { ...body, closesAt: body.opensAt })).status).toBe(400);
    const res = (await t.post(tpo, "/console/aptitude/sittings", body)).body;
    sitting = res.id;
    expect(res.invited).toBeGreaterThan(10);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Official aptitude test:%")));
    expect(note).toBeDefined();
    expect((await t.get(riya, "/student/aptitude")).body.sittings).toEqual([expect.objectContaining({ id: sitting, attempt: null })]);
    // ECE isn't invited.
    expect((await t.get(await t.login("kavya.singh8@demo.edu"), "/student/aptitude")).body.sittings).toEqual([]);
  });

  it("give one attempt, which takes over from a practice test left open", async () => {
    const practice = (await t.post(riya, "/student/aptitude/tests", {})).body.id;
    const official = (await t.post(riya, "/student/aptitude/tests", { sittingId: sitting })).body.id;
    expect(official).not.toBe(practice);
    const [p] = await db.select().from(adaptiveAttempts).where(eq(adaptiveAttempts.id, practice));
    expect(p!.status).toBe("finished");
    expect((await t.post(riya, "/student/aptitude/tests", { sittingId: sitting })).body.id).toBe(official); // resumes
    expect((await t.post(riya, "/student/aptitude/tests", {})).body.id).toBe(official); // practice waits
    const result = await finish(riya, official);
    expect(result).toMatchObject({ status: "finished", official: true });
    expect((await t.post(riya, "/student/aptitude/tests", { sittingId: sitting })).status).toBe(409);
    const hub = (await t.get(riya, "/student/aptitude")).body;
    expect(hub.official.score).toBe(result.score);
    expect(hub.attempts.find((a: { id: string }) => a.id === official).official).toBe(true);
    expect(hub.attempts.find((a: { id: string }) => a.id === practice).official).toBe(false);
  });

  it("put the official score on the resume, and show staff the sitting's results", async () => {
    const { resume } = (await t.get(riya, "/student/resume")).body;
    expect(resume.aptitude).toMatchObject({ score: expect.any(Number), quant: expect.any(Number), reasoning: expect.any(Number) });
    const r = (await t.get(faculty, `/console/aptitude/sittings/${sitting}`)).body;
    // Faculty see their own section only.
    expect(r.students.every((s: { rollNo: string }) => s.rollNo.startsWith("CSE27A"))).toBe(true);
    expect(r.students[0]).toMatchObject({ name: "Riya Kapoor", status: "finished" });
    expect(r.students.at(-1).status).toBe("not_started");
    const list = (await t.get(tpo, "/console/aptitude/sittings")).body.sittings;
    expect(list[0]).toMatchObject({ id: sitting, state: "open", started: 1, finished: 1 });
    const csv = await t.app.inject({ method: "GET", url: `/console/aptitude/sittings/${sitting}/csv`, headers: { authorization: `Bearer ${tpo}` } });
    expect(csv.body.split("\n")[0]).toBe("roll_no,name,status,score,quantitative,reasoning,band");
    const scores = (await t.get(tpo, "/console/aptitude")).body.students.find((s: { name: string }) => s.name === "Riya Kapoor");
    expect(scores.official.score).toBe(resume.aptitude.score);
  });

  it("let a drive ask for a minimum score, which practice attempts don't meet", async () => {
    const check = await eligibilityChecker(db, tenantId, riyaId, t.clock.now);
    const mine = (await t.get(riya, "/student/aptitude")).body.official.score;
    expect(check({ unitIds: [], minAptitude: mine }, null).reasons).not.toContainEqual(expect.stringContaining("aptitude"));
    expect(check({ unitIds: [], minAptitude: mine + 5 }, null).reasons).toContain(`Needs an aptitude score of ${mine + 5} or more (yours is ${mine})`);
    // Aarav has a practice attempt from the seed, but no official one.
    const [aarav] = await db.select().from(users).where(eq(users.email, "aarav.sharma1@demo.edu"));
    const his = await eligibilityChecker(db, tenantId, aarav!.id, t.clock.now);
    expect(his({ unitIds: [], minAptitude: 300 }, null).reasons).toContain("Needs a PlayCode aptitude score from an official sitting at your college");
  });

  it("can be closed early", async () => {
    await t.post(tpo, `/console/aptitude/sittings/${sitting}/close`, {});
    expect((await t.get(riya, "/student/aptitude")).body.sittings).toEqual([]);
    const other = await t.login("aarav.sharma1@demo.edu");
    expect((await t.post(other, "/student/aptitude/tests", { sittingId: sitting })).status).toBe(404);
    expect((await t.post(tpo, `/console/aptitude/sittings/${sitting}/close`, {})).status).toBe(409);
  });
});
