import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { slotReminders } from "../src/services/interview-slots";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let aarav: string;
let ece: string;
let unitA: string;
let slots: { id: string; startsAt: string }[];
const at = (hours: number) => new Date(START.getTime() + hours * 3_600_000); // START is Thursday 12:00 in India
const inbox = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await db.select().from(notifications).where(eq(notifications.userId, u!.id))).filter((n) => n.template === "interview_slot");
};

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  ece = await t.login("kavya.singh8@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("mock interviews with real interviewers", () => {
  it("lets staff publish a run of slots for chosen batches", async () => {
    const base = { interviewerName: "Kavya Rao (alumna, Infosys)", kind: "technical", startsAt: at(22).toISOString(), durationMinutes: 20, count: 3, location: "Seminar hall 2", unitIds: [unitA] };
    expect((await t.post(tpo, "/console/interview-slots", { ...base, startsAt: at(-1).toISOString() })).status).toBe(400);
    expect((await t.post(faculty, "/console/interview-slots", { ...base, unitIds: [] })).status).toBe(400); // faculty must pick their sections
    const res = await t.post(tpo, "/console/interview-slots", base);
    expect(res.status).toBe(200);
    slots = res.body.slots;
    // Back to back: 10:00, 10:20, 10:40 on Friday.
    expect(slots.map((s) => new Date(s.startsAt).getTime())).toEqual([at(22), at(22 + 1 / 3), at(22 + 2 / 3)].map((d) => d.getTime()));
    // Faculty of that section see them too.
    expect((await t.get(faculty, "/console/interview-slots")).body.slots).toHaveLength(3);
  });

  it("lets students in those batches book one slot each", async () => {
    expect((await t.get(riya, "/student/interview-slots")).body.open).toHaveLength(3);
    expect((await t.get(ece, "/student/interview-slots")).body.open).toHaveLength(0);
    expect((await t.post(ece, `/student/interview-slots/${slots[2]!.id}/book`)).status).toBe(403);

    const booked = (await t.post(riya, `/student/interview-slots/${slots[0]!.id}/book`)).body;
    expect(booked.mine[0]).toMatchObject({ id: slots[0]!.id, status: "booked", location: "Seminar hall 2", canCancel: true });
    expect(booked.open).toHaveLength(2);
    expect((await t.post(riya, `/student/interview-slots/${slots[1]!.id}/book`)).body.error.code).toBe("already_booked");
    expect((await t.post(aarav, `/student/interview-slots/${slots[0]!.id}/book`)).body.error.code).toBe("slot_taken");
    expect((await t.post(aarav, `/student/interview-slots/${slots[1]!.id}/book`)).status).toBe(200);
    expect((await t.get(tpo, "/console/interview-slots")).body.slots[0]).toMatchObject({ status: "booked", student: { name: "Riya Kapoor" } });
  });

  it("reminds students the day before, and allows cancelling until two hours before", async () => {
    expect(await slotReminders(db, at(0))).toBe(2);
    expect(await slotReminders(db, at(1))).toBe(0);
    expect((await inbox("student@demo.edu"))[0]).toMatchObject({ title: "Mock interview tomorrow", body: expect.stringContaining("Seminar hall 2") });

    t.clock.now = at(21); // an hour before
    expect((await t.post(riya, `/student/interview-slots/${slots[0]!.id}/cancel`)).body.error.code).toBe("too_late");
    t.clock.now = at(1);
    const after = (await t.post(aarav, `/student/interview-slots/${slots[1]!.id}/cancel`)).body;
    expect(after.mine).toEqual([]);
    expect(after.open.map((s: { id: string }) => s.id)).toContain(slots[1]!.id);
  });

  it("brings the interviewer's rubric back to the student", async () => {
    const good = { scores: { communication: 4, technical: 3, problemSolving: 4, confidence: 3 }, overall: 4, recommendation: "almost", strengths: "Clear about her project.", improvements: "Practise explaining complexity." };
    expect((await t.post(tpo, `/console/interview-slots/${slots[0]!.id}/feedback`, good)).body.error.code).toBe("not_yet");
    t.clock.now = at(22.5);
    expect((await t.post(tpo, `/console/interview-slots/${slots[0]!.id}/feedback`, { ...good, scores: { ...good.scores, technical: 6 } })).status).toBe(400);
    expect((await t.post(tpo, `/console/interview-slots/${slots[0]!.id}/feedback`, good)).body.status).toBe("done");
    const mine = (await t.get(riya, "/student/interview-slots")).body.mine[0];
    expect(mine).toMatchObject({ status: "done", feedback: { overall: 4, recommendation: "almost", by: "Rajesh Sharma (TPO)", scores: { technical: 3 } } });
    expect((await inbox("student@demo.edu")).map((n) => n.title)).toContain("Feedback from your mock interview");
    // An open slot gets no feedback.
    expect((await t.post(tpo, `/console/interview-slots/${slots[2]!.id}/feedback`, { noShow: true })).body.error.code).toBe("not_booked");
  });

  it("tells a booked student when staff cancel", async () => {
    t.clock.now = at(1);
    await t.post(aarav, `/student/interview-slots/${slots[1]!.id}/book`);
    expect((await t.post(faculty, `/console/interview-slots/${slots[1]!.id}/cancel`)).status).toBe(200);
    expect((await inbox("aarav.sharma1@demo.edu")).map((n) => n.title)).toContain("Mock interview cancelled");
    expect((await t.get(aarav, "/student/interview-slots")).body.mine[0].status).toBe("cancelled");
    expect((await t.post(faculty, `/console/interview-slots/${slots[0]!.id}/cancel`)).body.error.code).toBe("slot_finished");
    // Students can't use the console.
    expect((await t.get(riya, "/console/interview-slots")).status).toBe(403);
  });
});
