import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { auditLogs, responses, users } from "../src/db/schema";
import { audit } from "../src/lib/audit";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;

beforeAll(async () => {
  t = await setup();
  admin = await t.login("admin@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("consent", () => {
  it("records the privacy notice and WhatsApp choices in a ledger", async () => {
    const student = await t.login("student@demo.edu");
    expect((await t.get(student, "/privacy")).body).toMatchObject({ noticeAccepted: false, history: [], canRequestErasure: true });
    expect((await t.post(student, "/privacy/notice", { accept: true })).body.noticeAccepted).toBe(true);
    await t.put(student, "/student/settings", { whatsapp: false });
    await t.put(student, "/student/settings", { whatsapp: true });
    const { history } = (await t.get(student, "/privacy")).body;
    expect(history.map((h: { purpose: string; granted: boolean }) => `${h.purpose}:${h.granted}`).sort()).toEqual(["privacy_notice:true", "whatsapp:false", "whatsapp:true"]);
    expect((await t.get(admin, "/privacy")).body.canRequestErasure).toBe(false);
  });
});

describe("data export", () => {
  it("gives students a copy of their data without secrets", async () => {
    const student = await t.login("student@demo.edu");
    const res = await t.app.inject({ method: "GET", url: "/privacy/export", headers: { authorization: `Bearer ${student}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const data = res.json();
    expect(data.account.email).toBe("student@demo.edu");
    expect(data.account).not.toHaveProperty("passwordHash");
    expect(data.answers.length).toBeGreaterThan(20);
    expect(data.profile.xp).toBeGreaterThan(0);
    expect(data.memberships[0]).toMatchObject({ role: "student", unit: "CSE 2027 - A" });
    expect(res.body).not.toMatch(/\$2[aby]\$/); // no bcrypt hashes anywhere
  });

  it("lets admins export a student in their scope", async () => {
    const students = (await t.get(admin, "/console/students")).body.students as { id: string; email: string }[];
    const riya = students.find((s) => s.email === "student@demo.edu")!;
    expect((await t.get(admin, `/console/students/${riya.id}/export`)).body.account.email).toBe("student@demo.edu");
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, `/console/students/${riya.id}/export`)).status).toBe(403);
  });
});

describe("erasure", () => {
  let target: { id: string; email: string };
  let studentToken: string;

  it("lets a student request and cancel deletion", async () => {
    const students = (await t.get(admin, "/console/students")).body.students as { id: string; email: string; xp: number }[];
    target = students.find((s) => s.email !== "student@demo.edu" && s.xp > 0)!;
    studentToken = await t.login(target.email);
    expect((await t.post(studentToken, "/privacy/erasure", { reason: "Leaving the college" })).status).toBe(200);
    expect((await t.post(studentToken, "/privacy/erasure", {})).status).toBe(409);
    expect((await t.post(studentToken, "/privacy/erasure/cancel", {})).status).toBe(200);
    expect((await t.get(studentToken, "/privacy")).body.erasure.status).toBe("cancelled");
    expect((await t.post(studentToken, "/privacy/erasure", { reason: "Please delete my data" })).status).toBe(200);
  });

  it("needs a reason to decline and the right permission to act", async () => {
    const pending = (await t.get(admin, "/console/privacy/requests")).body.requests.find((r: { status: string }) => r.status === "pending");
    expect(pending).toMatchObject({ email: target.email, reason: "Please delete my data" });
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, "/console/privacy/requests")).status).toBe(403);
    expect((await t.post(admin, `/console/privacy/requests/${pending.id}`, { decision: "reject" })).status).toBe(409);
  });

  it("erases the student and cuts off their session", async () => {
    await audit(db, { tenantId: null, actorId: target.id, action: "test.marker", data: { email: target.email, other: 1 } });
    const pending = (await t.get(admin, "/console/privacy/requests")).body.requests.find((r: { status: string }) => r.status === "pending");
    const res = await t.post(admin, `/console/privacy/requests/${pending.id}`, { decision: "erase", note: "Done" });
    expect(res.body.status).toBe("completed");
    expect((await t.post(admin, `/console/privacy/requests/${pending.id}`, { decision: "erase" })).status).toBe(409);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row).toMatchObject({ name: "Deleted user", status: "erased", phone: null, rollNo: null });
    expect(row!.email).not.toContain(target.email.split("@")[0]);
    expect(await db.select().from(responses).where(eq(responses.userId, target.id))).toHaveLength(0);
    const [marker] = await db.select().from(auditLogs).where(eq(auditLogs.action, "test.marker"));
    expect(marker!.data).toEqual({ other: 1 });

    expect((await t.get(studentToken, "/me")).status).toBe(401);
    expect((await t.post("", "/auth/login", { email: target.email, password: "playcode123" })).status).toBe(401);
    const students = (await t.get(admin, "/console/students")).body.students as { id: string }[];
    expect(students.some((s) => s.id === target.id)).toBe(false);
    const done = (await t.get(admin, "/console/privacy/requests")).body.requests.find((r: { id: string }) => r.id === pending.id);
    expect(done).toMatchObject({ status: "completed", name: "Deleted user" });
  });
});

describe("audit log", () => {
  it("pages through the institution's log and filters by action", async () => {
    const me = (await t.get(admin, "/me")).body;
    // Same-millisecond entries must not be skipped or repeated across pages.
    const at = new Date();
    await db.insert(auditLogs).values(Array.from({ length: 12 }, (_, i) => ({ tenantId: me.tenant.id, actorId: me.user.id, action: "test.bulk", data: { i }, createdAt: at })));
    const total = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, me.tenant.id))).length;
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await t.get(admin, `/console/audit?limit=5${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      for (const e of res.body.entries) {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
      }
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(seen.size).toBe(total);

    const privacy = (await t.get(admin, "/console/audit?action=privacy.")).body;
    expect(privacy.entries.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["privacy.erased", "privacy.erasure_requested", "privacy.erasure_cancelled"]),
    );
    expect(privacy.entries.every((e: { action: string }) => e.action.startsWith("privacy."))).toBe(true);
    expect(privacy.actions).toContain("privacy.erased");
    // Marker was logged without a tenant, so it is not in this institution's log.
    expect(privacy.actions).not.toContain("test.marker");

    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, "/console/audit")).status).toBe(403);
  });
});
