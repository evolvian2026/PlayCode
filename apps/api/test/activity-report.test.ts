import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let unitA: string;
let unitEce: string;
const HOUR = 3_600_000;
const at = (h: number) => new Date(START.getTime() + h * HOUR).toISOString();

const raw = async (token: string, url: string) => {
  const res = await t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, type: res.headers["content-type"], body: res.rawPayload };
};

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
  unitA = units.find((u) => u.name === "CSE 2027 - A")!.id;
  unitEce = units.find((u) => u.name.startsWith("ECE"))!.id;

  const session = (title: string, h: number, minutes = 90) => t.post(tpo, "/console/training", { title, kind: "aptitude", trainer: "Mr. Iyer", location: "Hall 1", startsAt: at(h), durationMinutes: minutes, unitIds: [unitA] }).then((r) => r.body);
  const quant = await session("Quant: percentages", 2);
  const verbal = await session("=HYPERLINK(\"http://x\")", 26, 60); // a title a spreadsheet would run
  const cancelled = await session("Cancelled workshop", 50);
  await t.post(tpo, `/console/training/${cancelled.id}/cancel`);
  await session("Not held yet", 24 * 30);
  t.clock.now = new Date(at(72));
  const students = (await t.get(tpo, `/console/training/${quant.id}`)).body.students as { id: string; name: string }[];
  const [riya, aarav] = ["Riya Kapoor", "Aarav Sharma"].map((n) => students.find((s) => s.name === n)!.id);
  for (const uid of [riya, aarav]) await t.post(tpo, `/console/training/${quant.id}/attendance`, { userId: uid, present: true });
  await t.post(tpo, `/console/training/${verbal.id}/attendance`, { userId: riya, present: true });

  const paper = (await t.post(faculty, "/console/papers", { title: "Unit test 1", durationMinutes: 30, sets: 1, picks: [{ skillId: "strings.basics", count: 2 }] })).body;
  await t.post(faculty, `/console/papers/${paper.id}/results`, { entries: [{ userId: riya!, set: "A", answers: "--" }, { userId: aarav!, set: "A", answers: "--" }] });
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("training and placement activity report", () => {
  it("covers the academic year by default, counting sessions held, hours and attendance", async () => {
    const r = (await t.get(tpo, `/console/activity-report?unitId=${unitA}`)).body;
    expect(r).toMatchObject({ from: "2026-06-01", to: "2027-05-31", scope: "CSE 2027 - A", institution: "Demo Institute of Technology" });
    expect(r.training.sessions.map((s: { title: string }) => s.title)).toEqual(["Quant: percentages", '=HYPERLINK("http://x")']);
    const invited = r.training.sessions[0].invited;
    expect(r.training.sessions[0]).toMatchObject({ hours: 1.5, attended: 2, kind: "aptitude" });
    expect(r.training.sessions[1]).toMatchObject({ hours: 1, attended: 1 });
    expect(r.training.totals).toMatchObject({ sessions: 2, hours: 2.5, studentsTrained: 2, attendancePct: Math.round((3 / (2 * invited)) * 100) });
    expect(r.training.byKind).toEqual([{ kind: "aptitude", label: "Aptitude and reasoning", sessions: 2, hours: 2.5 }]);
    expect(r.classTests).toEqual([expect.objectContaining({ title: "Unit test 1", students: 2, averagePct: 0 })]);
    expect(r.practice.answers.count).toBeGreaterThan(0);
    expect(r.placements).toMatchObject({ placed: expect.any(Number), offers: expect.any(Number) });
  });

  it("takes a custom range, and stays inside the requester's scope", async () => {
    const r = (await t.get(tpo, `/console/activity-report?from=2026-10-23&to=2026-10-23&unitId=${unitA}`)).body;
    expect(r.training.sessions.map((s: { title: string }) => s.title)).toEqual(['=HYPERLINK("http://x")']);
    expect((await t.get(faculty, `/console/activity-report?unitId=${unitEce}`)).status).toBe(403);
    expect((await t.get(tpo, "/console/activity-report?year=2026-28")).status).toBe(400);
    expect((await t.get(await t.login("student@demo.edu"), "/console/activity-report")).status).toBe(403);
  });

  it("downloads as CSV, with formula-looking cells neutralised, and as PDF", async () => {
    const csv = await raw(tpo, `/console/activity-report?unitId=${unitA}&format=csv`);
    expect(csv.type).toContain("text/csv");
    const text = csv.body.toString();
    expect(text).toContain("Date,Title,Kind,Trainer,Venue,Hours,Students invited,Students attended,Attendance %");
    expect(text).toContain("Quant: percentages,Aptitude and reasoning,Mr. Iyer,Hall 1,1.5");
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    const pdf = await raw(tpo, `/console/activity-report?unitId=${unitA}&format=pdf`);
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
