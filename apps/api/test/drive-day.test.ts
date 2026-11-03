import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { driveSlots, notifications, users } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let drive: string;
type Student = { id: string; email: string; rollNo: string; unitName: string; token: string };
const candidates: Student[] = [];
const helpers: Student[] = [];
const DAY = 86_400_000;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  drive = (
    await t.post(tpo, "/console/placements", {
      company: "Juspay",
      companyType: "product",
      roleTitle: "Software engineer",
      ctcRupees: 900_000,
      // Tomorrow: the reporting desk is already open.
      driveDate: "2026-10-23",
      registerBy: new Date(START.getTime() + 3_600_000).toISOString(),
      criteria: { unitIds: [], allowPlaced: true },
      rounds: ["Online test", "Technical interview", "HR interview"],
    })
  ).body.drive.id;
  const all = (await t.get(tpo, "/console/students")).body.students as Omit<Student, "token">[];
  const byRoll = (unit: string) => all.filter((s) => s.unitName === unit).sort((a, b) => a.rollNo.localeCompare(b.rollNo));
  for (const s of byRoll("CSE 2027 - A").slice(0, 5)) {
    const token = await t.login(s.email);
    expect((await t.post(token, `/student/placements/${drive}/register`, {})).status).toBe(200);
    candidates.push({ ...s, token });
  }
  for (const s of byRoll("CSE 2027 - B").slice(0, 2)) helpers.push({ ...s, token: await t.login(s.email) });
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

const card = async (s: Student) => (await t.get(s.token, "/student/placements")).body.drives.find((d: { id: string }) => d.id === drive);

describe("drive updates", () => {
  it("reaches the group it's for, and collects on their drive card", async () => {
    const post = (body: object) => t.post(tpo, `/console/placements/${drive}/updates`, { audience: "all", round: null, body: "Pre-placement talk at 9:30 in Seminar Hall 1. Be seated by 9:15.", ...body });
    expect((await post({ audience: "round", round: 1 })).status).toBe(400); // nobody has cleared the test yet
    expect((await post({ audience: "not_selected" })).status).toBe(400);
    expect((await post({ audience: "round", round: 7 })).status).toBe(400);
    expect((await t.post(await t.login("faculty@demo.edu"), `/console/placements/${drive}/updates`, { audience: "all", body: "Hello there" })).status).toBe(403);
    const res = await post({});
    expect(res.body.updates).toEqual([expect.objectContaining({ audienceLabel: "Everyone registered", recipients: 5, by: "Rajesh Sharma (TPO)" })]);

    await t.post(tpo, `/console/placements/${drive}/applications`, { userIds: [candidates[3]!.id, candidates[4]!.id], action: "advance" });
    // A minute later, so the feed has an order.
    t.clock.now = new Date(START.getTime() + 60_000);
    const round = await post({ audience: "round", round: 1, body: "Technical interviews start at 2 pm in the Placement Block." });
    t.clock.now = new Date(START);
    expect(round.body.updates[0]).toMatchObject({ audienceLabel: "Waiting for Technical interview", recipients: 2 });
    expect((await card(candidates[4]!)).application.updates.map((u: { body: string }) => u.body)).toEqual(["Technical interviews start at 2 pm in the Placement Block.", "Pre-placement talk at 9:30 in Seminar Hall 1. Be seated by 9:15."]);
    expect((await card(candidates[0]!)).application.updates).toHaveLength(1);
    const notes = await db.select().from(notifications).where(and(eq(notifications.userId, candidates[3]!.id), like(notifications.title, "Juspay: update%")));
    expect(notes).toHaveLength(2);
  });
});

describe("reporting desk", () => {
  it("lets the placement cell appoint student coordinators", async () => {
    const put = (userIds: string[]) => t.put(tpo, `/console/placements/${drive}/coordinators`, { userIds });
    expect((await put([candidates[0]!.id])).status).toBe(400); // a candidate can't coordinate
    const [faculty] = await db.select().from(users).where(eq(users.email, "faculty@demo.edu"));
    expect((await put([faculty!.id])).status).toBe(400);
    const res = await put(helpers.map((h) => h.id));
    expect(res.body.coordinators).toHaveLength(2);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, helpers[0]!.id), like(notifications.title, "You're a coordinator%")));
    expect(note!.link).toContain(`/play/desk?drive=${drive}`);
    expect((await t.get(helpers[0]!.token, "/student/desks")).body.desks).toEqual([expect.objectContaining({ id: drive, company: "Juspay", open: true })]);
  });

  it("lets a coordinator check students in, and only a coordinator", async () => {
    const desk = (await t.get(helpers[0]!.token, `/student/desks/${drive}`)).body;
    expect(desk).toMatchObject({ expected: 5, reported: 0 });
    // Coordinators see names, roll numbers and slots, nothing more.
    expect(Object.keys(desk.students[0]).sort()).toEqual(["name", "reportedAt", "rollNo", "round", "slot", "userId"]);
    expect((await t.get(candidates[0]!.token, `/student/desks/${drive}`)).status).toBe(404);
    expect((await t.put(helpers[0]!.token, `/student/desks/${drive}/${helpers[1]!.id}`, { reported: true })).status).toBe(404);
    const res = await t.put(helpers[0]!.token, `/student/desks/${drive}/${candidates[0]!.id}`, { reported: true });
    expect(res.body.reported).toBe(1);
    expect(res.body.students.find((s: { userId: string }) => s.userId === candidates[0]!.id).reportedAt).toBe(START.toISOString());

    // The desk closes the day after the drive.
    t.clock.now = new Date(START.getTime() + 3 * DAY);
    expect((await t.get(helpers[0]!.token, `/student/desks/${drive}`)).status).toBe(403);
    t.clock.now = new Date(START);
  });

  it("marks everyone with a slot who didn't report as absent", async () => {
    const at = new Date(START.getTime() + 4 * 3_600_000);
    const schedule = (await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 0, startsAt: at.toISOString(), slotMinutes: 20, panels: [{ name: "Panel 1", room: "Lab 3", interviewer: "" }] })).body.schedules[0];
    expect(schedule.slots).toHaveLength(3);
    const staff = (await t.get(tpo, `/console/placements/${drive}/desk`)).body;
    expect(staff).toMatchObject({ expected: 5, reported: 1, coordinators: expect.arrayContaining([expect.objectContaining({ userId: helpers[0]!.id })]) });
    expect(staff.students.find((s: { userId: string }) => s.userId === candidates[1]!.id).slot).toEqual({ round: "Online test", startsAt: new Date(at.getTime() + 20 * 60_000).toISOString() });
    // Staff can check students in too.
    await t.put(tpo, `/console/placements/${drive}/desk/${candidates[1]!.id}`, { reported: true });

    const res = await t.post(tpo, `/console/placements/${drive}/schedules/${schedule.id}/absent`);
    expect(res.body).toEqual({ absent: 1 });
    const slots = await db.select().from(driveSlots).where(eq(driveSlots.scheduleId, schedule.id));
    expect(Object.fromEntries(slots.map((s) => [s.userId, s.status]))).toEqual({ [candidates[0]!.id]: "scheduled", [candidates[1]!.id]: "scheduled", [candidates[2]!.id]: "no_show" });
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, candidates[2]!.id), like(notifications.title, "Juspay: you were marked absent")));
    expect(note).toBeDefined();
  });
});

describe("offer details", () => {
  it("checks what the offer is made of and shows it to students", async () => {
    const put = (body: object) => t.put(tpo, `/console/placements/${drive}/offer-details`, body);
    expect((await put({ fixedRupees: 800_000, variableRupees: 200_000 })).status).toBe(400);
    expect((await put({ bondAmountRupees: 100_000 })).status).toBe(400);
    const details = { fixedRupees: 800_000, variableRupees: 100_000, joiningBonusRupees: 50_000, bondMonths: 12, bondAmountRupees: 100_000, probationMonths: 6, notes: "Relocation paid." };
    expect((await put(details)).body.offerDetails).toEqual(details);
    expect((await card(candidates[0]!)).offerDetails).toEqual(details);
    expect((await put({})).body.offerDetails).toBeNull();
  });
});
