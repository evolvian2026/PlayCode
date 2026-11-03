import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { joiningCheckIns } from "../src/services/joining";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let aarav: string;
let riyaId: string;

const opening = (body: object = {}) =>
  t.post(tpo, "/console/openings", {
    kind: "internship",
    company: "Microsoft Research India",
    roleTitle: "Research intern",
    payRupees: 60_000,
    location: "Bengaluru",
    details: "",
    applyUrl: "https://www.microsoft.com/en-us/research/academic-program/",
    closesOn: "2026-11-10",
    criteria: { unitIds: [], minCgpa: 8, graduationYears: [2027], allowPlaced: true },
    ...body,
  });
type Row = { id: string; company: string; state: string; response: string | null };
const mine = async (token: string): Promise<Row[]> => (await t.get(token, "/student/openings")).body.openings;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("openings outside campus drives", () => {
  it("shows students the openings they can apply for", async () => {
    const r = await mine(riya);
    expect(r.map((o) => [o.company, o.state])).toEqual([
      ["Cognizant", "closing"],
      ["Amazon", "open"],
      ["IISc Bangalore", "open"],
    ]);
    // The pool campus is for students without an offer.
    expect((await mine(aarav)).some((o) => o.company === "Cognizant")).toBe(false);
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/openings")).status).toBe(403);
  });

  it("checks the opening and tells the students it fits", async () => {
    expect((await opening({ closesOn: "2026-10-21" })).status).toBe(400);
    expect((await opening({ applyUrl: null })).status).toBe(400);
    expect((await opening({ applyUrl: "http://example.com" })).status).toBe(400);
    const res = await opening();
    expect(res.status).toBe(200);
    expect(res.body.opening).toMatchObject({ company: "Microsoft Research India", kindLabel: "Internship", pay: "₹60,000 a month", state: "open", applied: 0 });
    expect(res.body.notified).toBeGreaterThan(0);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Internship: Microsoft%")));
    expect(note!.body).toContain("Apply by 10 Nov");
    expect(note!.link).toContain(`/play/openings?id=${res.body.opening.id}`);
  });

  it("records who applied, for the placement cell", async () => {
    const id = (await mine(riya)).find((o) => o.company === "Microsoft Research India")!.id;
    const after = await t.put(riya, `/student/openings/${id}`, { response: "applied" });
    expect(after.body.openings.find((o: Row) => o.id === id).response).toBe("applied");
    const view = (await t.get(tpo, `/console/openings/${id}`)).body;
    expect(view.responses).toEqual([expect.objectContaining({ name: "Riya Kapoor", response: "applied" })]);
    expect(view.notAnswered).toBe(view.eligible - 1);
    expect((await t.get(tpo, "/console/openings")).body.openings.find((o: { id: string }) => o.id === id).applied).toBe(1);
    // Changing their mind clears it.
    await t.put(riya, `/student/openings/${id}`, { response: null });
    expect((await t.get(tpo, `/console/openings/${id}`)).body.responses).toEqual([]);
  });

  it("keeps students out of openings they don't fit, and takes withdrawn ones down", async () => {
    const res = await opening({ company: "Goldman Sachs", criteria: { unitIds: [], graduationYears: [2028] } });
    expect(res.body.notified).toBe(0);
    expect((await mine(riya)).some((o) => o.company === "Goldman Sachs")).toBe(false);
    expect((await t.put(riya, `/student/openings/${res.body.opening.id}`, { response: "applied" })).status).toBe(400);

    const amazon = (await mine(riya)).find((o) => o.company === "Amazon")!.id;
    await t.post(tpo, `/console/openings/${amazon}/withdraw`);
    expect((await mine(riya)).some((o) => o.company === "Amazon")).toBe(false);
    expect((await t.put(riya, `/student/openings/${amazon}`, { response: "applied" })).status).toBe(404);
    expect((await t.get(tpo, "/console/openings")).body.openings.find((o: { id: string }) => o.id === amazon).state).toBe("withdrawn");
  });
});

describe("joining", () => {
  type Offer = { driveId: string; userId: string; company: string; status: string | null; delayed: boolean; name: string };
  const board = async () => (await t.get(tpo, "/console/joining")).body as { offers: Offer[]; companies: { company: string; delayed: number; accepted: number }[]; totals: { accepted: number; delayed: number; revoked: number } };

  it("shows every accepted offer, delayed ones first", async () => {
    const b = await board();
    expect(b.totals.accepted).toBeGreaterThan(10);
    expect(b.offers[0]).toMatchObject({ company: "Infosys", status: "date_given", delayed: true });
    expect(b.companies[0]).toMatchObject({ company: "Infosys", delayed: 1 });
    // Aarav hasn't answered his TCS offer yet, so there's nothing to track.
    const tcs = (await t.get(aarav, "/student/placements")).body.drives.find((d: { company: string }) => d.company === "TCS");
    expect((await t.put(aarav, `/student/placements/${tcs.id}/joining`, { status: "letter_received" })).status).toBe(404);
  });

  it("lets the student say where their offer stands", async () => {
    const o = (await board()).offers.find((x) => x.company === "TCS" && x.status === null)!;
    const [u] = await db.select().from(users).where(eq(users.id, o.userId));
    const student = await t.login(u!.email!);
    const put = (body: object) => t.put(student, `/student/placements/${o.driveId}/joining`, body);
    expect((await put({ status: "date_given" })).status).toBe(400);
    expect((await put({ status: "revoked", note: "They called" })).status).toBe(400);
    expect((await put({ status: "joined", joiningDate: "2026-12-01" })).status).toBe(400);
    expect((await put({ status: "date_given", joiningDate: "2027-07-15" })).status).toBe(200);
    const card = (await t.get(student, "/student/placements")).body.drives.find((d: { id: string }) => d.id === o.driveId);
    expect(card.application.joining).toEqual({ status: "date_given", joiningDate: "2027-07-15", note: "" });
    expect((await board()).offers.find((x) => x.userId === o.userId && x.driveId === o.driveId)).toMatchObject({ status: "date_given", delayed: false });
  });

  it("records a withdrawn offer, which stops counting so the student is back in the season", async () => {
    const before = await board();
    const o = before.offers.find((x) => x.company === "TCS" && x.status === "letter_received")!;
    const [u] = await db.select().from(users).where(eq(users.id, o.userId));
    const student = await t.login(u!.email!);
    const accenture = async () => (await t.get(student, "/student/placements")).body.drives.find((d: { company: string }) => d.company === "Accenture");
    expect((await accenture()).eligibility.reasons).toContain("You already hold an offer, and this drive is for students without one");
    const placedBefore = (await t.get(tpo, "/console/outcomes/batch?year=2027")).body.report.totals.placed;

    const url = `/console/joining/${o.driveId}/${o.userId}`;
    expect((await t.put(tpo, url, { status: "revoked" })).status).toBe(400);
    const res = await t.put(tpo, url, { status: "revoked", note: "Hiring freeze for the 2027 batch" });
    expect(res.status).toBe(200);
    expect(res.body.totals.revoked).toBe(1);
    expect((await accenture()).eligibility.reasons).not.toContain("You already hold an offer, and this drive is for students without one");
    expect((await t.get(tpo, "/console/outcomes/batch?year=2027")).body.report.totals.placed).toBe(placedBefore - 1);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, o.userId), like(notifications.title, "%recorded as withdrawn")));
    expect(note).toBeDefined();
    expect((await t.put(student, `/student/placements/${o.driveId}/joining`, { status: "joined", joiningDate: "2026-10-01" })).status).toBe(400);
  });

  it("checks in once a month with students who haven't joined yet", async () => {
    const first = await joiningCheckIns(db, START);
    expect(first).toBeGreaterThan(0);
    expect(await joiningCheckIns(db, START)).toBe(0);
    const notes = await db.select().from(notifications).where(like(notifications.title, "Any news from%"));
    expect(new Set(notes.map((n) => n.title))).toEqual(new Set(["Any news from TCS?"]));
  });
});

describe("public placement record", () => {
  it("is published only when the institution chooses to", async () => {
    expect((await t.get("", "/public/placements/demo-tech")).status).toBe(404);
    expect((await t.put(await t.login("faculty@demo.edu"), "/console/placements/public-record", { enabled: true })).status).toBe(403);
    expect((await t.put(tpo, "/console/placements/public-record", { enabled: true })).body).toEqual({ enabled: true, slug: "demo-tech" });
  });

  it("shows totals only, leaving out groups too small to hide anyone", async () => {
    const res = await t.get("", "/public/placements/demo-tech");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ institution: "Demo Institute of Technology", minGroup: 10 });
    const [batch] = res.body.batches;
    expect(batch).toMatchObject({ year: 2027, inProgress: true, graduating: 31, departmentsHidden: 1 });
    expect(batch.placedPct).toBe(Math.round((batch.placed / 31) * 100));
    expect(batch.departments.map((d: { department: string }) => d.department)).toEqual(["Computer Science"]);
    expect(batch.recruiters).toEqual(expect.arrayContaining(["TCS", "Infosys", "Zoho"]));
    expect(JSON.stringify(res.body)).not.toContain("Riya");
    await t.put(tpo, "/console/placements/public-record", { enabled: false });
    expect((await t.get("", "/public/placements/demo-tech")).status).toBe(404);
  });
});
