import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { memberships, notifications, orgUnits } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

// The seed has CSE 2026, graduated in June: six graduates, four survey
// answers, three on the alumni list. graduate@demo.edu hasn't answered yet.
let t: TestApp;
let admin: string;
let tpo: string;
let faculty: string;
let grad: string;
let riya: string;
const DAY = 86_400_000;
const batchId = async (name: string) => (await db.select().from(orgUnits).where(eq(orgUnits.name, name)))[0]!.id;

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  grad = await t.login("graduate@demo.edu");
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("graduates' accounts", () => {
  it("are read-only, apart from what graduates still need", async () => {
    expect((await t.get(grad, "/me")).body.graduatedAt).toBe("2026-06-20T06:30:00.000Z");
    expect((await t.get(riya, "/me")).body.graduatedAt).toBeNull();
    const practice = await t.post(grad, "/student/peer/request", { track: "hr", mode: "online", windows: [{ date: "2026-10-23", slot: "evening" }] });
    expect(practice.status).toBe(403);
    expect(practice.body.error.code).toBe("graduated");
    expect((await t.get(grad, "/student/resume")).status).toBe(200);
    expect((await t.put(grad, "/student/settings", {})).status).not.toBe(403);
  });

  it("are asked to join the alumni list, which juniors then see", async () => {
    const g = (await t.get(grad, "/student/graduation")).body;
    expect(g.graduated).not.toBeNull();
    expect(g.alumni).toMatchObject({ choice: null, entry: null, prefill: { name: "Arjun Nair", email: "graduate@demo.edu", graduationYear: 2026, department: "Computer Science" } });
    expect((await t.get(riya, "/student/graduation")).body).toEqual({ graduated: null });
    const join = (body: object) => t.post(grad, "/student/graduation/alumni", { email: "arjun.nair@gmail.example", company: "Zoho", role: "Member Technical Staff", city: "Chennai", openToReferrals: false, openToAdvice: true, ...body });
    expect((await join({ openToAdvice: false })).status).toBe(400);
    expect((await join({})).body.alumni).toMatchObject({ choice: "joined", entry: { company: "Zoho", email: "arjun.nair@gmail.example" } });
    expect((await join({ openToReferrals: true })).body.alumni.entry.openToReferrals).toBe(true); // updates, doesn't add another
    const juniors = (await t.get(riya, "/student/alumni")).body.alumni;
    expect(juniors.filter((a: { name: string }) => a.name === "Arjun Nair")).toHaveLength(1);
    expect(juniors[0]).not.toHaveProperty("email");
    await t.post(grad, "/student/graduation/alumni/decline", {});
    expect((await t.get(riya, "/student/alumni")).body.alumni.map((a: { name: string }) => a.name)).not.toContain("Arjun Nair");
    expect((await t.post(riya, "/student/graduation/alumni", { email: "r@x.example", company: "X", openToReferrals: true, openToAdvice: true })).status).toBe(400);
  });

  it("answer the exit survey once", async () => {
    const answer = { ratings: { training: 3, practice: 4, information: 2, support: 4, overall: 3 }, recommend: true, comment: "Tell us about drives earlier." };
    expect((await t.post(grad, "/student/graduation/survey", { ...answer, ratings: { training: 3 } })).status).toBe(400);
    expect((await t.post(grad, "/student/graduation/survey", answer)).body.survey.done).toBe(true);
    expect((await t.post(grad, "/student/graduation/survey", answer)).status).toBe(409);
  });
});

describe("graduating a batch", () => {
  it("shows each batch, and for graduated ones the survey without names", async () => {
    const res = await t.get(tpo, "/console/graduation");
    const cse26 = res.body.batches.find((b: { name: string }) => b.name === "CSE 2026");
    expect(cse26).toMatchObject({ current: 0, graduated: 6, alumniJoined: 3, graduation: { by: "Institute Admin", canUndo: false } });
    expect(cse26.survey.responses).toBe(5);
    expect(cse26.survey.averages.overall).toBe(3.6);
    expect(cse26.survey.recommendPct).toBe(80);
    // Sorted by text, not by when they came in.
    expect(cse26.survey.comments).toEqual([...cse26.survey.comments].sort((a: string, b: string) => a.localeCompare(b)));
    expect(cse26.survey.comments).toContain("Tell us about drives earlier.");
    expect(JSON.stringify(res.body)).not.toContain("Arjun");
    expect((await t.get(faculty, "/console/graduation")).status).toBe(403);
    const report = (await t.get(tpo, "/console/activity-report?year=2026-27")).body;
    expect(report.exitSurvey).toMatchObject({ responses: 5, recommendPct: 80 });
  });

  it("makes a batch read-only and frees its seats, and can be undone for two weeks", async () => {
    const ece = await batchId("ECE 2027");
    const seats = async () => (await t.get(admin, "/console/billing")).body.usage.seats.used;
    const before = await seats();
    const preview = (await t.get(admin, `/console/graduation/${ece}/preview`)).body;
    expect(preview.students).toBeGreaterThan(0);
    expect(preview.seatsFreed).toBe(preview.students);
    expect((await t.post(await t.login("hod.cse@demo.edu"), `/console/graduation/${ece}`, {})).status).toBe(403);
    expect((await t.post(admin, `/console/graduation/${ece}`, {})).body.graduated).toBe(preview.students);
    expect(await seats()).toBe(before - preview.seatsFreed);
    expect((await t.post(admin, `/console/graduation/${ece}`, {})).status).toBe(409);
    const graduated = await db.select().from(memberships).where(and(eq(memberships.orgUnitId, (await batchId("ECE 2027 - A"))), isNotNull(memberships.graduatedAt)));
    expect(graduated).toHaveLength(preview.students);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, graduated[0]!.userId), eq(notifications.title, "Congratulations on graduating")));
    expect(note).toBeDefined();
    // Graduates no longer show among current students.
    const overview = (await t.get(admin, "/console/graduation")).body.batches.find((b: { name: string }) => b.name === "ECE 2027");
    expect(overview).toMatchObject({ current: 0, graduated: preview.students, graduation: { canUndo: true } });

    t.clock.now = new Date(START.getTime() + 3 * DAY);
    expect((await t.post(admin, `/console/graduation/records/${overview.graduation.id}/undo`, {})).body.restored).toBe(preview.students);
    expect(await seats()).toBe(before);
    expect((await t.post(admin, `/console/graduation/records/${overview.graduation.id}/undo`, {})).status).toBe(404);

    await t.post(admin, `/console/graduation/${ece}`, {});
    const again = (await t.get(admin, "/console/graduation")).body.batches.find((b: { name: string }) => b.name === "ECE 2027");
    t.clock.now = new Date(START.getTime() + 18 * DAY);
    expect((await t.post(admin, `/console/graduation/records/${again.graduation.id}/undo`, {})).status).toBe(400);
  });
});
