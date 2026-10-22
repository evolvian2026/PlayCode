import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkEligibility, engagementBand } from "@playcode/core";
import { db, pool } from "../src/db/client";
import { notifications, tenants, users } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let units: Record<string, string>;
let driveId: string;

const DAY = 86_400_000;
const userId = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!.id;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  units = Object.fromEntries((await t.get(tpo, "/console/org-units")).body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("eligibility rules", () => {
  it("explains every rule a student misses", () => {
    const r = checkEligibility(
      { unitIds: [], minCgpa: 7, maxBacklogs: 0, min10th: 60, graduationYears: [2027] },
      { cgpa: 6.4, backlogs: 2, tenthPct: null, twelfthPct: 80, graduationYear: 2026 },
      { inUnits: true, placed: true },
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual([
      "Open to the 2027 batch only",
      "Needs a CGPA of 7 or more (yours is 6.4)",
      "Needs no active backlogs",
      "Your class 10 marks are not on record",
      "You already hold an offer, and this drive is for students without one",
    ]);
    expect(engagementBand(20)).toBe("regular");
    expect(engagementBand(4)).toBe("rare");
  });
});

describe("placement drives", () => {
  it("is for the placement cell, on plans that include it", async () => {
    expect((await t.get(tpo, "/console/placements")).body.drives.map((d: { company: string }) => d.company)).toEqual(expect.arrayContaining(["TCS", "Infosys", "Zoho", "Accenture", "Freshworks"]));
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/placements")).status).toBe(403);
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ plan: "starter" }).where(eq(tenants.id, demo!.id));
    expect((await t.get(tpo, "/console/placements")).status).toBe(402);
    await db.update(tenants).set({ plan: "enterprise" }).where(eq(tenants.id, demo!.id));
  });

  it("imports academic records by roll number or email", async () => {
    const bad = await t.post(tpo, "/console/placements/records", { csv: "roll_no,cgpa,backlogs,tenth,twelfth,year\nCSE27A001,11,0,90,90,2027" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].message).toContain("CGPA");
    const ok = await t.post(tpo, "/console/placements/records", { csv: "roll_no,cgpa,backlogs,tenth,twelfth,year\nCSE27A001,8.4,0,91,88,2027\nnobody@demo.edu,7,0,,,2027" });
    expect(ok.body).toEqual({ updated: 1, notFound: ["nobody@demo.edu"] });
  });

  it("opens a drive and tells the eligible students", async () => {
    const body = {
      company: "Wipro",
      companyType: "service",
      roleTitle: "Project Engineer",
      ctcRupees: 350_000,
      driveDate: "2026-11-12",
      registerBy: new Date(START.getTime() + 3 * DAY).toISOString(),
      criteria: { unitIds: [units["Computer Science"]], minCgpa: 8, maxBacklogs: 0 },
      rounds: ["Online test", "Interview"],
    };
    expect((await t.post(tpo, "/console/placements", { ...body, registerBy: new Date(START.getTime() - DAY).toISOString() })).status).toBe(400);
    expect((await t.post(tpo, "/console/placements", { ...body, rounds: [] })).status).toBe(400);
    const res = await t.post(tpo, "/console/placements", body);
    expect(res.status).toBe(200);
    driveId = res.body.drive.id;
    expect(res.body.notified).toBeGreaterThan(0);
    const detail = (await t.get(tpo, `/console/placements/${driveId}`)).body;
    expect(detail.summary).toMatchObject({ eligible: res.body.notified, registered: 0, offers: 0 });
    const [note] = await db.select().from(notifications).where(eq(notifications.dedupeKey, `placement-open:${driveId}:${await userId("student@demo.edu")}`));
    expect(note).toMatchObject({ title: "Wipro is hiring: Project Engineer", link: "/play/placements" });
  });

  it("lets eligible students register, and tells the others why not", async () => {
    const mine = (await t.get(riya, "/student/placements")).body;
    expect(mine.record).toMatchObject({ cgpa: 8.4, graduationYear: 2027 });
    const wipro = mine.drives.find((d: { id: string }) => d.id === driveId);
    expect(wipro).toMatchObject({ open: true, eligibility: { eligible: true, reasons: [] }, application: null, readinessProfile: "service" });

    // An Electronics student is outside the invited branch.
    const ece = await db.select().from(users).where(eq(users.rollNo, "ECE27A005"));
    const eceToken = await t.login(ece[0]!.email);
    const theirs = (await t.get(eceToken, "/student/placements")).body.drives.find((d: { id: string }) => d.id === driveId);
    expect(theirs.eligibility.reasons).toContain("Your branch or batch is not invited");
    const refused = await t.post(eceToken, `/student/placements/${driveId}/register`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain("not eligible");

    const reg = await t.post(riya, `/student/placements/${driveId}/register`);
    expect(reg.body.drives.find((d: { id: string }) => d.id === driveId).application).toMatchObject({ status: "registered", roundsCleared: 0 });
    expect((await t.post(riya, `/student/placements/${driveId}/register`)).status).toBe(409);
    // Withdraw and register again before the deadline.
    expect((await t.post(riya, `/student/placements/${driveId}/withdraw`)).status).toBe(200);
    expect((await t.post(riya, `/student/placements/${driveId}/register`)).status).toBe(200);
    const detail = (await t.get(tpo, `/console/placements/${driveId}`)).body;
    expect(detail.applicants).toHaveLength(1);
    expect(detail.applicants[0]).toMatchObject({ name: "Riya Kapoor", status: "registered", record: { cgpa: 8.4 } });
    expect(detail.applicants[0].activeDays60).toBeGreaterThan(0);
  });

  it("moves applicants through the rounds to an offer", async () => {
    const riyaId = await userId("student@demo.edu");
    t.clock.now = new Date(START.getTime() + 4 * DAY); // registration closed
    expect((await t.post(riya, `/student/placements/${driveId}/withdraw`)).status).toBe(400);

    await t.post(tpo, `/console/placements/${driveId}/applications`, { userIds: [riyaId], action: "advance" });
    let app = (await t.get(tpo, `/console/placements/${driveId}`)).body.applicants[0];
    expect(app).toMatchObject({ status: "shortlisted", roundsCleared: 1 });
    const cleared = await db.select().from(notifications).where(eq(notifications.dedupeKey, `placement-round:${driveId}:${riyaId}:1`));
    expect(cleared[0]!.body).toBe("Next round: Interview. Practise to be ready.");

    await t.post(tpo, `/console/placements/${driveId}/applications`, { userIds: [riyaId], action: "offer", ctcRupees: 380_000 });
    app = (await t.get(tpo, `/console/placements/${driveId}`)).body.applicants[0];
    expect(app).toMatchObject({ status: "offered", roundsCleared: 2, offerCtcRupees: 380_000 });
    expect((await t.post(tpo, `/console/placements/${driveId}/applications`, { userIds: [riyaId], action: "advance" })).status).toBe(400);

    // Holding an offer now, she can still try the dream-company drive but not the mass recruiter.
    const drives = (await t.get(riya, "/student/placements")).body.drives;
    expect(drives.find((d: { company: string }) => d.company === "Freshworks").eligibility.eligible).toBe(true);
    expect(drives.find((d: { company: string }) => d.company === "Accenture").eligibility.reasons).toEqual(["You already hold an offer, and this drive is for students without one"]);
    expect(drives.find((d: { id: string }) => d.id === driveId).application).toMatchObject({ status: "offered", offerCtcRupees: 380_000 });

    const csv = await t.app.inject({ method: "GET", url: `/console/placements/${driveId}/export`, headers: { authorization: `Bearer ${tpo}` } });
    expect(csv.body.split("\n")[1]).toContain('"Riya Kapoor","CSE27A001"');
    expect(csv.body.split("\n")[1]).toContain('"offered","2","380000"');
  });

  it("reports placements against practice and readiness", async () => {
    const o = (await t.get(tpo, "/console/placements/outcomes")).body;
    expect(o.placed).toBeGreaterThan(0);
    expect(o.placedPct).toBe(Math.round((o.placed / o.registered) * 100));
    expect(o.byEngagement.map((b: { id: string }) => b.id)).toEqual(["regular", "occasional", "rare"]);
    expect(o.byEngagement.reduce((a: number, b: { students: number }) => a + b.students, 0)).toBe(o.registered);
    expect(o.headline.regularPct).toBeGreaterThan(o.headline.othersPct);
    expect(o.companies.find((c: { company: string }) => c.company === "Wipro")).toMatchObject({ registered: 1, offers: 1 });
    const cse = (await t.get(tpo, `/console/placements/outcomes?unitId=${units["Electronics"]}`)).body;
    expect(cse.departments.map((d: { name: string }) => d.name)).toEqual(["Electronics"]);
    const hod = await t.login("hod.cse@demo.edu");
    expect((await t.get(hod, "/console/placements/outcomes")).status).toBe(403);
  });
});
