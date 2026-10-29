import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { academicRecords, auditLogs, notifications, users } from "../src/db/schema";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let riyaId: string;
let id: string;
// Messages are ordered by time, so each step happens a minute later.
const tick = () => (t.clock.now = new Date(t.clock.now.getTime() + 60_000));
const ask = (token: string, body: object) => t.post(token, "/student/help", { category: "record", subject: "My CGPA is wrong", message: "The university result shows 8.4 after semester 6.", correction: null, ...body });

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("placement helpdesk", () => {
  it("lets a student ask for a record correction", async () => {
    expect((await ask(riya, { correction: { field: "cgpa", proposed: 11 } })).status).toBe(400);
    expect((await ask(riya, { correction: { field: "cgpa", proposed: 8.1 } })).status).toBe(400); // that's already the value
    expect((await ask(riya, { category: "drive", correction: { field: "cgpa", proposed: 8.4 } })).status).toBe(400);
    const res = await ask(riya, { correction: { field: "cgpa", proposed: 8.4 } });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body).toMatchObject({ status: "open", correction: { field: "cgpa", current: 8.1, proposed: 8.4, status: "pending", label: "CGPA" }, messages: [expect.objectContaining({ fromStaff: false })] });
    expect((await t.get(riya, "/student/help")).body.tickets).toEqual([expect.objectContaining({ id, status: "open", categoryLabel: "My academic record is wrong" })]);
    expect((await t.get(await t.login("aarav.sharma1@demo.edu"), `/student/help/${id}`)).status).toBe(404);
  });

  it("puts it in the placement cell's inbox, and the reply reaches the student", async () => {
    const inbox = (await t.get(tpo, "/console/help")).body;
    expect(inbox.counts.open).toBe(1);
    expect(inbox.tickets[0]).toMatchObject({ id, correctionPending: true, student: { name: "Riya Kapoor" } });
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/help")).status).toBe(403);
    const detail = (await t.get(tpo, `/console/help/${id}`)).body;
    expect(detail.record.cgpa).toBe(8.1);
    tick();
    await t.post(tpo, `/console/help/${id}/reply`, { body: "Please share the semester 6 result PDF." });
    expect((await t.get(riya, `/student/help/${id}`)).body).toMatchObject({ status: "answered", messages: [expect.anything(), expect.objectContaining({ fromStaff: true, author: "Rajesh Sharma (TPO)" })] });
    const note = (await db.select().from(notifications).where(eq(notifications.userId, riyaId))).find((n) => n.title.startsWith("The placement cell answered"));
    expect(note!.body).toContain("semester 6 result");
    tick();
    expect((await t.post(riya, `/student/help/${id}/reply`, { body: "Uploaded it under Documents." })).body.status).toBe("open");
  });

  it("applies the correction to the record drives check, with an audit entry", async () => {
    expect((await t.post(tpo, `/console/help/${id}/correction`, { apply: false })).status).toBe(400);
    tick();
    const res = await t.post(tpo, `/console/help/${id}/correction`, { apply: true });
    expect(res.body.correction.status).toBe("applied");
    expect(res.body.messages.at(-1).body).toBe("Your CGPA is now 8.4 (it was 8.1).");
    expect((await db.select().from(academicRecords).where(eq(academicRecords.userId, riyaId)))[0]!.cgpa).toBe(8.4);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "placements.record_corrected")))[0]).toMatchObject({ data: { field: "cgpa", from: 8.1, to: 8.4 } });
    expect((await t.post(tpo, `/console/help/${id}/correction`, { apply: true })).status).toBe(400);
  });

  it("closes, limits open questions, and is in the data export", async () => {
    expect((await t.post(riya, `/student/help/${id}/close`, {})).body.status).toBe("closed");
    expect((await t.post(riya, `/student/help/${id}/reply`, { body: "One more thing" })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await ask(riya, { category: "other", subject: `Question ${i + 1}` })).status).toBe(200);
    expect((await ask(riya, { category: "other", subject: "Question 6" })).status).toBe(400);
    const exported = (await t.get(riya, "/privacy/export")).body.helpdesk;
    expect(exported).toHaveLength(6);
    expect(exported.find((x: { subject: string }) => x.subject === "My CGPA is wrong").messages).toHaveLength(4);
  });
});
