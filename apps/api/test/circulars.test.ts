import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { circularReminders } from "../src/services/circulars";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let riya: string;
let kavya: string;
let unitA: string;
let id: string;
let sectionOnly: string;
const HOUR = 3_600_000;
const inbox = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await db.select().from(notifications).where(eq(notifications.userId, u!.id))).filter((n) => n.template === "circular");
};
const notice = { title: "TCS drive: what to bring", body: "Carry two printed copies of your resume, your college ID and a pen. Formal dress.", requireAck: true, ackBy: "2026-10-24" };

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  unitA = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("circulars", () => {
  it("are posted to chosen batches, and students are told", async () => {
    expect((await t.post(tpo, "/console/circulars", { ...notice, ackBy: null })).status).toBe(400);
    expect((await t.post(tpo, "/console/circulars", { ...notice, ackBy: "2026-10-01" })).status).toBe(400);
    expect((await t.post(faculty, "/console/circulars", { ...notice, unitIds: [] })).status).toBe(400); // faculty pick their sections
    const res = await t.post(tpo, "/console/circulars", notice);
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body.audience).toBeGreaterThan(20);
    sectionOnly = (await t.post(faculty, "/console/circulars", { title: "Extra quant class", body: "There's an extra quant class on Saturday at 10 in room 204.", unitIds: [unitA] })).body.id;
    expect((await inbox("student@demo.edu")).map((n) => n.title)).toEqual(expect.arrayContaining(["Circular: TCS drive: what to bring", "Circular: Extra quant class"]));
    expect((await inbox("student@demo.edu")).find((n) => n.title.includes("TCS"))!.body).toContain("acknowledge it by 2026-10-24");
    expect((await inbox("kavya.singh8@demo.edu")).map((n) => n.title)).toEqual(["Circular: TCS drive: what to bring"]);
  });

  it("lets students acknowledge the ones that ask for it", async () => {
    expect((await t.get(riya, "/student/circulars")).body).toMatchObject({ pending: 1, circulars: [expect.objectContaining({ title: "Extra quant class", requireAck: false }), expect.objectContaining({ id, acknowledgedAt: null })] });
    expect((await t.post(riya, `/student/circulars/${sectionOnly}/ack`, {})).status).toBe(400);
    expect((await t.post(kavya, `/student/circulars/${sectionOnly}/ack`, {})).status).toBe(404);
    expect((await t.post(riya, `/student/circulars/${id}/ack`, {})).body.pending).toBe(0);
    expect((await t.post(riya, `/student/circulars/${id}/ack`, {})).status).toBe(200);
  });

  it("shows staff who hasn't acknowledged, and lets them remind", async () => {
    const list = (await t.get(tpo, "/console/circulars")).body.circulars;
    expect(list.find((c: { id: string }) => c.id === id)).toMatchObject({ acknowledged: 1 });
    expect((await t.get(faculty, "/console/circulars")).body.circulars.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([id, sectionOnly]));
    const detail = (await t.get(tpo, `/console/circulars/${id}`)).body;
    expect(detail.students.at(-1)).toMatchObject({ name: "Riya Kapoor", acknowledgedAt: expect.any(String) });
    expect(detail.students[0].acknowledgedAt).toBeNull();
    const reminded = (await t.post(tpo, `/console/circulars/${id}/remind`, {})).body.reminded;
    expect(reminded).toBe(detail.audience - 1);
    expect((await t.post(tpo, `/console/circulars/${id}/remind`, {})).status).toBe(409);
    expect((await inbox("student@demo.edu")).filter((n) => n.title.startsWith("Reminder"))).toEqual([]);
    expect((await inbox("kavya.singh8@demo.edu")).filter((n) => n.title.startsWith("Reminder"))).toHaveLength(1);
  });

  it("reminds pending students the day before it's due, once", async () => {
    const pending = (await t.get(tpo, `/console/circulars/${id}`)).body.audience - 1;
    expect(await circularReminders(db, START)).toBe(0); // due in two days
    expect(await circularReminders(db, new Date(START.getTime() + 24 * HOUR))).toBe(pending);
    expect(await circularReminders(db, new Date(START.getTime() + 25 * HOUR))).toBe(0);
  });

  it("can be withdrawn by whoever posted it or the placement cell", async () => {
    expect((await t.post(faculty, `/console/circulars/${id}/withdraw`, {})).status).toBe(403);
    expect((await t.post(tpo, `/console/circulars/${sectionOnly}/withdraw`, {})).status).toBe(200);
    expect((await t.get(riya, "/student/circulars")).body.circulars.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await t.get(riya, "/privacy/export")).body.circularsAcknowledged).toEqual([expect.objectContaining({ title: "TCS drive: what to bring" })]);
  });
});
