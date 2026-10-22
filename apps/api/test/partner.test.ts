import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "../src/content";
import { pool } from "../src/db/client";
import { rightAnswer, setup, type TestApp } from "./helpers";

let t: TestApp;
let sa: string;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeAll(async () => {
  t = await setup();
  sa = await t.login("superadmin@playcode.dev");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("partner programme", () => {
  let partner: string;
  let childId: string;

  it("lets a partner hand out seats from its pool", async () => {
    const created = await t.post(sa, "/admin/tenants", { name: "BrightPath Training", slug: "brightpath", type: "partner", seats: 1000, admin: { name: "BP Admin", email: "admin@brightpath.in", password: "longpassword" } });
    expect(created.status).toBe(200);
    partner = await t.login("admin@brightpath.in", "longpassword");
    expect((await t.get(partner, "/me")).body.user.roles).toEqual(["partner_admin"]);

    const child = await t.post(partner, "/admin/tenants", { name: "Dawn Engineering College", slug: "dawn", seats: 600, admin: { name: "Dawn Admin", email: "admin@dawn.edu", password: "longpassword" } });
    expect(child.status).toBe(200);
    expect(child.body.tenant.parentId).toBe(created.body.tenant.id);
    childId = child.body.tenant.id;
    const tooMany = await t.post(partner, "/admin/tenants", { name: "Too Big", slug: "too-big", seats: 500, admin: { name: "X", email: "x@toobig.edu", password: "longpassword" } });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toContain("400 seats");
    expect((await t.post(partner, "/admin/tenants", { name: "Rogue", slug: "rogue-partner", type: "partner", admin: { name: "X", email: "x@rogue.in", password: "longpassword" } })).status).toBe(403);

    expect((await t.put(partner, `/admin/tenants/${childId}`, { seats: 300 })).status).toBe(200);
    const overview = (await t.get(partner, "/admin/partner/overview")).body;
    expect(overview.seats).toEqual({ total: 1000, allocated: 300, available: 700 });
    expect(overview.tenants[0].name).toBe("Dawn Engineering College");

    const demo = (await t.get(sa, "/admin/tenants")).body.tenants.find((x: { slug: string }) => x.slug === "demo-tech");
    expect((await t.put(partner, `/admin/tenants/${demo.id}`, { seats: 10 })).status).toBe(403);
  });

  it("white-labels the partner's colleges", async () => {
    expect((await t.put(partner, "/console/branding", { logo: "data:image/svg+xml;base64,PHN2Zy8+" })).status).toBe(400);
    const res = await t.put(partner, "/console/branding", { appName: "BrightPath Code", primaryColor: "#0f766e", logo: PNG, certificateSignatory: "Director, BrightPath" });
    expect(res.status).toBe(200);
    const childBrand = (await t.get("", "/public/branding/dawn")).body;
    expect(childBrand).toMatchObject({ tenantName: "Dawn Engineering College", appName: "BrightPath Code", primaryColor: "#0f766e" });
    const logo = await t.app.inject({ method: "GET", url: childBrand.logoUrl });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers["content-type"]).toBe("image/png");
    // The college can override the colour but keeps the partner's name and logo.
    const admin = await t.login("admin@dawn.edu", "longpassword");
    await t.put(admin, "/console/branding", { primaryColor: "#b91c1c" });
    expect((await t.get(admin, "/me")).body.branding).toMatchObject({ appName: "BrightPath Code", primaryColor: "#b91c1c" });
    expect((await t.get("", "/public/branding/nope")).status).toBe(404);
  });

  it("lets partners and platform admins work inside a college", async () => {
    const switched = await t.post(partner, "/auth/switch-tenant", { tenantId: childId });
    expect(switched.status).toBe(200);
    expect(switched.body.tenant.name).toBe("Dawn Engineering College");
    expect(switched.body.switched).toBe(true);
    const inside = switched.body.token;
    const unit = await t.post(inside, "/console/org-units", { name: "CSE 2028", kind: "batch" });
    expect(unit.status).toBe(200);
    expect((await t.get(inside, "/console/org-units")).body.units.map((u: { name: string }) => u.name)).toEqual(["CSE 2028"]);

    const demo = (await t.get(sa, "/admin/tenants")).body.tenants.find((x: { slug: string }) => x.slug === "demo-tech");
    expect((await t.post(partner, "/auth/switch-tenant", { tenantId: demo.id })).status).toBe(403);
    const support = await t.post(sa, "/auth/switch-tenant", { tenantId: demo.id });
    expect(support.status).toBe(200);
    expect((await t.get(support.body.token, "/console/students")).body.students.length).toBeGreaterThan(30);
    // Switching back returns to the home tenant.
    const back = await t.post(inside, "/auth/switch-tenant", { tenantId: null });
    expect(back.body.tenant.name).toBe("BrightPath Training");
  });
});

describe("certificates", () => {
  it("issues a verifiable certificate for a passed mission", async () => {
    const tpo = await t.login("tpo@demo.edu");
    const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
    await t.post(tpo, "/console/students/import", { unitId: units[0]!.id, csv: "Cert Holder,cert@demo.edu,C1", defaultPassword: "student-pass-1" });
    const s = await t.login("cert@demo.edu", "student-pass-1");
    const mission = PACKS.find((p) => p.id === "mission-service-pseudocode")!;
    let session = (await t.post(s, "/student/sessions", { kind: "pack", packId: mission.id })).body;
    let last;
    while (!session.finished) {
      const qid = session.question.id;
      last = (await t.post(s, `/student/sessions/${session.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 10_000 })).body;
      session = last.session;
    }
    expect(session.passed).toBe(true);
    const code = last.certificate as string;
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    const verified = (await t.get("", `/public/certificates/${code}`)).body;
    expect(verified).toMatchObject({ valid: true, holder: "Cert Holder", title: mission.title, scorePct: 100, institution: "Demo Institute of Technology" });
    expect((await t.get(s, "/student/certificates")).body.certificates[0].code).toBe(code);
    expect((await t.get("", "/public/certificates/AAAAAAAAAA")).body.valid).toBe(false);
  });
});
