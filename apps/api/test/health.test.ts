import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let superAdmin: string;

beforeAll(async () => {
  t = await setup();
  superAdmin = await t.login("superadmin@playcode.dev");
  await t.login("tpo@demo.edu"); // a staff sign-in this week
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

type Customer = { name: string; status: string; reasons: string[]; students: number; weeklyActive: number; weeklyActivePct: number; staffActive7: number; partner: string | null; licenceDaysLeft: number | null };
const find = (list: Customer[], name: string) => list.find((c) => c.name === name)!;

describe("customer health", () => {
  it("shows PlayCode staff how every customer is using PlayCode", async () => {
    const res = await t.get(superAdmin, "/admin/health");
    expect(res.status).toBe(200);
    const demo = find(res.body.customers, "Demo Institute of Technology");
    expect(demo).toMatchObject({ students: 31, staffActive7: 1, partner: null });
    expect(demo.weeklyActive).toBeGreaterThan(0);
    expect(demo.weeklyActivePct).toBe(Math.round((demo.weeklyActive / 31) * 100));
    expect(demo.licenceDaysLeft).toBeGreaterThan(60);
    // Sunrise's students have never practised and nobody from the college has signed in.
    const sunrise = find(res.body.customers, "Sunrise Engineering College");
    expect(sunrise).toMatchObject({ status: "at_risk", partner: "SkillBridge Training Partners" });
    expect(sunrise.reasons).toEqual(["Only 0% of students active this week", "No staff have used the console in 2 weeks", "1% of seats in use"]);
    // Partners themselves are not listed; their colleges are. At-risk accounts come first.
    expect(res.body.customers.map((c: Customer) => c.name)).not.toContain("SkillBridge Training Partners");
    expect(res.body.customers[0].status).toBe("at_risk");
    expect(res.body.summary.customers).toBe(res.body.customers.length);
  });

  it("shows partners their own colleges only", async () => {
    const partner = await t.login("partner@skillbridge.in");
    const res = (await t.get(partner, "/admin/health")).body;
    expect(res.customers.map((c: Customer) => c.name)).toEqual(["Sunrise Engineering College"]);
    expect((await t.get(await t.login("admin@demo.edu"), "/admin/health")).status).toBe(403);
  });

  it("flags overdue invoices and exports a CSV", async () => {
    await t.post(superAdmin, "/admin/billing/run", { period: "2026-09" });
    t.clock.now = new Date(START.getTime() + 60 * 86_400_000);
    const demo = find((await t.get(superAdmin, "/admin/health")).body.customers, "Demo Institute of Technology");
    expect(demo.status).toBe("at_risk");
    expect(demo.reasons.some((r) => /^Invoice overdue by \d+ days$/.test(r))).toBe(true);
    const csv = await t.app.inject({ method: "GET", url: "/admin/health/export", headers: { authorization: `Bearer ${superAdmin}` } });
    expect(csv.body.split("\n")[0]).toContain("customer,partner,plan,seats,students,weekly_active");
  });
});
