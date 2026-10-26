import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { auditLogs, memberships, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let scimToken: string;
let units: { id: string; name: string }[];
const unit = (name: string) => units.find((u) => u.name === name)!.id;

/** A SCIM call as an identity provider makes it. */
async function scim(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, token = scimToken) {
  const res = await t.app.inject({
    method,
    url: `/scim/v2${url}`,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/scim+json" } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.statusCode, type: String(res.headers["content-type"]), location: res.headers.location, body: res.body ? res.json() : null };
}

const patch = (...ops: { op: string; path?: string; value?: unknown }[]) => ({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: ops });
const groupIds = (u: { groups: { value: string }[] }) => u.groups.map((g) => g.value).sort();

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
  units = (await t.get(admin, "/console/org-units")).body.units;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("SCIM provisioning", () => {
  it("is set up from the console by an admin on the Enterprise plan", async () => {
    expect((await t.get(await t.login("admin@sunrise.edu"), "/console/scim")).status).toBe(402);
    expect((await t.get(await t.login("student@demo.edu"), "/console/scim")).status).toBe(403);
    expect((await t.get(admin, "/console/scim")).body).toMatchObject({ connection: null, baseUrl: expect.stringMatching(/\/scim\/v2$/) });
    expect((await t.put(admin, "/console/scim", { defaultUnitId: unit("CSE 2027") })).status).toBe(404); // not connected yet

    const first = (await t.post(admin, "/console/scim/token", {})).body.token;
    expect(first).toMatch(/^scim_/);
    // Rotating replaces the token at once.
    scimToken = (await t.post(admin, "/console/scim/token", {})).body.token;
    expect((await scim("GET", "/Users", undefined, first)).status).toBe(401);
    const bad = await scim("GET", "/Users", undefined, "scim_nope");
    expect(bad.status).toBe(401);
    expect(bad.type).toContain("application/scim+json");
    expect(bad.body).toMatchObject({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "401" });

    const config = await scim("GET", "/ServiceProviderConfig");
    expect(config.body).toMatchObject({ patch: { supported: true }, bulk: { supported: false }, filter: { supported: true } });
    expect((await scim("GET", "/ResourceTypes")).body.Resources.map((r: { id: string }) => r.id)).toEqual(["User", "Group"]);
    expect((await scim("GET", "/Nope")).body).toMatchObject({ status: "404" });
  });

  let ananya: string;

  it("creates students in the default batch, matching existing ones by userName", async () => {
    const entraUser = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
      externalId: "8f1c-ananya",
      userName: "Ananya.Iyer@demo.edu",
      active: true,
      displayName: "Ananya Iyer",
      name: { givenName: "Ananya", familyName: "Iyer" },
      emails: [{ primary: true, type: "work", value: "Ananya.Iyer@demo.edu" }],
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { employeeNumber: "CSE27X101" },
    };
    // No default batch yet.
    expect((await scim("POST", "/Users", entraUser)).body.detail).toMatch(/default batch/);
    expect((await t.put(admin, "/console/scim", { defaultUnitId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect((await t.put(admin, "/console/scim", { defaultUnitId: unit("CSE 2027") })).status).toBe(200);

    // Entra looks the user up first, then creates.
    expect((await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "ananya.iyer@demo.edu"')}`)).body).toMatchObject({ totalResults: 0, Resources: [] });
    const created = await scim("POST", "/Users", entraUser);
    expect(created.status).toBe(201);
    ananya = created.body.id;
    expect(created.location).toMatch(new RegExp(`/scim/v2/Users/${ananya}$`));
    expect(created.body).toMatchObject({
      userName: "ananya.iyer@demo.edu",
      externalId: "8f1c-ananya",
      displayName: "Ananya Iyer",
      active: true,
      groups: [{ value: unit("CSE 2027"), display: "CSE 2027" }],
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { employeeNumber: "CSE27X101" },
    });
    expect((await scim("POST", "/Users", entraUser)).body).toMatchObject({ status: "409", scimType: "uniqueness" });
    // A staff member's email is taken too; staff stay in the console.
    expect((await scim("POST", "/Users", { userName: "tpo@demo.edu" })).status).toBe(409);
    expect((await scim("GET", `/Users?filter=${encodeURIComponent('externalId eq "8f1c-ananya"')}`)).body.Resources[0].id).toBe(ananya);

    // Students added by CSV before the IdP was connected are found and can be linked.
    const riya = (await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "student@demo.edu"')}`)).body.Resources[0];
    expect(riya).toMatchObject({ displayName: "Riya Kapoor", active: true });
    expect((await scim("PATCH", `/Users/${riya.id}`, patch({ op: "Add", path: "externalId", value: "77aa-riya" }))).body.externalId).toBe("77aa-riya");

    // Staff and other colleges' students aren't visible.
    const tpo = (await db.select().from(users).where(eq(users.email, "tpo@demo.edu")))[0]!;
    expect((await scim("GET", `/Users/${tpo.id}`)).status).toBe(404);
    const sunrise = (await db.select().from(users).where(like(users.email, "sunrise.student%")))[0]!;
    expect((await scim("GET", `/Users/${sunrise.id}`)).status).toBe(404);
    expect((await scim("GET", "/Users/not-a-uuid")).status).toBe(404);

    const all = await scim("GET", "/Users?startIndex=2&count=3");
    expect(all.body).toMatchObject({ startIndex: 2, itemsPerPage: 3 });
    expect(all.body.totalResults).toBeGreaterThan(10);
    expect((await scim("GET", `/Users?filter=${encodeURIComponent('title co "x"')}`)).body).toMatchObject({ status: "400", scimType: "invalidFilter" });
  });

  it("applies Entra-style PATCHes and signs out deactivated students", async () => {
    let u = (await scim("PATCH", `/Users/${ananya}`, patch({ op: "Replace", value: { "name.familyName": "Iyer-Rao", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber": "CSE27X102" } }))).body;
    expect(u).toMatchObject({ displayName: "Ananya Iyer-Rao", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { employeeNumber: "CSE27X102" } });
    u = (await scim("PATCH", `/Users/${ananya}`, patch({ op: "replace", path: 'emails[type eq "work"].value', value: "ananya.rao@demo.edu" }))).body;
    expect(u.userName).toBe("ananya.rao@demo.edu");
    expect((await scim("PATCH", `/Users/${ananya}`, patch({ op: "replace", path: "userName", value: "student@demo.edu" }))).status).toBe(409);
    expect((await scim("PATCH", `/Users/${ananya}`, patch({ op: "replace", path: "active", value: "maybe" }))).body.scimType).toBe("invalidValue");
    expect((await scim("PATCH", `/Users/${ananya}`, { Operations: [] })).body.scimType).toBe("invalidSyntax");

    const riyaToken = await t.login("student@demo.edu");
    const riya = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!;
    expect((await t.get(riyaToken, "/me")).status).toBe(200);
    expect((await scim("PATCH", `/Users/${riya.id}`, patch({ op: "Replace", path: "active", value: "False" }))).body.active).toBe(false);
    expect((await t.get(riyaToken, "/me")).status).toBe(401);
    await expect(t.login("student@demo.edu")).rejects.toThrow();
    // Switched back on, she can sign in again.
    expect((await scim("PATCH", `/Users/${riya.id}`, patch({ op: "Replace", path: "active", value: "True" }))).body.active).toBe(true);
    expect((await t.get(await t.login("student@demo.edu"), "/me")).status).toBe(200);

    // PUT replaces the whole user.
    const put = await scim("PUT", `/Users/${ananya}`, { userName: "ananya.rao@demo.edu", displayName: "Ananya Rao", externalId: "8f1c-ananya", active: true });
    expect(put.body).toMatchObject({ displayName: "Ananya Rao" });
    expect(put.body["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"]).toBeUndefined();
  });

  it("maps groups to org units and membership to unit membership", async () => {
    const found = await scim("GET", `/Groups?filter=${encodeURIComponent('displayName eq "cse 2027 - b"')}&excludedAttributes=members`);
    expect(found.body.totalResults).toBe(1);
    expect(found.body.Resources[0]).toEqual(expect.objectContaining({ id: unit("CSE 2027 - B"), displayName: "CSE 2027 - B" }));
    expect(found.body.Resources[0].members).toBeUndefined();
    expect((await scim("POST", "/Groups", { displayName: "CSE 2027 - A" })).body.scimType).toBe("uniqueness");

    // A new group becomes a batch; members move out of the default batch.
    const created = await scim("POST", "/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "Placement Cell 2027", members: [{ value: ananya }] });
    expect(created.status).toBe(201);
    const cell = created.body.id;
    expect(created.body.members).toEqual([expect.objectContaining({ value: ananya, display: "Ananya Rao" })]);
    expect(groupIds((await scim("GET", `/Users/${ananya}`)).body)).toEqual([cell]);
    expect((await t.get(admin, "/console/org-units")).body.units).toContainEqual(expect.objectContaining({ id: cell, kind: "batch", name: "Placement Cell 2027" }));

    // Entra's add and remove, one member at a time.
    const riya = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!;
    await scim("PATCH", `/Groups/${cell}`, patch({ op: "Add", path: "members", value: [{ value: riya.id }] }));
    expect(groupIds((await scim("GET", `/Users/${riya.id}`)).body)).toEqual([unit("CSE 2027 - A"), cell].sort()); // her section isn't the default batch, so she stays in it
    await scim("PATCH", `/Groups/${cell}`, patch({ op: "Remove", path: `members[value eq "${ananya}"]` }));
    expect(groupIds((await scim("GET", `/Users/${ananya}`)).body)).toEqual([unit("CSE 2027")]); // back in the holding pen
    // Leaving the default batch with nowhere else to go does nothing.
    await scim("PATCH", `/Groups/${unit("CSE 2027")}`, patch({ op: "Remove", path: "members", value: [{ value: ananya }] }));
    expect(groupIds((await scim("GET", `/Users/${ananya}`)).body)).toEqual([unit("CSE 2027")]);

    const tpo = (await db.select().from(users).where(eq(users.email, "tpo@demo.edu")))[0]!;
    expect((await scim("PATCH", `/Groups/${cell}`, patch({ op: "Add", path: "members", value: [{ value: tpo.id }] }))).body.scimType).toBe("invalidValue");
    expect((await scim("PATCH", `/Groups/${cell}`, patch({ op: "Replace", path: "displayName", value: "CSE 2027 - B" }))).status).toBe(409);
    const renamed = await scim("PATCH", `/Groups/${cell}`, patch({ op: "Replace", value: { id: cell, displayName: "Placement Cell" } }));
    expect(renamed.body).toMatchObject({ displayName: "Placement Cell", members: [expect.objectContaining({ value: riya.id })] });

    // PUT sets the member list; DELETE empties the group but keeps the unit and its history.
    await scim("PUT", `/Groups/${cell}`, { displayName: "Placement Cell", members: [{ value: ananya }] });
    expect((await scim("GET", `/Groups/${cell}`)).body.members.map((m: { value: string }) => m.value)).toEqual([ananya]);
    expect((await scim("DELETE", `/Groups/${cell}`)).status).toBe(204);
    expect((await scim("GET", `/Groups/${cell}`)).body.members).toEqual([]);
    expect(groupIds((await scim("GET", `/Users/${ananya}`)).body)).toEqual([unit("CSE 2027")]);
    expect(await db.select().from(memberships).where(and(eq(memberships.userId, riya.id), eq(memberships.orgUnitId, unit("CSE 2027 - A"))))).toHaveLength(1);
  });

  it("deactivates on DELETE, keeping the student's history, and audits everything", async () => {
    expect((await scim("DELETE", `/Users/${ananya}`)).status).toBe(204);
    expect((await scim("GET", `/Users/${ananya}`)).body.active).toBe(false);
    const [row] = await db.select().from(users).where(eq(users.id, ananya));
    expect(row!.status).toBe("disabled");
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs).where(like(auditLogs.action, "scim.%"))).map((a) => a.action);
    expect(new Set(actions)).toEqual(new Set(["scim.connect", "scim.token.rotate", "scim.settings", "scim.user.create", "scim.user.update", "scim.group.create", "scim.group.update", "scim.group.delete", "scim.user.deactivate"]));

    // Disconnecting stops the token working.
    expect((await t.delete(admin, "/console/scim")).status).toBe(200);
    expect((await scim("GET", "/Users")).status).toBe(401);
  });
});
