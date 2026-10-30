import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { driveCheckIns, notifications, placementDrives, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

// START is Thursday 22 October 2026, noon in India. The seed puts two
// students at a hackathon today and tomorrow (one in CSE 2027 - A, one in
// B), and has an ECE student asking for tomorrow forenoon.
let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let riyaId: string;
const raw = (token: string, url: string) => t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("certifications on the resume", () => {
  let id: string;
  const base = { kind: "certification", title: "Programming in Java", organisation: "NPTEL (IIT Kharagpur)", startMonth: "2026-04", endMonth: null, description: "Elite, 78%", link: null };

  it("are added with who issued them, and need the credential link to be verified", async () => {
    expect((await t.post(riya, "/student/resume/entries", { ...base, organisation: "" })).status).toBe(400);
    const res = await t.post(riya, "/student/resume/entries", base);
    const e = res.body.entries.find((x: { kind: string }) => x.kind === "certification");
    id = e.id;
    expect(e.period).toBe("Apr 2026");
    const ask = await t.post(riya, `/student/resume/entries/${id}/verify`, {});
    expect(ask.status).toBe(400);
    expect(ask.body.error.message).toContain("credential link");
    expect((await t.get(riya, "/student/resume")).body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ section: "certifications", message: expect.stringContaining("credential link") })]));
    const edited = await t.put(riya, `/student/resume/entries/${id}`, { ...base, endMonth: "2029-04", link: "https://nptel.ac.in/noc/certificate/NPTEL26CS68S9999" });
    expect(edited.body.entries.find((x: { id: string }) => x.id === id).period).toBe("Apr 2026, valid until Apr 2029");
    expect((await t.post(riya, `/student/resume/entries/${id}/verify`, {})).status).toBe(200);
  });

  it("are verified by the college, and counted by issuer", async () => {
    const before = (await t.get(tpo, "/console/internships?kind=certification")).body;
    // Riya's, and the seeded Cisco one.
    expect(before.entries.map((e: { title: string }) => e.title).sort()).toEqual(["Introduction to Networks (CCNA 1)", "Programming in Java"]);
    expect(before.certifications).toMatchObject({ certifications: 4, students: 4 });
    expect((await t.get(tpo, "/console/internships?kind=internship")).body.entries).toEqual([]);
    await t.post(tpo, `/console/internships/${id}/review`, { verify: true });
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), eq(notifications.title, "Your Programming in Java certification is verified")));
    expect(note).toBeDefined();
    const after = (await t.get(tpo, "/console/internships?kind=certification&status=verified")).body;
    expect(after.certifications.byIssuer[0]).toEqual({ issuer: "NPTEL (IIT Kharagpur)", certifications: 3, students: 3 });
    const { resume } = (await t.get(riya, "/student/resume")).body;
    expect(resume.certifications).toEqual([expect.objectContaining({ title: "Programming in Java", organisation: "NPTEL (IIT Kharagpur)", verified: true })]);
    const report = (await t.get(tpo, "/console/activity-report?year=2026-27")).body;
    // The year runs from June: the seeded June and August ones; Riya's (April) was earned before it.
    expect(report.certifications).toEqual({ certifications: 2, students: 2 });
  });
});

describe("on duty", () => {
  let zoho: string;
  let infy: string;

  it("is asked for a drive the student registered for, on its day or later rounds", async () => {
    const drives = await db.select().from(placementDrives);
    zoho = drives.find((d) => d.company === "Zoho")!.id;
    const open = drives.filter((d) => d.status === "open").sort((a, b) => a.driveDate.localeCompare(b.driveDate))[0]!;
    infy = open.id;
    const ask = (body: object) => t.post(riya, "/student/on-duty", { part: "full", reason: "drive", driveId: infy, date: open.driveDate, ...body });
    expect((await ask({})).body.error.message).toBe("Choose a drive you registered for");
    expect((await t.post(riya, `/student/placements/${infy}/register`, {})).status).toBe(200);
    expect((await ask({ date: "2026-10-30" })).status).toBe(400); // before the drive
    const res = await ask({ detail: "Seminar hall" });
    expect(res.status).toBe(200);
    expect(res.body.upcoming).toEqual([expect.objectContaining({ date: open.driveDate, status: "pending", purpose: `${open.company} campus drive (${open.roleTitle})`, ref: expect.stringMatching(/^OD-[0-9A-F]{8}$/) })]);
    expect((await ask({ part: "afternoon" })).status).toBe(409);
    expect((await t.post(riya, "/student/on-duty", { reason: "other", purpose: "Hack", date: "2026-10-23" })).status).toBe(400);
    expect((await t.post(riya, "/student/on-duty", { reason: "other", purpose: "Codeathon at IIT Delhi", date: "2026-11-30" })).body.error.message).toMatch(/30 days ahead/);
  });

  it("is approved at once when the student reported at the drive desk that day", async () => {
    await db.insert(driveCheckIns).values({ driveId: zoho, userId: riyaId, tenantId: (await db.select().from(users).where(eq(users.id, riyaId)))[0]!.tenantId!, reportedAt: new Date("2026-10-08T04:00:00Z"), byId: riyaId });
    const res = await t.post(riya, "/student/on-duty", { reason: "drive", driveId: zoho, date: "2026-10-08", part: "full" });
    expect(res.body.past[0]).toMatchObject({ date: "2026-10-08", status: "approved", note: "Reported at the drive desk", canCancel: false });
    const letter = await raw(riya, `/student/on-duty/${res.body.past[0].id}/letter`);
    expect(letter.statusCode).toBe(200);
    expect(letter.headers["content-type"]).toBe("application/pdf");
    expect(letter.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect((await t.post(riya, `/student/on-duty/${res.body.past[0].id}/cancel`, {})).status).toBe(400);
  });

  it("waits for the placement cell, which approves many at once", async () => {
    const queue = (await t.get(tpo, "/console/on-duty/queue")).body.requests;
    expect(queue.map((r: { student: { name: string } }) => r.student.name)).toContain("Riya Kapoor");
    const mine = queue.find((r: { student: { name: string } }) => r.student.name === "Riya Kapoor");
    expect(mine.evidence).toMatchObject({ registered: true, applicationStatus: "registered", reportedAtDesk: false });
    expect((await t.post(faculty, "/console/on-duty/decide", { ids: [mine.id], approve: true })).status).toBe(403);
    expect((await t.post(tpo, "/console/on-duty/decide", { ids: [mine.id], approve: false })).status).toBe(400);
    const done = await t.post(tpo, "/console/on-duty/decide", { ids: queue.map((r: { id: string }) => r.id), approve: true });
    expect(done.body.decided).toBe(queue.length);
    expect((await t.get(tpo, "/console/on-duty/queue")).body.requests).toEqual([]);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), eq(notifications.title, `On duty approved for ${mine.date}`)));
    expect(note).toBeDefined();
    expect((await t.get(riya, "/student/on-duty")).body.upcoming[0]).toMatchObject({ status: "approved", canCancel: true });
  });

  it("shows class teachers who is on duty in their sections", async () => {
    const all = (await t.get(tpo, "/console/on-duty?from=2026-10-22&to=2026-10-23")).body.entries;
    // The hackathon pair on both days, and the forenoon interview tomorrow.
    expect(all).toHaveLength(5);
    const mine = (await t.get(faculty, "/console/on-duty")).body;
    expect(mine.from).toBe("2026-10-22");
    expect(mine.entries).toEqual([expect.objectContaining({ partLabel: "Full day", purpose: "Smart India Hackathon grand finale (team CodeCrafters)", student: expect.objectContaining({ unit: "CSE 2027 - A" }) })]);
    expect((await t.get(faculty, "/console/on-duty?from=2026-10-01&to=2026-11-15")).status).toBe(400);
    const csv = await raw(faculty, "/console/on-duty.csv?from=2026-10-22&to=2026-10-23");
    expect(csv.body.split("\n")[0]).toBe("date,part,roll_no,name,section,purpose,reference");
    expect(csv.body.split("\n")).toHaveLength(3);
    expect((await t.get(riya, "/console/on-duty")).status).toBe(403);
  });

  it("can be called off before the day, and shows in the placement cell's week", async () => {
    const id = (await t.get(riya, "/student/on-duty")).body.upcoming[0].id;
    expect((await t.post(riya, `/student/on-duty/${id}/cancel`, {})).body.upcoming).toEqual([]);
    await t.post(riya, "/student/on-duty", { reason: "other", purpose: "Codeathon at IIT Delhi", date: "2026-10-27", part: "afternoon" });
    const week = (await t.get(tpo, "/console/week")).body;
    expect(week.queues.find((q: { key: string }) => q.key === "on_duty")).toMatchObject({ count: 1, link: "/console/on-duty" });
  });
});
