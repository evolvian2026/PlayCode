import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let aarav: string;
let unitA: string;
let driveId: string;
const HOUR = 3_600_000;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("training attendance in drive eligibility", () => {
  it("lets a drive ask for a minimum training attendance", async () => {
    // One session, which Riya attends and Aarav misses.
    const session = (await t.post(tpo, "/console/training", { title: "Quant", kind: "aptitude", trainer: "Mr. Iyer", location: "Hall 1", startsAt: new Date(START.getTime() + HOUR).toISOString(), durationMinutes: 60, unitIds: [unitA] })).body;
    t.clock.now = new Date(START.getTime() + 2 * HOUR);
    const riyaId = ((await t.get(tpo, `/console/training/${session.id}`)).body.students as { id: string; name: string }[]).find((s) => s.name === "Riya Kapoor")!.id;
    await t.post(tpo, `/console/training/${session.id}/attendance`, { userId: riyaId, present: true });

    const res = await t.post(tpo, "/console/placements", {
      company: "Capgemini",
      companyType: "service",
      roleTitle: "Analyst",
      ctcRupees: 400_000,
      driveDate: "2026-11-20",
      registerBy: new Date(START.getTime() + 72 * HOUR).toISOString(),
      criteria: { unitIds: [unitA], minAttendancePct: 75 },
      rounds: ["Online test"],
    });
    expect(res.status).toBe(200);
    driveId = res.body.drive.id;
    expect((await t.get(tpo, `/console/placements/${driveId}`)).body.summary.eligible).toBeGreaterThanOrEqual(1);

    const mine = (await t.get(riya, "/student/placements")).body;
    expect(mine.attendance).toMatchObject({ sessions: 1, attended: 1, pct: 100 });
    expect(mine.drives.find((d: { id: string }) => d.id === driveId).eligibility).toEqual({ eligible: true, reasons: [] });
    const theirs = (await t.get(aarav, "/student/placements")).body.drives.find((d: { id: string }) => d.id === driveId);
    // (Aarav may also hold an offer in the seeded data; the attendance reason is what matters here.)
    expect(theirs.eligibility.reasons).toContain("Needs 75% attendance in placement training (yours is 0%)");
    expect((await t.post(aarav, `/student/placements/${driveId}/register`)).body.error.message).toContain("attendance");
    expect((await t.post(riya, `/student/placements/${driveId}/register`)).status).toBe(200);
  });
});
