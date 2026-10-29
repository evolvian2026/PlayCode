import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, db } from "../src/db/client";
import { setMailer, type Mail } from "../src/lib/mailer";
import { sendGuardianReports } from "../src/services/guardians";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let admin: string;
let token: string;
const sent: Mail[] = [];
const parent = { name: "Mr. Vikram Kapoor", relation: "father", email: "vikram.kapoor@example.com", consent: true };
const linkIn = (m: Mail) => /\/guardian\/(\S+)/.exec(m.text)![1]!;

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  admin = await t.login("admin@demo.edu");
  setMailer({ send: async (m) => void sent.push(m) });
});

afterAll(async () => {
  setMailer(undefined);
  await t.app.close();
  await pool.end();
});

describe("progress emails to parents", () => {
  it("are off until the institution switches them on", async () => {
    expect((await t.get(riya, "/student/guardian")).body).toMatchObject({ enabled: false, guardian: null });
    expect((await t.put(riya, "/student/guardian", parent)).status).toBe(400);
    expect((await t.put(await t.login("tpo@demo.edu"), "/console/guardian-reports", { enabled: true })).status).toBe(403);
    expect((await t.put(admin, "/console/guardian-reports", { enabled: true })).body).toMatchObject({ enabled: true, active: 0, waiting: 0 });
  });

  it("need the student's agreement and the parent's confirmation", async () => {
    expect((await t.put(riya, "/student/guardian", { ...parent, consent: false })).status).toBe(400);
    expect((await t.put(riya, "/student/guardian", { ...parent, email: "student@demo.edu" })).status).toBe(400);
    const res = await t.put(riya, "/student/guardian", parent);
    expect(res.status).toBe(200);
    expect(res.body.guardian).toMatchObject({ status: "waiting", email: parent.email });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: parent.email, subject: expect.stringContaining("Riya Kapoor") });
    token = linkIn(sent[0]!);
    // Nothing goes out before the parent confirms.
    expect((await sendGuardianReports(db, new Date("2026-11-01T04:00:00Z"))).sent).toBe(0);
    expect((await t.get(riya, `/public/guardian/${token.slice(0, -2)}xx`)).status).toBe(404);
    expect((await t.get(riya, `/public/guardian/${token}`)).body).toMatchObject({ student: "Riya Kapoor", status: "waiting", institution: expect.any(String) });
    expect((await t.post(riya, `/public/guardian/${token}/confirm`, {})).body.status).toBe("active");
    expect((await t.get(riya, "/student/guardian")).body.guardian.status).toBe("active");
    expect((await t.get(admin, "/console/guardian-reports")).body).toMatchObject({ active: 1, waiting: 0 });
  });

  it("send last month's summary once, from 9 on the 1st", async () => {
    expect((await sendGuardianReports(db, new Date("2026-10-31T10:00:00Z"))).sent).toBe(0);
    expect((await sendGuardianReports(db, new Date("2026-11-01T03:00:00Z"))).sent).toBe(0); // 8:30 in Kolkata
    expect((await sendGuardianReports(db, new Date("2026-11-01T04:00:00Z"))).sent).toBe(1);
    expect((await sendGuardianReports(db, new Date("2026-11-01T05:00:00Z"))).sent).toBe(0);
    const mail = sent.at(-1)!;
    expect(mail.subject).toBe("Riya Kapoor: October 2026 progress on PlayCode");
    expect(mail.text).toContain("Dear Mr. Vikram Kapoor,");
    expect(mail.text).toMatch(/Practice: \d+ days?, \d+ questions answered/);
    expect(mail.text).toContain("Placement readiness:");
    expect(mail.text).toContain(`/guardian/${token}`);
  });

  it("can be stopped by the parent, and the student can't restart them", async () => {
    expect((await t.post(riya, `/public/guardian/${token}/stop`, {})).body.status).toBe("stopped");
    expect((await sendGuardianReports(db, new Date("2026-12-01T05:00:00Z"))).sent).toBe(0);
    expect((await t.get(riya, "/student/guardian")).body.guardian).toMatchObject({ status: "stopped", stoppedBy: "guardian" });
    expect((await t.put(riya, "/student/guardian", parent)).status).toBe(400);
  });

  it("forget the address when the student removes it, and a new address gets a new link", async () => {
    expect((await t.delete(riya, "/student/guardian")).body.guardian).toBeNull();
    expect((await t.get(riya, `/public/guardian/${token}`)).status).toBe(404);
    await t.put(riya, "/student/guardian", { ...parent, name: "Mrs. Sunita Kapoor", relation: "mother", email: "sunita.kapoor@example.com" });
    const fresh = linkIn(sent.at(-1)!);
    expect(fresh).not.toBe(token);
    const exported = (await t.get(riya, "/privacy/export")).body;
    expect(exported.guardian).toMatchObject({ email: "sunita.kapoor@example.com", relation: "mother" });
    expect(exported.consents.filter((c: { purpose: string }) => c.purpose === "guardian_reports").map((c: { granted: boolean }) => c.granted).sort()).toEqual([false, true, true]); // granted, withdrawn, granted again
  });
});
