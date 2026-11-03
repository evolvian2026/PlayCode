import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let internship: string;
const intern = { kind: "internship", title: "Software engineering intern", organisation: "Zoho", startMonth: "2026-05", endMonth: "2026-07", description: "Built an internal dashboard for support tickets in React.", link: null };

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("projects and internships", () => {
  it("adds them to the resume, checking the dates", async () => {
    expect((await t.post(riya, "/student/resume/entries", { ...intern, startMonth: "2026-12" })).status).toBe(400);
    expect((await t.post(riya, "/student/resume/entries", { ...intern, organisation: "" })).status).toBe(400);
    expect((await t.post(riya, "/student/resume/entries", { ...intern, link: "http://example.com" })).status).toBe(400);
    const res = await t.post(riya, "/student/resume/entries", intern);
    internship = res.body.entries[0].id;
    await t.post(riya, "/student/resume/entries", { kind: "project", title: "Canteen ordering app", organisation: "Smart India Hackathon", startMonth: "2025-09", endMonth: null, description: "Flutter app with a Firebase backend.", link: "https://github.com/riya/canteen" });
    const { entries } = (await t.get(riya, "/student/resume/entries")).body;
    expect(entries.map((e: { period: string }) => e.period)).toEqual(["May 2026 to Jul 2026", "since Sep 2025"]);
    const resume = (await t.get(riya, "/student/resume")).body.resume;
    expect(resume.internships).toEqual([expect.objectContaining({ organisation: "Zoho", verified: false })]);
    expect(resume.projects).toEqual([expect.objectContaining({ title: "Canteen ordering app" })]);
  });

  it("has the college verify internships", async () => {
    const project = (await t.get(riya, "/student/resume/entries")).body.entries[1].id;
    expect((await t.post(riya, `/student/resume/entries/${project}/verify`, {})).status).toBe(400);
    expect((await t.post(riya, `/student/resume/entries/${internship}/verify`, {})).body.entries[0].verification).toBe("requested");
    expect((await t.post(riya, `/student/resume/entries/${internship}/verify`, {})).status).toBe(409);
    const queue = (await t.get(tpo, "/console/internships?kind=internship")).body;
    expect(queue.entries).toEqual([expect.objectContaining({ id: internship, student: expect.objectContaining({ name: "Riya Kapoor" }) })]);
    expect((await t.post(tpo, `/console/internships/${internship}/review`, { verify: false })).status).toBe(400);
    await t.post(tpo, `/console/internships/${internship}/review`, { verify: true });
    const resume = (await t.get(riya, "/student/resume")).body.resume;
    expect(resume.internships[0].verified).toBe(true);
    const pdf = await t.app.inject({ method: "GET", url: "/student/resume/pdf", headers: { authorization: `Bearer ${riya}` } });
    expect(pdf.statusCode).toBe(200);
    // Editing clears the verification.
    expect((await t.put(riya, `/student/resume/entries/${internship}`, { ...intern, endMonth: "2026-08" })).body.entries[0].verification).toBe("none");
  });

  it("counts verified internships in the accreditation report", async () => {
    await t.post(riya, `/student/resume/entries/${internship}/verify`, {});
    await t.post(tpo, `/console/internships/${internship}/review`, { verify: true });
    expect((await t.get(tpo, "/console/activity-report?year=2026-27")).body.internships).toEqual({ internships: 1, students: 1 });
    expect((await t.get(riya, "/privacy/export")).body.projectsAndInternships).toHaveLength(2);
  });
});
