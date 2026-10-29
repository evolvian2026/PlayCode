import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let drive: string;
let students: { id: string; email: string; rollNo: string; token: string }[] = [];
const DAY = 86_400_000;
const panels = [
  { name: "Panel 1", room: "Room 204", interviewer: "Ms. Priya Nair" },
  { name: "Panel 2", room: "Room 205", interviewer: "Mr. Arjun Rao" },
];
const at = new Date(START.getTime() + 2 * DAY);

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  drive = (
    await t.post(tpo, "/console/placements", {
      company: "Juspay",
      companyType: "product",
      roleTitle: "Software engineer",
      ctcRupees: 900_000,
      driveDate: "2026-10-26",
      registerBy: new Date(START.getTime() + DAY).toISOString(),
      criteria: { unitIds: [], allowPlaced: true },
      rounds: ["Online test", "Technical interview", "HR interview"],
    })
  ).body.drive.id;
  const list = ((await t.get(tpo, "/console/students")).body.students as { id: string; email: string; rollNo: string; unitName: string }[])
    .filter((s) => s.unitName === "CSE 2027 - A")
    .sort((a, b) => a.rollNo.localeCompare(b.rollNo))
    .slice(0, 5);
  for (const s of list) {
    const token = await t.login(s.email);
    expect((await t.post(token, `/student/placements/${drive}/register`, {})).status).toBe(200);
    students.push({ ...s, token });
  }
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("drive-day interview schedules", () => {
  it("shares the students waiting for a round across panels, and tells them", async () => {
    expect((await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 1, startsAt: at.toISOString(), slotMinutes: 20, panels })).status).toBe(400); // nobody has cleared the test yet
    expect((await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 0, startsAt: new Date(START.getTime() - DAY).toISOString(), slotMinutes: 20, panels })).status).toBe(400);
    expect((await t.post(await t.login("faculty@demo.edu"), `/console/placements/${drive}/schedules`, { round: 0, startsAt: at.toISOString(), slotMinutes: 20, panels })).status).toBe(403);
    const res = await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 0, startsAt: at.toISOString(), slotMinutes: 20, panels });
    expect(res.status).toBe(200);
    const [s] = res.body.schedules;
    expect(s).toMatchObject({ roundName: "Online test", slotMinutes: 20, endsAt: new Date(at.getTime() + 60 * 60_000).toISOString() });
    expect(s.slots.map((x: { rollNo: string; panel: number }) => [x.rollNo, x.panel])).toEqual(students.map((st, i) => [st.rollNo, i % 2]));
    const note = (await db.select().from(notifications).where(eq(notifications.userId, students[3]!.id))).find((n) => n.title.startsWith("Juspay Online test"));
    expect(note!.body).toContain("Panel 2, Room 205");
    const mine = (await t.get(students[3]!.token, "/student/placements")).body.drives.find((d: { id: string }) => d.id === drive);
    expect(mine.application.slots).toEqual([{ round: "Online test", startsAt: new Date(at.getTime() + 20 * 60_000).toISOString(), panel: panels[1], status: "scheduled", feedback: null }]);
    const cal = (await t.get(students[3]!.token, `/student/calendar?from=${START.toISOString()}&to=${new Date(START.getTime() + 5 * DAY).toISOString()}`)).body.events;
    expect(cal).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "drive_round", title: "Juspay: Online test", location: "Panel 2, Room 205" })]));
  });

  it("remakes a round's schedule, telling everyone their new time", async () => {
    const res = await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 0, startsAt: at.toISOString(), slotMinutes: 15, panels: [panels[0]] });
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.schedules[0].slots.map((x: { panel: number }) => x.panel)).toEqual([0, 0, 0, 0, 0]);
    const notes = (await db.select().from(notifications).where(eq(notifications.userId, students[4]!.id))).filter((n) => n.title.startsWith("Juspay Online test"));
    expect(notes).toHaveLength(2);
  });

  it("marks who was interviewed and who didn't come, and schedules the next round for those who cleared", async () => {
    const [s] = (await t.get(tpo, `/console/placements/${drive}/schedules`)).body.schedules;
    expect((await t.post(tpo, `/console/placements/${drive}/schedules/${s.id}/slots/${students[1]!.id}`, { status: "no_show" })).status).toBe(200);
    expect((await t.post(tpo, `/console/placements/${drive}/schedules/${s.id}/slots/${s.id}`, { status: "done" })).status).toBe(404);
    const again = (await t.get(tpo, `/console/placements/${drive}/schedules`)).body.schedules[0];
    expect(again.slots.find((x: { userId: string }) => x.userId === students[1]!.id).status).toBe("no_show");

    await t.post(tpo, `/console/placements/${drive}/applications`, { userIds: [students[0]!.id, students[2]!.id, students[3]!.id], action: "advance" });
    const next = await t.post(tpo, `/console/placements/${drive}/schedules`, { round: 1, startsAt: new Date(at.getTime() + 3 * 3_600_000).toISOString(), slotMinutes: 30, panels });
    expect(next.body.schedules.map((x: { roundName: string }) => x.roundName)).toEqual(["Online test", "Technical interview"]);
    expect(next.body.schedules[1].slots.map((x: { userId: string }) => x.userId)).toEqual([students[0]!.id, students[2]!.id, students[3]!.id]);
    const mine = (await t.get(students[0]!.token, "/student/placements")).body.drives.find((d: { id: string }) => d.id === drive);
    expect(mine.application.slots.map((x: { round: string }) => x.round)).toEqual(["Online test", "Technical interview"]);
  });
});
