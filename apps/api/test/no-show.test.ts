import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let riyaId: string;
let drive: string;
let schedule: string;
const DAY = 86_400_000;
const newDrive = async (company: string) =>
  (
    await t.post(tpo, "/console/placements", {
      company,
      companyType: "product",
      roleTitle: "Software engineer",
      ctcRupees: 900_000,
      driveDate: "2026-10-30",
      registerBy: new Date(START.getTime() + DAY).toISOString(),
      criteria: { unitIds: [], allowPlaced: true },
      rounds: ["Online test", "Interview"],
    })
  ).body.drive.id;
const reasons = async (company: string) => ((await t.get(riya, "/student/placements")).body.drives as { company: string; eligibility: { reasons: string[] } }[]).find((d) => d.company === company)!.eligibility.reasons;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
  drive = await newDrive("Juspay");
  await t.post(riya, `/student/placements/${drive}/register`, {});
  schedule = (await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 0, startsAt: new Date(START.getTime() + 2 * DAY).toISOString(), slotMinutes: 20, panels: [{ name: "Panel 1", room: "Room 204", interviewer: "" }] })).body.schedules[0].id;
  await newDrive("Razorpay");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("no-show rule", () => {
  it("does nothing until the placement cell sets a limit", async () => {
    await t.post(tpo, `/console/placements/${drive}/schedules/${schedule}/slots/${riyaId}`, { status: "no_show" });
    const note = (await db.select().from(notifications).where(eq(notifications.userId, riyaId))).find((n) => n.title === "Juspay: you were marked absent");
    expect(note!.body).toContain("tell your placement cell");
    expect(await reasons("Razorpay")).toEqual([]);
    expect((await t.get(riya, "/student/placements")).body.noShows).toEqual({ count: 1, max: null });
  });

  it("stops registrations once a student has missed the limit", async () => {
    const policy = (await t.get(tpo, "/console/placements/policy")).body;
    expect((await t.put(tpo, "/console/placements/policy", { ...policy, maxNoShows: 1 })).status).toBe(200);
    expect(await reasons("Razorpay")).toEqual(["You missed 1 drive you registered for. Talk to your placement cell."]);
    const razorpay = ((await t.get(riya, "/student/placements")).body.drives as { id: string; company: string }[]).find((d) => d.company === "Razorpay")!.id;
    expect((await t.post(riya, `/student/placements/${razorpay}/register`, {})).status).toBe(400);
  });

  it("lets the placement cell excuse an absence", async () => {
    await t.post(tpo, `/console/placements/${drive}/schedules/${schedule}/slots/${riyaId}`, { status: "excused" });
    expect(await reasons("Razorpay")).toEqual([]);
    expect((await t.get(riya, "/student/placements")).body.noShows.count).toBe(0);
  });
});
