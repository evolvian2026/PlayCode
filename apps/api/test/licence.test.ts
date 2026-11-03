import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { tenants } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let student: string;
let admin: string;
let superAdmin: string;
let apiToken: string;
const DAY = 86_400_000;
const demoId = async () => (await db.select().from(tenants).where(eq(tenants.slug, "demo-tech")))[0]!.id;

beforeAll(async () => {
  t = await setup();
  student = await t.login("student@demo.edu");
  admin = await t.login("admin@demo.edu");
  superAdmin = await t.login("superadmin@playcode.dev");
  const client = await t.post(admin, "/console/api-clients", { name: "ERP", scopes: ["users:read", "users:write"] });
  apiToken = (await t.post("", "/v1/oauth/token", { grant_type: "client_credentials", client_id: client.body.client.clientId, client_secret: client.body.clientSecret })).body.access_token;
  // Demo's licence ended on 10 Oct; START is 22 Oct, inside the 14-day grace period.
  await db.update(tenants).set({ validUntil: "2026-10-10" }).where(eq(tenants.id, await demoId()));
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("licence lifecycle", () => {
  it("keeps full access during the grace period, with a warning", async () => {
    expect((await t.get(student, "/me")).body.licence).toMatchObject({ state: "grace", validUntil: "2026-10-10", graceEndsOn: "2026-10-24" });
    expect((await t.post(student, "/student/sessions", { kind: "daily" })).status).toBe(200);
  });

  it("goes read-only after the grace period, keeping data and privacy rights", async () => {
    t.clock.now = new Date(START.getTime() + 4 * DAY); // 26 Oct
    expect((await t.get(student, "/me")).body.licence.state).toBe("expired");
    const blocked = await t.post(student, "/student/sessions", { kind: "skill", skillId: "loops.for" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatchObject({ code: "licence_expired" });
    expect(blocked.body.error.message).toContain("ended on 10 Oct 2026");
    // Reading still works, and so do data export, settings and signing out.
    expect((await t.get(student, "/student/home")).status).toBe(200);
    expect((await t.get(student, "/privacy/export")).status).toBe(200);
    expect((await t.put(student, "/student/settings", { locale: "hi" })).status).toBe(200);
    // Staff can't make changes, but can still sort out billing.
    expect((await t.post(admin, "/console/assignments", { title: "x" })).body.error.code).toBe("licence_expired");
    expect((await t.put(admin, "/console/billing/profile", { legalName: "Demo Institute of Technology", gstin: null, address: "1 College Road, Bengaluru", stateCode: "29", email: "accounts@demo.edu" })).status).toBe(200);
    // Integrations are read-only too.
    const v1 = await t.app.inject({ method: "POST", url: "/v1/users", headers: { authorization: `Bearer ${apiToken}` }, payload: { unit_id: "00000000-0000-0000-0000-000000000000", users: [] } });
    expect(v1.statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: "/v1/org-units", headers: { authorization: `Bearer ${apiToken}` } })).statusCode).toBe(200);
  });

  it("applies a partner's end date to its colleges", async () => {
    const [partner] = await db.select().from(tenants).where(eq(tenants.slug, "skillbridge"));
    await db.update(tenants).set({ validUntil: "2026-10-01" }).where(eq(tenants.id, partner!.id));
    const sunrise = await t.login("sunrise.student1@sunrise.edu");
    expect((await t.get(sunrise, "/me")).body.licence).toMatchObject({ state: "expired", validUntil: "2026-10-01" });
    expect((await t.post(sunrise, "/student/sessions", { kind: "daily" })).status).toBe(403);
    // A partner can't renew a college beyond its own licence.
    const partnerAdmin = await t.login("partner@skillbridge.in");
    const [sunriseRow] = await db.select().from(tenants).where(eq(tenants.slug, "sunrise"));
    expect((await t.post(partnerAdmin, `/admin/tenants/${sunriseRow!.id}/renew`, { months: 12 })).status).toBe(400);
    await db.update(tenants).set({ validUntil: null }).where(eq(tenants.id, partner!.id));
  });

  it("is renewed by PlayCode and works again at once", async () => {
    const res = await t.post(superAdmin, `/admin/tenants/${await demoId()}/renew`, { months: 12 });
    expect(res.body.tenant.validUntil).toBe("2027-10-26"); // from today, since it had lapsed
    expect((await t.get(student, "/me")).body.licence.state).toBe("active");
    expect((await t.post(student, "/student/sessions", { kind: "skill", skillId: "loops.for" })).status).toBe(200);
    expect((await t.post(admin, `/admin/tenants/${await demoId()}/renew`, { months: 12 })).status).toBe(403);
  });
});
