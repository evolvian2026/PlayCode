import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_IN_CODE_SECONDS } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { notifications, trainingSessions, users } from "../src/db/schema";
import { checkInCode, trainingReminders } from "../src/services/training";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let aarav: string;
let kavya: string;
let unitA: string;
let id: string;
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const starts = at(24 * 60); // Friday noon
const inbox = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await db.select().from(notifications).where(eq(notifications.userId, u!.id))).filter((n) => n.template === "training");
};
const idOf = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!.id;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("training sessions", () => {
  const base = { title: "Quant: time and work", kind: "aptitude", trainer: "Mr. Suresh Iyer", location: "Seminar hall 1", durationMinutes: 90 };

  it("lets staff schedule a session for chosen sections, and tells the students", async () => {
    expect((await t.post(tpo, "/console/training", { ...base, startsAt: at(-5).toISOString(), unitIds: [unitA] })).status).toBe(400);
    expect((await t.post(faculty, "/console/training", { ...base, startsAt: starts.toISOString(), unitIds: [] })).status).toBe(400); // faculty pick their sections
    const res = await t.post(tpo, "/console/training", { ...base, startsAt: starts.toISOString(), unitIds: [unitA] });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body).toMatchObject({ kindLabel: "Aptitude and reasoning", status: "scheduled", checkInOpen: false });
    expect((await inbox("student@demo.edu"))[0]).toMatchObject({ title: "Training: Quant: time and work", body: expect.stringContaining("Seminar hall 1") });
    expect(await inbox("kavya.singh8@demo.edu")).toEqual([]);
    expect((await t.get(faculty, "/console/training")).body.upcoming.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await t.get(riya, "/student/training")).body.upcoming).toEqual([expect.objectContaining({ id, attended: false })]);
    expect((await t.get(kavya, "/student/training")).body.upcoming).toEqual([]);
  });

  it("reminds invited students the day before, once", async () => {
    const sent = await trainingReminders(db, at(60));
    expect(sent).toBeGreaterThan(1);
    expect(await trainingReminders(db, at(120))).toBe(0);
    expect((await inbox("student@demo.edu")).map((n) => n.title)).toContain("Tomorrow: Quant: time and work");
  });

  it("takes attendance with a code that changes every 30 seconds", async () => {
    expect((await t.post(riya, "/student/training/check-in", { code: "123456" })).body.error.message).toContain("No session");
    expect((await t.post(tpo, `/console/training/${id}/check-in`, { open: true })).body.error.code).toBe("too_early");
    t.clock.now = at(24 * 60 - 10); // ten minutes before the start
    expect((await t.post(tpo, `/console/training/${id}/check-in`, { open: true })).body.checkInOpen).toBe(true);

    const { code, changesInMs } = (await t.get(tpo, `/console/training/${id}/code`)).body;
    expect(code).toMatch(/^\d{6}$/);
    expect(changesInMs).toBeGreaterThan(0);
    expect(changesInMs).toBeLessThanOrEqual(CHECK_IN_CODE_SECONDS * 1000);
    expect((await t.get(riya, "/student/training")).body.openNow).toEqual([expect.objectContaining({ id })]);
    expect((await t.post(riya, "/student/training/check-in", { code: code === "000000" ? "111111" : "000000" })).status).toBe(400);
    expect((await t.post(riya, "/student/training/check-in", { code })).body).toEqual({ session: { id, title: base.title }, late: false });
    // Checked in, the session stays on the student's list while it runs.
    expect((await t.get(riya, "/student/training")).body).toMatchObject({ openNow: [], upcoming: [expect.objectContaining({ id, attended: true })] });

    // The previous code still works for a moment; one from two windows back doesn't.
    t.clock.now = new Date(t.clock.now.getTime() + CHECK_IN_CODE_SECONDS * 1000);
    const [s] = await db.select().from(trainingSessions).where(eq(trainingSessions.id, id));
    const window = Math.floor(t.clock.now.getTime() / (CHECK_IN_CODE_SECONDS * 1000));
    expect((await t.post(kavya, "/student/training/check-in", { code: checkInCode(s!.codeSecret, window) })).body.error.message).toContain("No session"); // not invited
    t.clock.now = at(24 * 60 + 20); // twenty minutes in
    const now = Math.floor(t.clock.now.getTime() / (CHECK_IN_CODE_SECONDS * 1000));
    expect((await t.post(aarav, "/student/training/check-in", { code: checkInCode(s!.codeSecret, now - 2) })).status).toBe(400);
    expect((await t.post(aarav, "/student/training/check-in", { code: checkInCode(s!.codeSecret, now - 1) })).body.late).toBe(true);
  });

  it("lets staff see who came and mark students by hand", async () => {
    const detail = (await t.get(faculty, `/console/training/${id}`)).body;
    const status = (email: string) => idOf(email).then((uid) => detail.students.find((s: { id: string }) => s.id === uid)?.status);
    expect(await status("student@demo.edu")).toBe("present");
    expect(await status("aarav.sharma1@demo.edu")).toBe("late");
    expect(detail).toMatchObject({ present: 2, late: 1 });
    const absent = detail.students.find((s: { status: string }) => s.status === "absent");
    expect(absent).toBeTruthy();
    await t.post(faculty, `/console/training/${id}/attendance`, { userId: absent.id, present: true });
    expect((await t.get(faculty, `/console/training/${id}`)).body.present).toBe(3);
    expect((await t.post(faculty, `/console/training/${id}/attendance`, { userId: await idOf("kavya.singh8@demo.edu"), present: true })).status).toBe(403);
    expect((await t.get(riya, `/console/training/${id}`)).status).toBe(403);
  });

  it("reports attendance per student, lowest first, leaving out cancelled sessions", async () => {
    t.clock.now = at(24 * 60 - 20);
    const later = (await t.post(tpo, "/console/training", { ...base, title: "Group discussion workshop", kind: "soft_skills", startsAt: at(48 * 60).toISOString(), unitIds: [unitA] })).body;
    expect((await t.post(tpo, `/console/training/${later.id}/cancel`)).body.status).toBe("cancelled");
    expect((await inbox("student@demo.edu")).map((n) => n.title)).toContain("Cancelled: Group discussion workshop");
    t.clock.now = at(24 * 60 + 200); // after the first session
    expect((await t.post(tpo, `/console/training/${id}/cancel`)).body.error.code).toBe("session_over");

    const report = (await t.get(faculty, `/console/training/attendance?unitId=${unitA}`)).body;
    expect(report.sessionsHeld).toBe(1);
    expect(report.students[0]).toMatchObject({ sessions: 1, attended: 0, pct: 0 });
    expect(report.students.at(-1)).toMatchObject({ sessions: 1, attended: 1, pct: 100 });
    expect((await t.get(riya, "/student/training")).body).toMatchObject({ attendancePct: 100, held: 1, attended: 1 });
  });
});
