import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let token: string;

const get = async (url: string) => {
  const res = await t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: res.headers["content-type"]?.toString().startsWith("application/json") ? res.json() : res.body, headers: res.headers };
};

beforeAll(async () => {
  t = await setup();
  const admin = await t.login("admin@demo.edu");
  const created = await t.post(admin, "/console/api-clients", { name: "Power BI", scopes: ["reports:read"] });
  const res = await t.post("", "/v1/oauth/token", { grant_type: "client_credentials", client_id: created.body.client.clientId, client_secret: created.body.clientSecret });
  token = res.body.access_token;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

const today = START.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(START.getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe("reporting API", () => {
  it("needs the reports:read scope", async () => {
    const admin = await t.login("admin@demo.edu");
    const other = await t.post(admin, "/console/api-clients", { name: "ERP", scopes: ["users:read"] });
    const erp = (await t.post("", "/v1/oauth/token", { grant_type: "client_credentials", client_id: other.body.client.clientId, client_secret: other.body.clientSecret })).body.access_token;
    const res = await t.app.inject({ method: "GET", url: "/v1/reports/readiness", headers: { authorization: `Bearer ${erp}` } });
    expect(res.statusCode).toBe(403);
    expect((await get("/v1/users")).status).toBe(403); // and reports:read alone reads nothing else
  });

  it("reports daily engagement, overall and per section", async () => {
    const res = await get(`/v1/reports/engagement/daily?from=${daysAgo(14)}&to=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.time_zone).toBe("Asia/Kolkata");
    expect(res.body.data.length).toBeGreaterThan(5);
    const row = res.body.data[0];
    expect(Object.keys(row)).toEqual(["date", "active_students", "answers", "correct", "accuracy_pct", "practice_minutes"]);
    expect(row.correct).toBeLessThanOrEqual(row.answers);
    const units = await get(`/v1/reports/engagement/daily?from=${daysAgo(14)}&to=${today}&group_by=unit`);
    const sections = new Set(units.body.data.map((r: { unit: string }) => r.unit));
    expect(sections).toEqual(new Set(["CSE 2027 - A", "CSE 2027 - B", "ECE 2027 - A"]));
    // Per-section rows add up to the overall numbers.
    const total = (rows: { answers: number }[]) => rows.reduce((a, r) => a + r.answers, 0);
    expect(total(units.body.data)).toBe(total(res.body.data));
    expect((await get(`/v1/reports/engagement/daily?from=2025-01-01&to=${today}`)).status).toBe(400);
  });

  it("pages through skill mastery without gaps or repeats", async () => {
    const all = (await get("/v1/reports/skill-mastery?limit=5000")).body.data as { user_id: string; skill_id: string }[];
    expect(all.length).toBeGreaterThan(20);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/v1/reports/skill-mastery?limit=37${cursor ? `&cursor=${cursor}` : ""}`);
      for (const r of res.body.data) seen.push(`${r.user_id}:${r.skill_id}`);
      cursor = res.body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.map((r) => `${r.user_id}:${r.skill_id}`));
    expect((await get("/v1/reports/skill-mastery?cursor=nonsense")).status).toBe(400);
  });

  it("gives readiness and placement rows, as JSON or CSV", async () => {
    const readiness = (await get("/v1/reports/readiness")).body.data;
    expect(readiness).toHaveLength(31);
    expect(readiness[0]).toHaveProperty("service_band");
    const csv = await get("/v1/reports/placements?format=csv&limit=10");
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = (csv.body as string).split("\n");
    expect(lines[0]).toBe("drive_id,company,company_type,role,drive_date,drive_ctc,user_id,roll_no,status,rounds_cleared,rounds_total,offer_ctc,readiness_at_registration,practice_days_60_before,registered_at");
    expect(lines).toHaveLength(11);
    expect(csv.headers["x-next-cursor"]).toBeTruthy();
  });
});
