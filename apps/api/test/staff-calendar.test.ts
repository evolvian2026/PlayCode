import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let unitA: string;
const DAY = 86_400_000;
type Ev = { kind: string; title: string; start: string; allDay: boolean };
const cal = async (token: string) => ((await t.get(token, `/console/calendar?from=${START.toISOString()}&to=${new Date(START.getTime() + 30 * DAY).toISOString()}`)).body.events ?? []) as Ev[];

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  await t.post(tpo, "/console/training", { title: "Quant: time and work", kind: "aptitude", trainer: "Mr. Suresh Iyer", location: "Seminar hall 1", startsAt: new Date(START.getTime() + DAY).toISOString(), durationMinutes: 90, unitIds: [unitA] });
  await t.post(tpo, "/console/circulars", { title: "TCS drive: what to bring", body: "Carry two copies of your resume and your college ID.", requireAck: true, ackBy: "2026-10-27" });
  await t.post(faculty, "/console/documents", { title: "Semester marksheets", unitIds: [unitA], dueOn: "2026-10-30" });
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("console calendar", () => {
  it("puts drives, training and deadlines on one calendar for the placement cell", async () => {
    const events = await cal(tpo);
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ["drive", "drive_deadline", "training", "circular_due", "document_due"]) expect(kinds).toContain(k);
    expect(events.find((e) => e.kind === "circular_due")).toMatchObject({ title: "Acknowledge: TCS drive: what to bring", start: "2026-10-27", allDay: true });
    const days = events.map((e) => (e.allDay ? e.start : e.start.slice(0, 10)));
    expect([...days].sort()).toEqual(days); // in date order
  });

  it("shows faculty what they can see, without drives", async () => {
    const events = await cal(faculty);
    expect(events.some((e) => e.kind === "drive" || e.kind === "drive_deadline")).toBe(false);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["training", "circular_due", "document_due"]));
    expect((await t.get(await t.login("student@demo.edu"), "/console/calendar")).status).toBe(403);
    expect((await t.get(tpo, `/console/calendar?from=${START.toISOString()}&to=${new Date(START.getTime() + 200 * DAY).toISOString()}`)).status).toBe(400);
  });
});
