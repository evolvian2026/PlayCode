import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("company pages", () => {
  it("lists every company that visited, open drives first", async () => {
    const { companies } = (await t.get(riya, "/student/companies")).body;
    expect(companies.map((c: { company: string }) => c.company)).toEqual(expect.arrayContaining(["TCS", "Infosys", "Zoho", "Accenture", "Freshworks"]));
    const firstClosed = companies.findIndex((c: { openDrive: unknown }) => !c.openDrive);
    expect(companies.slice(firstClosed).every((c: { openDrive: unknown }) => !c.openDrive)).toBe(true);
    expect(companies.find((c: { company: string }) => c.company === "TCS")).toMatchObject({ drives: 1, offers: expect.any(Number), highestCtc: expect.any(Number), years: [2026] });
  });

  it("shows a company's drives, selection numbers and what selected students had", async () => {
    const page = (await t.get(riya, "/student/companies/tcs")).body;
    expect(page.company).toBe("TCS");
    expect(page.drives[0]).toMatchObject({ roleTitle: expect.any(String), rounds: expect.any(Array), registered: expect.any(Number), mine: null });
    expect(page.drives[0].selectionPct).toBe(Math.round((page.drives[0].offers / page.drives[0].registered) * 100));
    expect(page.readiness.selectedMedian).toEqual(expect.any(Number));
    // Riya took part in Zoho's drive.
    expect((await t.get(riya, "/student/companies/Zoho")).body.drives[0].mine).toEqual(expect.any(String));
    expect((await t.get(riya, "/student/companies/Nobody")).status).toBe(404);
  });
});
