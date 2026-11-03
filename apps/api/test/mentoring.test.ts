import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { users } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let unitA: string;
let facultyId: string;
let tpoId: string;
let mentee: { id: string; name: string; email?: string };
const idOf = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!.id;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  [facultyId, tpoId] = await Promise.all([idOf("faculty@demo.edu"), idOf("tpo@demo.edu")]);
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("mentor–mentee system", () => {
  it("lets the placement cell split a section between mentors by roll number", async () => {
    const sheet = (await t.get(tpo, `/console/mentoring/assign?unitId=${unitA}`)).body;
    expect(sheet.mentors.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["Prof. Anil Kumar"]));
    expect(sheet.students.every((s: { mentorId: string | null }) => s.mentorId === null)).toBe(true);
    const n = sheet.students.length;
    const split = (await t.post(tpo, "/console/mentoring/split", { unitId: unitA, mentorIds: [facultyId, tpoId] })).body;
    expect(split.blocks.map((b: { students: number }) => b.students)).toEqual([Math.ceil(n / 2), Math.floor(n / 2)]);
    expect(split.blocks[0].from).toBe(sheet.students[0].rollNo);
    // A student can't be a mentor.
    expect((await t.post(tpo, "/console/mentoring/assign", { mentorId: await idOf("student@demo.edu"), studentIds: [sheet.students[0].id] })).status).toBe(400);
    expect((await t.get(faculty, `/console/mentoring/assign?unitId=${unitA}`)).status).toBe(403); // faculty don't assign
  });

  it("shows a mentor their mentees with what needs attention", async () => {
    const list = (await t.get(faculty, "/console/mentees")).body;
    expect(list.counts.mentees).toBeGreaterThan(0);
    mentee = list.mentees[0];
    expect(list.mentees[0]).toMatchObject({ flags: expect.arrayContaining(["no_meeting"]), readiness: { service: expect.any(Number) }, meetings: 0 });
    expect((await t.get(faculty, `/console/mentees?mentorId=${tpoId}`)).status).toBe(403); // someone else's list is for assigners
    expect((await t.get(tpo, `/console/mentees?mentorId=${facultyId}`)).body.counts.mentees).toBe(list.counts.mentees);
  });

  it("records meetings, with notes for staff and action points for the student", async () => {
    const base = { meetingDate: "2026-10-21", mode: "in_person", notes: "Worried about aptitude; family pressure about an early offer.", actionPoints: "Finish the percentages mission and attend Friday's quant session.", followUpOn: "2026-11-04" };
    expect((await t.post(faculty, `/console/mentees/${mentee.id}/meetings`, { ...base, meetingDate: "2026-12-01" })).status).toBe(400); // in the future
    expect((await t.post(faculty, `/console/mentees/${mentee.id}/meetings`, { ...base, followUpOn: "2026-10-20" })).status).toBe(400);
    expect((await t.post(faculty, `/console/mentees/${mentee.id}/meetings`, { ...base, notes: "", actionPoints: "" })).status).toBe(400);
    const record = (await t.post(faculty, `/console/mentees/${mentee.id}/meetings`, base)).body;
    expect(record.meetings).toEqual([expect.objectContaining({ notes: base.notes, actionPoints: base.actionPoints, by: "Prof. Anil Kumar" })]);
    expect(record.canLog).toBe(true);

    // Only the mentor writes; other staff in scope can read.
    const tpoMentee = (await t.get(tpo, "/console/mentees")).body.mentees[0].id;
    expect((await t.post(faculty, `/console/mentees/${tpoMentee}/meetings`, base)).status).toBe(403);
    expect((await t.get(tpo, `/console/mentees/${mentee.id}`)).body).toMatchObject({ canLog: false, mentor: { name: "Prof. Anil Kumar" } });

    const after = (await t.get(faculty, "/console/mentees")).body.mentees.find((m: { id: string }) => m.id === mentee.id);
    expect(after).toMatchObject({ lastMeeting: "2026-10-21", nextFollowUp: "2026-11-04", meetings: 1 });
    expect(after.flags).not.toContain("no_meeting");
  });

  it("shows the student their mentor and action points, not the notes", async () => {
    const [u] = await db.select().from(users).where(eq(users.id, mentee.id));
    const student = await t.login(u!.email);
    const mine = (await t.get(student, "/student/mentor")).body;
    expect(mine.mentor).toMatchObject({ name: "Prof. Anil Kumar" });
    expect(mine.meetings).toEqual([{ meetingDate: "2026-10-21", mode: "in_person", actionPoints: expect.stringContaining("percentages"), followUpOn: "2026-11-04" }]);
    expect(JSON.stringify(mine)).not.toContain("family pressure");
    // On request, their data export does include what's recorded about them.
    expect(JSON.stringify((await t.get(student, "/privacy/export")).body.mentoring)).toContain("family pressure");
    expect((await t.get(student, "/console/mentees")).status).toBe(403);
  });

  it("puts mentoring in the accreditation report", async () => {
    t.clock.now = new Date(START.getTime() + 3_600_000);
    const r = (await t.get(tpo, `/console/activity-report?unitId=${unitA}`)).body;
    expect(r.mentoring).toMatchObject({ mentors: 2, mentees: r.students, coveragePct: 100, meetings: 1, studentsMet: 1 });
    expect(r.mentoring.ratio).toBe(Math.round((r.students / 2) * 10) / 10);
  });
});
