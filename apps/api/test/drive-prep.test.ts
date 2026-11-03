import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { adaptiveAttempts, certificates, notifications, placementApplications, placementDrives, users } from "../src/db/schema";
import { setAiProvider, type AiProvider } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let riyaId: string;
let tpo: string;
let accenture: typeof placementDrives.$inferSelect;
const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 };
const notUsed = async () => {
  throw new Error("not used");
};
const fakeAi: AiProvider = {
  gdTurn: notUsed,
  gdScorecard: notUsed,
  writingFeedback: notUsed,
  jamFeedback: notUsed,
  introDraft: notUsed,
  coachHint: notUsed,
  draftQuestions: notUsed,
  draftCodingProblems: notUsed,
  draftSqlProblems: notUsed,
  reviewSnapshot: notUsed,
  weeklyInsights: notUsed,
  reviewCode: notUsed,
  interviewTurn: async () => ({ value: { message: "Explain polymorphism.", done: false }, usage }),
  interviewScorecard: async (input) => ({
    value: { scores: { problemSolving: 3, fundamentals: 3, communication: 3, code: 3 }, overall: 3, strengths: [], improvements: [], summary: "Fine.", practise: [input.skillChoices[0]!.id] },
    usage,
  }),
};
const step = (steps: { key: string; done: boolean }[], key: string) => steps.find((s) => s.key === key)?.done;

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  tpo = await t.login("tpo@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
  accenture = (await db.select().from(placementDrives).where(eq(placementDrives.company, "Accenture")))[0]!;
  setAiProvider(fakeAi);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("a student's plan for a drive", () => {
  it("is for drives they registered for", async () => {
    expect((await t.get(riya, `/student/placements/${accenture.id}/prep`)).status).toBe(404);
    await t.post(riya, `/student/placements/${accenture.id}/register`, {});
    const plan = (await t.get(riya, `/student/placements/${accenture.id}/prep`)).body;
    expect(plan.drive).toMatchObject({ company: "Accenture", packId: "mission-service-pseudocode", minAptitude: null });
    expect(plan.daysLeft).toBe(14);
    // A Thursday drive with a mission and no minimum score: on duty and the mission count, aptitude doesn't.
    expect(plan.steps.map((s: { key: string }) => s.key)).toEqual(expect.arrayContaining(["mission", "interview", "profile", "on_duty"]));
    expect(plan.steps.map((s: { key: string }) => s.key)).not.toContain("aptitude");
    expect(step(plan.steps, "interview")).toBe(false);
    expect(step(plan.steps, "on_duty")).toBe(false);
  });

  it("ticks steps off from what the student does", async () => {
    // A mock interview for this drive.
    const iv = (await t.post(riya, "/student/interviews", { track: "service", driveId: accenture.id })).body;
    await t.post(riya, `/student/interviews/${iv.id}/answer`, { text: "Many forms, one interface." });
    await t.post(riya, `/student/interviews/${iv.id}/answer`, { text: "Overloading and overriding." });
    await t.post(riya, `/student/interviews/${iv.id}/finish`, {});
    // On duty for the drive day, and the mission passed.
    expect((await t.post(riya, "/student/on-duty", { date: accenture.driveDate, reason: "drive", driveId: accenture.id })).status).toBe(200);
    await db.insert(certificates).values({ code: "PREP-TEST-1", tenantId: accenture.tenantId, userId: riyaId, kind: "mission", refId: accenture.packId!, title: "Service pseudocode", scorePct: 80, issuedAt: t.clock.now });
    const plan = (await t.get(riya, `/student/placements/${accenture.id}/prep`)).body;
    expect(step(plan.steps, "interview")).toBe(true);
    expect(step(plan.steps, "on_duty")).toBe(true);
    expect(step(plan.steps, "mission")).toBe(true);
    expect(plan.done).toBe(plan.steps.filter((s: { done: boolean }) => s.done).length);
  });
});

describe("registrants' preparation for the placement cell", () => {
  it("shows each registrant against the drive's steps, furthest behind first", async () => {
    const [someone] = await db.select().from(users).where(eq(users.email, "aarav.sharma1@demo.edu"));
    await db.insert(placementApplications).values({ tenantId: accenture.tenantId, driveId: accenture.id, userId: someone!.id, status: "registered", createdAt: t.clock.now, readiness: {}, activeDays60: 0 });
    const r = (await t.get(tpo, `/console/placements/${accenture.id}/prep`)).body;
    expect(r.steps.map((s: { key: string }) => s.key)).not.toContain("aptitude");
    expect(r.steps.find((s: { key: string }) => s.key === "interview")).toMatchObject({ done: 1 });
    const names = r.students.map((s: { name: string }) => s.name);
    expect(names.indexOf("Aarav Sharma")).toBeLessThan(names.indexOf("Riya Kapoor"));
    expect(r.students.find((s: { name: string }) => s.name === "Aarav Sharma").missing).toContain("interview");
    expect((await t.get(await t.login("faculty@demo.edu"), `/console/placements/${accenture.id}/prep`)).status).toBe(403);
  });

  it("checks the minimum aptitude score against the official one", async () => {
    const [lti] = await db.select().from(placementDrives).where(eq(placementDrives.company, "LTIMindtree"));
    const [official] = await db.select().from(adaptiveAttempts).where(and(isNotNull(adaptiveAttempts.sittingId), eq(adaptiveAttempts.status, "finished")));
    await db.insert(placementApplications).values({ tenantId: lti!.tenantId, driveId: lti!.id, userId: official!.userId, status: "registered", createdAt: t.clock.now, readiness: {}, activeDays60: 0 });
    const r = (await t.get(tpo, `/console/placements/${lti!.id}/prep`)).body;
    expect(r.steps.map((s: { key: string }) => s.key)).toContain("aptitude");
    expect(r.steps.map((s: { key: string }) => s.key)).not.toContain("mission"); // no practice mission on this drive
    // The official score is the latest sitting's.
    const sat = await db.select().from(adaptiveAttempts).where(and(eq(adaptiveAttempts.userId, official!.userId), isNotNull(adaptiveAttempts.sittingId), eq(adaptiveAttempts.status, "finished")));
    const latest = sat.sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0]!.score!;
    expect(r.students[0].steps.aptitude).toBe(latest >= 500);
  });

  it("reminds those behind with their own missing steps, once a day", async () => {
    const first = (await t.post(tpo, `/console/placements/${accenture.id}/prep/remind`, {})).body;
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const [someone] = await db.select().from(users).where(eq(users.email, "aarav.sharma1@demo.edu"));
    const [note] = (await db.select().from(notifications).where(eq(notifications.userId, someone!.id))).filter((n) => n.link?.endsWith(`/play/placements/${accenture.id}/prep`));
    expect(note!.title).toMatch(/steps? left before/);
    expect(note!.body).toContain("A mock interview for this drive");
    expect((await t.post(tpo, `/console/placements/${accenture.id}/prep/remind`, {})).body.sent).toBe(0);
  });
});
