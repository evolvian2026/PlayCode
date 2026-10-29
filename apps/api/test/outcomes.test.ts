import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { batchCsv } from "../src/services/graduate-outcomes";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let kavya: string;
let aarav: string;
const ids: Record<string, string> = {};
const idOf = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
type Grad = { id: string; status: string; ctcRupees: number | null; campus: boolean; where: string; exams: string[] };
const report = async () => (await t.get(tpo, "/console/outcomes/batch?year=2027")).body.report;
const grad = (r: { graduates: Grad[] }, id: string) => r.graduates.find((g) => g.id === id)!;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("graduate outcomes", () => {
  it("lets students report outcomes beyond campus drives", async () => {
    const job = { kind: "job", organisation: "Bosch", detail: "Graduate engineer trainee", ctcRupees: 650_000, outcomeDate: "2026-10-12" };
    expect((await t.post(kavya, "/student/outcomes", { ...job, ctcRupees: null })).status).toBe(400);
    expect((await t.post(kavya, "/student/outcomes", { ...job, outcomeDate: "2027-01-01" })).status).toBe(400);
    ids.kavyaJob = (await t.post(kavya, "/student/outcomes", job)).body.id;
    ids.riyaStudy = (await t.post(riya, "/student/outcomes", { kind: "higher_studies", organisation: "IIT Madras", detail: "M.Tech in CSE", ctcRupees: 900_000, outcomeDate: "2026-10-20" })).body.id;
    ids.riyaExam = (await t.post(riya, "/student/outcomes", { kind: "exam", organisation: "GATE", detail: "AIR 812", ctcRupees: null, outcomeDate: "2026-03-16" })).body.id;
    ids.aaravStudy = (await t.post(aarav, "/student/outcomes", { kind: "higher_studies", organisation: "Purdue University", detail: "MS", ctcRupees: null, outcomeDate: "2026-10-01" })).body.id;
    const mine = (await t.get(riya, "/student/outcomes")).body;
    expect(mine.outcomes).toEqual([expect.objectContaining({ organisation: "IIT Madras", status: "pending", ctcRupees: null }), expect.objectContaining({ organisation: "GATE", kindLabel: "Qualifying exam cleared" })]);
    expect((await t.get(aarav, "/student/outcomes")).body.campusOffers).toEqual([expect.objectContaining({ company: expect.any(String), ctcRupees: expect.any(Number) })]);
  });

  it("counts nothing until the placement cell verifies it", async () => {
    const r = await report();
    expect(r.pendingReports).toBe(4);
    expect(grad(r, await idOf("student@demo.edu")).status).toBe("not_known");
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/outcomes")).status).toBe(403);
    const queue = (await t.get(tpo, "/console/outcomes")).body;
    expect(queue.outcomes.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining(Object.values(ids)));
    expect(queue.outcomes[0].student).toMatchObject({ name: expect.any(String) });
  });

  it("verifies or sends back with a note, and tells the student", async () => {
    for (const id of [ids.riyaStudy, ids.riyaExam, ids.aaravStudy]) expect((await t.post(tpo, `/console/outcomes/${id}/review`, { verify: true })).status).toBe(200);
    expect((await t.post(tpo, `/console/outcomes/${ids.kavyaJob}/review`, { verify: false })).status).toBe(400);
    await t.post(tpo, `/console/outcomes/${ids.kavyaJob}/review`, { verify: false, note: "Please bring the offer letter to the placement cell." });
    const kavyaInbox = (await db.select().from(notifications).where(eq(notifications.userId, await idOf("kavya.singh8@demo.edu")))).filter((n) => n.title.startsWith("Bosch"));
    expect(kavyaInbox).toEqual([expect.objectContaining({ body: "Please bring the offer letter to the placement cell." })]);
    expect((await t.get(kavya, "/student/outcomes")).body.outcomes[0]).toMatchObject({ status: "rejected", reviewNote: expect.stringContaining("offer letter") });
    // Editing sends it back for review.
    await t.put(kavya, `/student/outcomes/${ids.kavyaJob}`, { kind: "job", organisation: "Bosch", detail: "Graduate engineer trainee", ctcRupees: 650_000, outcomeDate: "2026-10-12" });
    expect((await t.get(kavya, "/student/outcomes")).body.outcomes[0].status).toBe("pending");
    await t.post(tpo, `/console/outcomes/${ids.kavyaJob}/review`, { verify: true });
    // Verified reports belong to the institution's record now.
    expect((await t.delete(riya, `/student/outcomes/${ids.riyaExam}`)).status).toBe(409);
    const extra = (await t.post(riya, "/student/outcomes", { kind: "startup", organisation: "Chai Labs", detail: "", ctcRupees: null, outcomeDate: "2026-09-01" })).body.id;
    expect((await t.delete(riya, `/student/outcomes/${extra}`)).status).toBe(200);
  });

  it("gives the batch's outcomes, each graduate counted once", async () => {
    const r = await report();
    expect(r.pendingReports).toBe(0);
    const riyaId = await idOf("student@demo.edu");
    const kavyaId = await idOf("kavya.singh8@demo.edu");
    const aaravId = await idOf("aarav.sharma1@demo.edu");
    expect(grad(r, riyaId)).toMatchObject({ status: "higher_studies", where: "IIT Madras, M.Tech in CSE", exams: ["GATE"], ctcRupees: null });
    expect(grad(r, aaravId)).toMatchObject({ status: "placed", campus: true }); // a campus offer counts before an admission
    const k = grad(r, kavyaId);
    expect(k.status).toBe("placed");
    if (!k.campus) expect(k).toMatchObject({ where: "Bosch", ctcRupees: 650_000 });
    const t0 = r.totals;
    expect(t0.placed + t0.higherStudies + t0.startup + t0.notKnown).toBe(t0.graduating);
    expect(t0.placedOnCampus + t0.placedOffCampus).toBe(t0.placed);
    expect(t0.higherStudies).toBeGreaterThanOrEqual(1);
    expect(r.departments.reduce((n: number, d: { graduating: number }) => n + d.graduating, 0)).toBe(t0.graduating);
    expect(r.exams).toEqual([{ exam: "GATE", students: 1 }]);
    expect(t0.medianCtc).toBeGreaterThan(0);
  });

  it("exports the report as CSV, with formula-like cells neutralised", async () => {
    const res = await t.app.inject({ method: "GET", url: "/console/outcomes/batch/export?year=2027", headers: { authorization: `Bearer ${tpo}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain('"Department","Graduating","Placed"');
    expect(res.body).toContain("Riya Kapoor");
    const r = await report();
    const g = r.graduates.find((x: Grad) => x.status === "higher_studies");
    const csv = batchCsv({ ...r, graduates: [{ ...g, where: "=HYPERLINK(\"x\")" }] });
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect((await t.get(riya, "/privacy/export")).body.outcomes).toHaveLength(2);
  });
});
