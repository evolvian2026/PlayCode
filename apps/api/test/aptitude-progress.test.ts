import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { aptitudeSittings, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let august: string;
let october: string;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  const id = async (title: string) => (await db.select().from(aptitudeSittings).where(eq(aptitudeSittings.title, title)))[0]!.id;
  [august, october] = [await id("August aptitude sitting"), await id("October aptitude sitting")];
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("progress between two sittings", () => {
  it("compares the students who took both, with who moved beyond the margin and band to band", async () => {
    const r = (await t.get(tpo, `/console/aptitude/compare?from=${august}&to=${october}`)).body;
    expect(r.from).toMatchObject({ title: "August aptitude sitting" });
    expect(r.summary.students).toBe(r.students.length);
    expect(r.summary.students).toBeGreaterThan(3);
    expect(r.from.took).toBeLessThanOrEqual(r.to.took);
    expect(r.summary.up + r.summary.same + r.summary.down).toBe(r.summary.students);
    expect(r.summary.change).toBeGreaterThan(0);
    const cells = Object.values(r.summary.bands as Record<string, Record<string, number>>).flatMap((row) => Object.values(row));
    expect(cells.reduce((a, b) => a + b, 0)).toBe(r.summary.students);
    // Biggest gain first, and each student's change adds up.
    const changes = r.students.map((s: { change: number }) => s.change);
    expect(changes).toEqual([...changes].sort((a, b) => b - a));
    for (const s of r.students) expect(s.change).toBe(s.to - s.from);
    expect(r.byUnit.reduce((n: number, u: { students: number }) => n + u.students, 0)).toBe(r.summary.students);
  });

  it("shows faculty only their own section", async () => {
    const all = (await t.get(tpo, `/console/aptitude/compare?from=${august}&to=${october}`)).body;
    const mine = (await t.get(faculty, `/console/aptitude/compare?from=${august}&to=${october}`)).body;
    expect(mine.students.length).toBeLessThan(all.students.length);
    expect(mine.byUnit.map((u: { unit: string }) => u.unit)).toEqual(["CSE 2027 - A"]);
  });

  it("needs the earlier sitting first, and two different ones", async () => {
    expect((await t.get(tpo, `/console/aptitude/compare?from=${october}&to=${august}`)).status).toBe(400);
    expect((await t.get(tpo, `/console/aptitude/compare?from=${october}&to=${october}`)).status).toBe(400);
    expect((await t.get(await t.login("student@demo.edu"), `/console/aptitude/compare?from=${august}&to=${october}`)).status).toBe(403);
  });

  it("downloads as CSV", async () => {
    const csv = await t.app.inject({ method: "GET", url: `/console/aptitude/compare/csv?from=${august}&to=${october}`, headers: { authorization: `Bearer ${tpo}` } });
    const [head, first] = csv.body.split("\n");
    expect(head).toBe('"roll_no","name","class","score_August aptitude sitting","score_October aptitude sitting","change","quantitative_change","reasoning_change","from_band","to_band"');
    expect(first).toMatch(/^"CSE27\w+",/);
    expect(csv.body).not.toContain("\"'-");
  });
});

describe("a student's score over time, and drives that ask for a score", () => {
  it("gives the hub every finished attempt oldest first, official ones marked", async () => {
    const someone = await t.login("aarav.sharma1@demo.edu");
    const hub = (await t.get(someone, "/student/aptitude")).body;
    const at = hub.trend.map((x: { at: string }) => Date.parse(x.at));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(hub.trend.length).toBe(hub.attempts.length);
  });

  it("lists open drives with a minimum score, against the student's official score", async () => {
    const riya = await t.login("student@demo.edu");
    const none = (await t.get(riya, "/student/aptitude/drives")).body;
    expect(none.official).toBeNull();
    expect(none.drives).toEqual([expect.objectContaining({ company: "LTIMindtree", minAptitude: 500, meets: false, short: null, registered: false })]);
    // Someone with an official score sees how far off they are, or that they meet it.
    const { students } = (await t.get(tpo, `/console/aptitude/sittings/${october}`)).body;
    const scored = students.find((s: { score: number | null }) => s.score !== null);
    const token = await t.login((await db.select().from(users).where(eq(users.id, scored.id)))[0]!.email);
    const mine = (await t.get(token, "/student/aptitude/drives")).body;
    expect(mine.official.score).toBe(scored.score);
    const d = mine.drives[0];
    expect(d.meets).toBe(scored.score >= 500);
    expect(d.short).toBe(Math.max(0, 500 - scored.score));
    expect(d.otherReasons.every((r: string) => !/aptitude/i.test(r))).toBe(true);
  });
});
