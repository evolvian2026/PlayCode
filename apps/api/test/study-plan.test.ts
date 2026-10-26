import { addDays } from "@playcode/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const TODAY = "2026-10-22"; // START in Asia/Kolkata

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("study plans", () => {
  it("builds a day-by-day plan to a date for a kind of company", async () => {
    expect((await t.get(riya, "/student/plan")).body).toEqual({ plan: null });
    expect((await t.post(riya, "/student/plan", { targetDate: TODAY, profile: "service" })).status).toBe(400);
    const res = (await t.post(riya, "/student/plan", { targetDate: addDays(TODAY, 10), profile: "service" })).body.plan;
    expect(res.target).toMatchObject({ date: addDays(TODAY, 10), profile: "service", driveId: null });
    expect(res.days).toHaveLength(10);
    expect(res.days[6]).toMatchObject({ kind: "review", title: "Review fading skills" });
    expect(res.days[9]).toMatchObject({ kind: "mission" });
    expect(res.days[9].title).toMatch(/^Mock round/);
    expect(res.today).toMatchObject({ date: TODAY, kind: "skill", status: "today" });
    expect(res).toMatchObject({ daysLeft: 10, doneSoFar: 0, dueSoFar: 1 });
  });

  it("ticks a day off after enough practice on its skill, and shows missed days", async () => {
    const plan = (await t.get(riya, "/student/plan")).body.plan;
    let session = (await t.post(riya, "/student/sessions", { kind: "skill", skillId: plan.today.skillId })).body;
    while (!session.finished) {
      const q = session.question.id;
      session = (await t.post(riya, `/student/sessions/${session.id}/answer`, { questionId: q, response: rightAnswer(q), timeMs: 15_000 })).body.session;
    }
    expect((await t.get(riya, "/student/plan")).body.plan.today.status).toBe("done");
    t.clock.now = new Date(START.getTime() + 2 * 86_400_000);
    const later = (await t.get(riya, "/student/plan")).body.plan;
    expect(later.days.slice(0, 3).map((d: { status: string }) => d.status)).toEqual(["done", "missed", "today"]);
    expect(later).toMatchObject({ doneSoFar: 1, dueSoFar: 3, daysLeft: 8 });
    t.clock.now = new Date(START);
  });

  it("can aim at a placement drive, and be removed", async () => {
    const drives = (await t.get(riya, "/student/placements")).body.drives as { id: string; company: string; companyType: string; driveDate: string }[];
    const future = drives.find((d) => d.driveDate > TODAY)!;
    const plan = (await t.post(riya, "/student/plan", { driveId: future.id })).body.plan;
    expect(plan.target).toMatchObject({ label: `${future.company} drive`, date: future.driveDate, driveId: future.id, profile: future.companyType === "product" ? "product" : "service" });
    expect((await t.post(riya, "/student/plan", { driveId: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
    expect((await t.delete(riya, "/student/plan")).body).toEqual({ plan: null });
  });
});
