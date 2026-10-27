import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { users } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let kavya: string;
let unitA: string;
let feedPath: string;
const HOUR = 3_600_000;

const ics = async (path: string) => {
  const res = await t.app.inject({ method: "GET", url: path });
  return { status: res.statusCode, type: res.headers["content-type"], body: res.body };
};

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  await t.post(tpo, "/console/training", { title: "Verbal: reading comprehension", kind: "aptitude", trainer: "Ms. Rao", location: "Room 204", startsAt: new Date(START.getTime() + 48 * HOUR).toISOString(), durationMinutes: 60, unitIds: [unitA] });
  const slots = (await t.post(tpo, "/console/interview-slots", { interviewerName: "Kavya Rao (alumna)", kind: "technical", startsAt: new Date(START.getTime() + 72 * HOUR).toISOString(), durationMinutes: 20, count: 1, location: "Seminar hall 2", unitIds: [unitA] })).body.slots;
  await t.post(riya, `/student/interview-slots/${slots[0].id}/book`);
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("student calendar", () => {
  it("puts everything dated for the student in one list, in order", async () => {
    const { events, feed } = (await t.get(riya, "/student/calendar")).body;
    const kinds = new Set(events.map((e: { kind: string }) => e.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(["training", "interview"]));
    expect(events.find((e: { kind: string }) => e.kind === "training")).toMatchObject({ title: "Verbal: reading comprehension", location: "Room 204", allDay: false, end: expect.any(String) });
    expect(events.find((e: { kind: string }) => e.kind === "interview")).toMatchObject({ title: "Mock interview with Kavya Rao (alumna)", location: "Seminar hall 2" });
    const starts = events.map((e: { start: string; allDay: boolean }) => (e.allDay ? `${e.start}T00:00:00.000Z` : e.start));
    expect(starts).toEqual([...starts].sort());
    expect(feed).toEqual({ active: false, createdAt: null });
    // Another section's student doesn't see this section's session.
    expect((await t.get(kavya, "/student/calendar")).body.events.some((e: { title: string }) => e.title === "Verbal: reading comprehension")).toBe(false);
    expect((await t.get(riya, `/student/calendar?from=${START.toISOString()}&to=${new Date(START.getTime() + 400 * 24 * HOUR).toISOString()}`)).status).toBe(400);
  });

  it("serves a private iCalendar feed, which a reset or removal stops", async () => {
    const { url } = (await t.post(riya, "/student/calendar/feed")).body;
    feedPath = new URL(url).pathname;
    expect(feedPath).toMatch(/^\/calendar\/[\w-]{32}\.ics$/);
    const res = await ics(feedPath);
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/calendar");
    expect(res.body).toContain("BEGIN:VCALENDAR");
    expect(res.body).toContain("SUMMARY:Verbal: reading comprehension");
    expect(res.body).toContain("X-WR-CALNAME:PlayCode: Riya");
    expect((await t.get(riya, "/student/calendar")).body.feed.active).toBe(true);
    // Only a hash is kept, and it isn't in the personal data export.
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    expect(u!.calendarTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(feedPath).not.toContain(u!.calendarTokenHash!);
    const exported = await t.get(riya, "/privacy/export");
    expect(exported.status).toBe(200);
    expect(exported.body.account.email).toBe("student@demo.edu");
    expect(JSON.stringify(exported.body)).not.toContain(u!.calendarTokenHash!);

    const reset = (await t.post(riya, "/student/calendar/feed")).body;
    expect((await ics(feedPath)).status).toBe(404);
    expect((await ics(new URL(reset.url).pathname)).status).toBe(200);
    await t.delete(riya, "/student/calendar/feed");
    expect((await ics(new URL(reset.url).pathname)).status).toBe(404);
    expect((await ics("/calendar/short.ics")).status).toBe(404);
    expect((await ics("/calendar/not-a-calendar")).status).toBe(404);
  });

  it("stops serving a disabled account's feed", async () => {
    const { url } = (await t.post(riya, "/student/calendar/feed")).body;
    await db.update(users).set({ status: "disabled" }).where(eq(users.email, "student@demo.edu"));
    expect((await ics(new URL(url).pathname)).status).toBe(404);
    await db.update(users).set({ status: "active" }).where(eq(users.email, "student@demo.edu"));
  });
});
