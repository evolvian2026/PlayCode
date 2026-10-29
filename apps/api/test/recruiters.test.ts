import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { auditLogs, orgUnits, tenants, users } from "../src/db/schema";
import { brochureData } from "../src/services/brochure";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let wipro: string;

const company = (body: object) => t.post(tpo, "/console/recruiters", { name: "HCLTech", sector: "IT services", website: null, stage: "prospect", notes: "", ownerId: null, ...body });

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("company relations", () => {
  it("lists companies with their drives and the follow-ups due", async () => {
    const res = await t.get(tpo, "/console/recruiters");
    expect(res.status).toBe(200);
    expect(res.body.recruiters.map((r: { name: string }) => r.name)).toEqual(["Accenture", "Deloitte", "Freshworks", "Infosys", "Juspay", "TCS", "Wipro", "Zoho"]);
    const tcs = res.body.recruiters.find((r: { name: string }) => r.name === "TCS");
    expect(tcs).toMatchObject({ stage: "visited", owner: "Rajesh Sharma (TPO)", drives: { drives: 1, offers: 9, lastDrive: "2026-08-27", highestCtc: 336_000 } });
    // Overdue first, then due today; upcoming ones aren't "due".
    expect(res.body.due.map((r: { name: string; followUp: { state: string } }) => [r.name, r.followUp.state])).toEqual([
      ["Juspay", "overdue"],
      ["Wipro", "today"],
    ]);
    expect(res.body.notListed).toBe(0);
    wipro = res.body.recruiters.find((r: { name: string }) => r.name === "Wipro").id;
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/recruiters")).status).toBe(403);
    expect((await t.get(await t.login("student@demo.edu"), "/console/recruiters")).status).toBe(403);
  });

  it("adds companies once, by name, and brings in the ones that held drives", async () => {
    expect((await company({ name: "tcs " })).status).toBe(409);
    expect((await company({ website: "hcltech.com" })).status).toBe(400);
    const res = await company({ website: "https://www.hcltech.com" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "HCLTech", stage: "prospect", contacts: [], interactions: [], drives: [] });
    const [entry] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "recruiters.create"), eq(auditLogs.target, res.body.id)));
    expect(entry).toBeDefined();

    const infosys = (await t.get(tpo, "/console/recruiters")).body.recruiters.find((r: { name: string }) => r.name === "Infosys");
    expect((await t.delete(tpo, `/console/recruiters/${infosys.id}`)).status).toBe(200);
    expect((await t.get(tpo, "/console/recruiters")).body.notListed).toBe(1);
    expect((await t.post(tpo, "/console/recruiters/import")).body).toEqual({ added: 1 });
    const back = (await t.get(tpo, "/console/recruiters")).body.recruiters.find((r: { name: string }) => r.name === "Infosys");
    expect(back).toMatchObject({ stage: "visited", drives: { drives: 1, offers: 10 } });
    const detail = (await t.get(tpo, `/console/recruiters/${back.id}`)).body;
    expect(detail.drives).toEqual([expect.objectContaining({ roleTitle: "Systems Engineer", offers: 10, status: "completed" })]);
  });

  it("keeps the company's people", async () => {
    expect((await t.post(tpo, `/console/recruiters/${wipro}/contacts`, { name: "Anita Rao", designation: "HR", email: null, phone: null })).status).toBe(400);
    expect((await t.post(tpo, `/console/recruiters/${wipro}/contacts`, { name: "Anita Rao", email: "not-an-email" })).status).toBe(400);
    const res = await t.post(tpo, `/console/recruiters/${wipro}/contacts`, { name: "Anita Rao", designation: "HR", email: "anita.rao@wipro.example" });
    expect(res.body.contacts.map((c: { name: string }) => c.name)).toEqual(["Sanjay Gupta", "Anita Rao"]);
    const anita = res.body.contacts[1].id;
    expect((await t.delete(tpo, `/console/recruiters/${wipro}/contacts/${anita}`)).body.contacts).toHaveLength(1);
  });

  it("logs a call, closes the follow-up it answers and sets the next one, which shows on the calendar", async () => {
    const log = (body: object) => t.post(tpo, `/console/recruiters/${wipro}/interactions`, { kind: "meeting", on: "2026-10-22", note: "Met their campus team; drive on 4 December.", followUpOn: "2026-10-29", stage: "confirmed", ...body });
    expect((await log({ on: "2026-10-23" })).status).toBe(400);
    expect((await log({ followUpOn: "2026-10-21" })).status).toBe(400);
    const res = await log({});
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("confirmed");
    expect(res.body.interactions.map((i: { kind: string; followUpDone: boolean; state: string | null; by: string }) => [i.kind, i.followUpDone, i.state, i.by])).toEqual([
      ["meeting", false, "upcoming", "Rajesh Sharma (TPO)"],
      ["call", true, null, "Rajesh Sharma (TPO)"],
    ]);
    expect((await t.get(tpo, "/console/recruiters")).body.due.map((r: { name: string }) => r.name)).toEqual(["Juspay"]);

    const events = (await t.get(tpo, "/console/calendar")).body.events;
    expect(events.find((e: { kind: string; title: string }) => e.kind === "follow_up" && e.title === "Follow up: Wipro")).toMatchObject({ start: "2026-10-29", allDay: true });

    const next = res.body.interactions[0].id;
    const done = await t.post(tpo, `/console/recruiters/${wipro}/interactions/${next}/done`);
    expect(done.body.interactions[0]).toMatchObject({ followUpDone: true, state: null });
    expect((await t.get(tpo, "/console/calendar")).body.events.some((e: { title: string }) => e.title === "Follow up: Wipro")).toBe(false);
  });
});

describe("placement brochure", () => {
  it("keeps what the brochure says about the institution", async () => {
    const res = await t.get(tpo, "/console/placements/brochure/settings");
    expect(res.body.settings).toMatchObject({ contactName: "Rajesh Sharma", contactEmail: "placements@demo.edu" });
    expect(res.body.years).toEqual([2027]);
    expect((await t.put(tpo, "/console/placements/brochure/settings", { ...res.body.settings, contactEmail: "nope" })).status).toBe(400);
    const saved = await t.put(tpo, "/console/placements/brochure/settings", { ...res.body.settings, contactPhone: " +91 80 4000 9999 " });
    expect(saved.body.contactPhone).toBe("+91 80 4000 9999");
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/placements/brochure/settings")).status).toBe(403);
  });

  it("builds the brochure from the batch, past offers and training", async () => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    const [me] = await db.select().from(users).where(eq(users.email, "tpo@demo.edu"));
    const d = await brochureData(db, { tenantId: tenant!.id, userId: me!.id, roles: ["tpo"] }, 2027, t.clock.now);
    expect(d.batch.students).toBeGreaterThan(20);
    expect(d.batch.departments.map((x) => x.department)).toEqual(["Computer Science", "Electronics"]);
    // No 2026 batch on record, so there's no "last season" section.
    expect(d.lastSeason).toBeNull();
    expect(d.thisSeason?.placed).toBeGreaterThan(0);
    expect(d.recruiters).toEqual(["Infosys", "TCS", "Zoho"]);

    const res = await t.app.inject({ method: "GET", url: "/console/placements/brochure?year=2027", headers: { authorization: `Bearer ${tpo}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("placement-brochure-2027.pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("season targets", () => {
  it("shows each department against its target", async () => {
    const targets = (await t.get(tpo, "/console/placements/targets")).body;
    expect(targets).toMatchObject({ year: 2027, institution: 80 });
    expect(targets.departments.map((d: { name: string; targetPct: number }) => [d.name, d.targetPct])).toEqual([
      ["Computer Science", 85],
      ["Electronics", 70],
    ]);
    const { season } = (await t.get(tpo, "/console/placements/season?year=2027")).body;
    expect(season.totals.target).toBe(80);
    const { graduating, placed } = season.totals;
    expect(season.totals.progress).toEqual({ placedPct: Math.round((placed / graduating) * 1000) / 10, needed: Math.max(0, Math.ceil(0.8 * graduating) - placed), met: false });
    const cse = season.departments.find((d: { department: string }) => d.department === "Computer Science");
    expect(cse.target).toBe(85);
    expect(cse.progress.needed).toBe(Math.max(0, Math.ceil(0.85 * cse.graduating) - cse.placed));
    // Offers by drive month, with a running total.
    expect(season.byMonth.map((m: { month: string }) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(season.byMonth.at(-1).total).toBe(season.byMonth.reduce((n: number, m: { offers: number }) => n + m.offers, 0));
    // Each placed graduate counts once, at the offer they took (else the best one).
    expect(season.topRecruiters.map((r: { company: string }) => r.company).sort()).toEqual(["Infosys", "TCS", "Zoho"]);
    expect(season.topRecruiters.reduce((n: number, r: { hired: number }) => n + r.hired, 0)).toBe(placed);
    expect(season.topRecruiters[0]).toMatchObject({ company: "TCS", hired: 9, medianCtc: 336_000 });
    expect(season.openDrives).toBe(2);
  });

  it("lets the placement cell change targets, and heads of department see their own", async () => {
    const [ece] = await db.select().from(orgUnits).where(eq(orgUnits.name, "Electronics"));
    const [section] = await db.select().from(orgUnits).where(eq(orgUnits.name, "ECE 2027 - A"));
    expect((await t.put(tpo, "/console/placements/targets", { year: 2027, institution: 75, departments: [{ unitId: section!.id, targetPct: 50 }] })).status).toBe(400);
    expect((await t.put(tpo, "/console/placements/targets", { year: 2027, institution: 120, departments: [] })).status).toBe(400);
    const res = await t.put(tpo, "/console/placements/targets", { year: 2027, institution: 75, departments: [{ unitId: ece!.id, targetPct: 60 }] });
    expect(res.status).toBe(200);
    expect(res.body.departments.map((d: { targetPct: number | null }) => d.targetPct)).toEqual([null, 60]);
    expect((await t.get(tpo, "/console/placements/season")).body.season.totals.target).toBe(75);

    const hod = await t.login("hod.cse@demo.edu");
    const mine = (await t.get(hod, "/console/placements/season")).body.season;
    expect(mine.departments.map((d: { department: string }) => d.department)).toEqual(["Computer Science"]);
    expect((await t.put(hod, "/console/placements/targets", { year: 2027, institution: 90, departments: [] })).status).toBe(403);
  });
});
