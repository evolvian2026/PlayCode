import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { trainingReminders } from "../src/services/training";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let id: string;
let attendees: { id: string; email: string; token: string }[] = [];
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const rate = (token: string, r: Partial<{ content: number; delivery: number; relevance: number; comment: string }> = {}) => t.put(token, `/student/training/${id}/feedback`, { content: 4, delivery: 4, relevance: 4, comment: "", ...r });

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  const unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  id = (await t.post(tpo, "/console/training", { title: "Quant: time and work", kind: "aptitude", trainer: "Mr. Suresh Iyer", location: "Seminar hall 1", durationMinutes: 90, startsAt: at(30).toISOString(), unitIds: [unitA] })).body.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("training feedback", () => {
  it("lets only students who attended rate a session", async () => {
    const riya = await t.login("student@demo.edu");
    expect((await rate(riya)).status).toBe(403); // not started, not attended
    t.clock.now = at(40);
    const detail = (await t.get(tpo, `/console/training/${id}`)).body;
    const ids = detail.students.slice(0, 4).map((s: { id: string }) => s.id);
    for (const uid of ids) expect((await t.post(tpo, `/console/training/${id}/attendance`, { userId: uid, present: true })).status).toBe(200);
    const people = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids));
    attendees = await Promise.all(people.map(async (p) => ({ ...p, token: await t.login(p.email) })));
    expect((await rate(await t.login("kavya.singh8@demo.edu"))).status).toBe(403); // not invited, so never attended
    const absent = detail.students.find((s: { id: string }) => !ids.includes(s.id));
    const [a] = await db.select().from(users).where(eq(users.id, absent.id));
    expect((await rate(await t.login(a!.email))).status).toBe(403);
    expect((await rate(attendees[0]!.token, { content: 6 })).status).toBe(400);
    expect((await rate(attendees[0]!.token, { content: 5, delivery: 4, relevance: 5, comment: "Great shortcuts for work problems." })).status).toBe(200);
    const mine = (await t.get(attendees[0]!.token, "/student/training")).body;
    expect([...mine.upcoming, ...mine.past].find((s: { id: string }) => s.id === id)).toMatchObject({ attended: true, feedback: "given" });
    const other = (await t.get(attendees[1]!.token, "/student/training")).body;
    expect([...other.upcoming, ...other.past].find((s: { id: string }) => s.id === id).feedback).toBe("open");
  });

  it("shows staff the ratings only once three are in, without names", async () => {
    expect((await t.get(tpo, `/console/training/${id}`)).body.feedback).toEqual({ responses: 1, shown: false });
    await rate(attendees[1]!.token, { content: 4, delivery: 3, relevance: 4, comment: "Too fast in the second half." });
    await rate(attendees[2]!.token, { content: 3, delivery: 3, relevance: 4 });
    const fb = (await t.get(tpo, `/console/training/${id}`)).body.feedback;
    expect(fb).toEqual({ responses: 3, shown: true, overall: 3.9, averages: { content: 4, delivery: 3.3, relevance: 4.3 }, comments: ["Great shortcuts for work problems.", "Too fast in the second half."] });
    // Rating again replaces the earlier answers.
    await rate(attendees[2]!.token, { content: 4, delivery: 3, relevance: 4 });
    expect((await t.get(tpo, `/console/training/${id}`)).body.feedback.responses).toBe(3);
  });

  it("asks attendees who haven't rated, once, after the session", async () => {
    const ask = async () => (await db.select().from(notifications).where(eq(notifications.userId, attendees[3]!.id))).filter((n) => n.title.startsWith("How was"));
    await trainingReminders(db, at(100)); // still running
    expect(await ask()).toEqual([]);
    expect(await trainingReminders(db, at(180))).toBe(1);
    expect(await trainingReminders(db, at(240))).toBe(0);
    expect(await ask()).toHaveLength(1);
    const rated = (await db.select().from(notifications).where(eq(notifications.userId, attendees[0]!.id))).filter((n) => n.title.startsWith("How was"));
    expect(rated).toEqual([]);
  });

  it("reports per trainer and in the accreditation report", async () => {
    t.clock.now = at(300);
    const report = (await t.get(tpo, "/console/training/feedback")).body;
    expect(report.trainers).toEqual([expect.objectContaining({ trainer: "Mr. Suresh Iyer", sessions: 1, attended: 4, responses: 3, shown: true, overall: 4 })]);
    expect(report.trainers[0].comments).toBeUndefined();
    const activity = (await t.get(tpo, "/console/activity-report")).body;
    expect(activity.training.sessions.find((s: { id: string }) => s.id === id).rating).toBe(4);
    expect(activity.training.totals.feedback).toMatchObject({ responses: 3, overall: 4 });
    const csv = (await t.app.inject({ method: "GET", url: "/console/activity-report?format=csv", headers: { authorization: `Bearer ${tpo}` } })).body;
    expect(csv).toContain("Student rating (of 5)");
  });

  it("drops a rating when staff untick the student, and closes after a week", async () => {
    expect((await t.post(tpo, `/console/training/${id}/attendance`, { userId: attendees[1]!.id, present: false })).status).toBe(200);
    expect((await t.get(tpo, `/console/training/${id}`)).body.feedback).toEqual({ responses: 2, shown: false });
    t.clock.now = at(120 + 7 * 24 * 60 + 5);
    expect((await rate(attendees[3]!.token)).status).toBe(400);
    expect((await t.get(attendees[0]!.token, "/privacy/export")).body.trainingFeedback).toEqual([expect.objectContaining({ session: "Quant: time and work", content: 5 })]);
  });
});
