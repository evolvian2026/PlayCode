import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { consents, studentProfiles, tenants, users } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let recruiter: string;
let riyaId: string;
const DAY = 86_400_000;

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  recruiter = await t.login("recruiter@acme.dev");
  [{ id: riyaId }] = (await db.select({ id: users.id }).from(users).where(eq(users.email, "student@demo.edu"))) as [{ id: string }];
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

/** Another talent-pool student with a sign-in. */
async function poolStudent(index: number) {
  const rows = await db.select({ id: users.id, email: users.email }).from(studentProfiles).innerJoin(users, eq(users.id, studentProfiles.userId)).where(eq(studentProfiles.discoverable, true)).orderBy(users.email);
  const s = rows.filter((r) => r.id !== riyaId)[index]!;
  return { ...s, token: await t.login(s.email) };
}

describe("talent pool", () => {
  it("shows a student their invitation and lets them manage being found", async () => {
    const mine = (await t.get(riya, "/student/talent")).body;
    expect(mine).toMatchObject({ allowed: true, discoverable: true });
    expect(mine.invites).toHaveLength(1);
    expect(mine.invites[0]).toMatchObject({ company: "Acme Technologies", roleTitle: "Graduate Engineer Trainee", status: "pending", applyUrl: null });
    // A college that hasn't opened the pool: its students can't join.
    const sunrise = await t.login("sunrise.student1@sunrise.edu");
    expect((await t.get(sunrise, "/student/talent")).body.allowed).toBe(false);
    expect((await t.put(sunrise, "/student/talent", { discoverable: true })).status).toBe(403);
  });

  it("lets companies search by measured readiness, skills, year and place", async () => {
    let res = await t.get(recruiter, "/console/talent/search?track=service");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    const scores = res.body.candidates.map((c: { readiness: { service: number } }) => c.readiness.service);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const me = res.body.candidates.find((c: { userId: string }) => c.userId === riyaId);
    expect(me).toMatchObject({ name: "Riya Kapoor", institution: "Demo Institute of Technology", invite: { status: "pending" } });
    expect(JSON.stringify(res.body)).not.toContain("@demo.edu"); // no contact details before they accept

    const top = scores[0] as number;
    res = await t.get(recruiter, `/console/talent/search?track=service&minReadiness=${top}`);
    expect(res.body.candidates.every((c: { readiness: { service: number } }) => c.readiness.service >= top)).toBe(true);
    expect(res.body.total).toBeLessThan(10);
    // Students who named other cities are left out; those who named none stay in.
    const anywhere = (await t.get(recruiter, "/console/talent/search?track=service&location=Chennai")).body.total;
    const pune = (await t.get(recruiter, "/console/talent/search?track=service&location=pune")).body.total;
    expect(anywhere).toBeLessThan(10);
    expect(pune).toBe(10);
    const withSkill = (await t.get(recruiter, "/console/talent/search?track=service&skills=loops.for")).body;
    expect(withSkill.total).toBeLessThanOrEqual(10);
    expect((await t.get(recruiter, "/console/talent/search?track=service&skills=sql.basics,coding.basics,oop.inheritance")).body.total).toBe(0);
  });

  it("is only for companies on a plan that includes it", async () => {
    const tpo = await t.login("tpo@demo.edu");
    expect((await t.get(tpo, "/console/talent/search")).status).toBe(403);
    const admin = await t.login("admin@demo.edu");
    expect((await t.get(admin, "/console/talent/search")).body.error.message).toContain("companies");
    const [acme] = await db.select().from(tenants).where(eq(tenants.slug, "acme"));
    await db.update(tenants).set({ plan: "pro" }).where(eq(tenants.id, acme!.id));
    expect((await t.get(recruiter, "/console/talent/search")).status).toBe(402);
    await db.update(tenants).set({ plan: "enterprise" }).where(eq(tenants.id, acme!.id));
  });

  it("shows a candidate's verified profile, not their contact details", async () => {
    const p = (await t.get(recruiter, `/console/talent/candidates/${riyaId}`)).body;
    expect(p).toMatchObject({ name: "Riya Kapoor", institution: "Demo Institute of Technology" });
    expect(p.readiness).toHaveLength(2);
    expect(p.email).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("student@demo.edu");
    const sunriseId = (await db.select().from(users).where(eq(users.email, "sunrise.student1@sunrise.edu")))[0]!.id;
    expect((await t.get(recruiter, `/console/talent/candidates/${sunriseId}`)).status).toBe(404);
  });

  it("shares contact details only when the student accepts", async () => {
    expect((await t.post(recruiter, "/console/talent/invites", { userId: riyaId, roleTitle: "SDE", message: "Another invitation for you." })).status).toBe(409);
    const other = await poolStudent(0);
    const sent = await t.post(recruiter, "/console/talent/invites", { userId: other.id, roleTitle: "Support Engineer", message: "We liked your practice record. Interested?" });
    expect(sent.status).toBe(200);
    const inbox = (await t.get(other.token, "/student/notifications")).body.items;
    expect(inbox[0]).toMatchObject({ title: "Acme Technologies invited you to apply" });

    let list = (await t.get(recruiter, "/console/talent/invites")).body;
    expect(list.invites.every((i: { contact: unknown }) => i.contact === null)).toBe(true);
    const id = list.invites.find((i: { userId: string }) => i.userId === riyaId).id;
    const accepted = (await t.post(riya, `/student/talent/invites/${id}/accept`)).body;
    expect(accepted.invites[0]).toMatchObject({ status: "accepted" });
    expect(accepted.invites[0].applyUrl).toMatch(/\/apply\//);
    expect((await t.post(riya, `/student/talent/invites/${id}/decline`)).status).toBe(409);
    list = (await t.get(recruiter, "/console/talent/invites")).body;
    expect(list.invites.find((i: { userId: string }) => i.userId === riyaId).contact).toMatchObject({ email: "student@demo.edu" });
    expect(list.left).toBe(48);

    // A student's own invitations only.
    const otherInvite = list.invites.find((i: { userId: string }) => i.userId === other.id).id;
    expect((await t.post(riya, `/student/talent/invites/${otherInvite}/accept`)).status).toBe(404);
    await t.post(other.token, `/student/talent/invites/${otherInvite}/decline`);
    const again = await t.post(recruiter, "/console/talent/invites", { userId: other.id, roleTitle: "Support Engineer", message: "Would you reconsider our offer?" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("recently_declined");
  });

  it("lets unanswered invitations lapse", async () => {
    const third = await poolStudent(1);
    await t.post(recruiter, "/console/talent/invites", { userId: third.id, roleTitle: "Trainee", message: "We would like you to apply." });
    t.clock.now = new Date(START.getTime() + 31 * DAY);
    const mine = (await t.get(third.token, "/student/talent")).body;
    expect(mine.invites[0].status).toBe("expired");
    expect((await t.post(third.token, `/student/talent/invites/${mine.invites[0].id}/accept`)).status).toBe(409);
    // A lapsed invitation doesn't block a new one.
    expect((await t.post(recruiter, "/console/talent/invites", { userId: third.id, roleTitle: "Trainee", message: "We would still like you to apply." })).status).toBe(200);
    t.clock.now = new Date(START);
  });

  it("shows the placement cell which companies are interested", async () => {
    const tpo = await t.login("tpo@demo.edu");
    const view = (await t.get(tpo, "/console/talent/institution")).body;
    expect(view).toMatchObject({ open: true, inPool: 10 });
    expect(view.companies).toEqual([{ company: "Acme Technologies", invited: 4, accepted: 1 }]);
    expect(view.invites.find((i: { userId: string }) => i.userId === riyaId)).toMatchObject({ student: "Riya Kapoor", status: "accepted" });
  });

  it("drops students who leave, and everyone when the college closes the pool", async () => {
    const leave = await t.put(riya, "/student/talent", { discoverable: false });
    expect(leave.body.discoverable).toBe(false);
    expect((await t.get(recruiter, "/console/talent/search")).body.total).toBe(9);
    const ledger = await db.select().from(consents).where(and(eq(consents.userId, riyaId), eq(consents.purpose, "talent_pool")));
    expect(ledger.map((c) => c.granted)).toEqual([true, false]);
    const admin = await t.login("admin@demo.edu");
    expect((await t.put(admin, "/console/talent/institution", { open: false })).body.open).toBe(false);
    expect((await t.get(recruiter, "/console/talent/search")).body.total).toBe(0);
  });
});
