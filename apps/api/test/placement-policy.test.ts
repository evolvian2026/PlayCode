import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, users } from "../src/db/schema";
import { settleOffers } from "../src/services/placements";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let aarav: string;
let riya: string;
let juspay: string;
const DAY = 86_400_000;
const idOf = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
type Drive = { id: string; company: string; tier: string | null; eligibility: { eligible: boolean; reasons: string[] }; application: { status: string; decision: string | null; decideBy: string | null } | null };
const drives = async (token: string) => (await t.get(token, "/student/placements")).body.drives as Drive[];
const drive = async (token: string, company: string) => (await drives(token)).find((d) => d.company === company)!;
const policy = { tiers: true, dreamFromRupees: 600_000, superDreamFromRupees: 1_000_000, maxOffers: 2, decisionDays: 3 };

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("placement policy", () => {
  it("keeps the drive's own rule until the placement cell turns tiers on", async () => {
    expect((await drive(aarav, "TCS")).application).toMatchObject({ status: "offered", decision: null });
    expect((await drive(aarav, "Accenture")).eligibility.reasons).toEqual(["You already hold an offer, and this drive is for students without one"]);
    expect((await t.get(tpo, "/console/placements/policy")).body).toMatchObject({ tiers: false, decisionDays: 3 });
    expect((await t.put(await t.login("faculty@demo.edu"), "/console/placements/policy", policy)).status).toBe(403);
    expect((await t.put(tpo, "/console/placements/policy", { ...policy, superDreamFromRupees: 500_000 })).status).toBe(400);
    expect((await t.put(tpo, "/console/placements/policy", policy)).status).toBe(200);
  });

  it("lets students with an offer sit only for higher tiers", async () => {
    const accenture = await drive(aarav, "Accenture");
    expect(accenture.tier).toBe("regular");
    expect(accenture.eligibility.reasons).toEqual(["You hold a Regular offer, so you can only sit for Dream and Super dream drives"]);
    expect((await drive(aarav, "Freshworks")).tier).toBe("super_dream");
    expect((await t.get(aarav, "/student/placements")).body.policy).toMatchObject({ maxOffers: 2, tiers: { dream: "Dream" } });
    const res = await t.post(tpo, "/console/placements", {
      company: "Juspay",
      companyType: "product",
      roleTitle: "Software engineer",
      ctcRupees: 900_000,
      driveDate: "2026-11-02",
      registerBy: new Date(START.getTime() + 5 * DAY).toISOString(),
      criteria: { unitIds: [], graduationYears: [2027] },
      rounds: ["Online test", "Interview"],
    });
    juspay = res.body.drive.id;
    expect((await t.get(tpo, "/console/placements")).body.drives.find((d: { id: string }) => d.id === juspay).tier).toBe("dream");
    expect((await drive(aarav, "Juspay")).eligibility.eligible).toBe(true);
    for (const token of [aarav, riya]) expect((await t.post(token, `/student/placements/${juspay}/register`, {})).status).toBe(200);
  });

  it("gives students a few days to accept or decline an offer", async () => {
    const ids = [await idOf("aarav.sharma1@demo.edu"), await idOf("student@demo.edu")];
    expect((await t.post(tpo, `/console/placements/${juspay}/applications`, { userIds: ids, action: "offer" })).status).toBe(200);
    const note = (await db.select().from(notifications).where(eq(notifications.userId, ids[1]!))).find((n) => n.title.includes("Juspay has made you an offer"));
    expect(note!.body).toContain("within 3 days");
    const mine = await drive(riya, "Juspay");
    expect(mine.application).toMatchObject({ status: "offered", decision: null, decideBy: new Date(START.getTime() + 3 * DAY).toISOString() });
    // Two offers is the most the policy allows.
    expect((await drive(aarav, "Freshworks")).eligibility.reasons).toEqual(["You already hold 2 offers, the most the placement policy allows"]);

    // Accepting one declines the other offers still waiting for an answer.
    expect((await t.post(aarav, `/student/placements/${juspay}/decision`, { accept: true })).status).toBe(200);
    expect((await drive(aarav, "TCS")).application!.decision).toBe("declined");
    expect((await drive(aarav, "Juspay")).application!.decision).toBe("accepted");
    expect((await t.post(aarav, `/student/placements/${juspay}/decision`, { accept: false })).status).toBe(409);
    const detail = (await t.get(tpo, `/console/placements/${juspay}`)).body;
    expect(detail.applicants.find((a: { userId: string }) => a.userId === ids[0]).decision).toBe("accepted");
  });

  it("reminds a day before the deadline, then takes the offer as accepted", async () => {
    const riyaId = await idOf("student@demo.edu");
    expect((await settleOffers(db, new Date(START.getTime() + 1 * DAY))).reminded).toBe(0);
    expect((await settleOffers(db, new Date(START.getTime() + 2.5 * DAY))).reminded).toBe(1);
    expect((await settleOffers(db, new Date(START.getTime() + 2.6 * DAY))).reminded).toBe(0);
    t.clock.now = new Date(START.getTime() + 3 * DAY + 60_000);
    expect((await t.post(riya, `/student/placements/${juspay}/decision`, { accept: false })).status).toBe(400);
    expect((await settleOffers(db, t.clock.now)).settled).toBe(1);
    expect((await drive(riya, "Juspay")).application!.decision).toBe("accepted");
    const inbox = (await db.select().from(notifications).where(eq(notifications.userId, riyaId))).map((n) => n.title);
    expect(inbox).toEqual(expect.arrayContaining(["Answer your Juspay offer by tomorrow", "Your Juspay offer is taken as accepted"]));
  });

  it("counts the accepted offer as where a graduate went", async () => {
    const report = (await t.get(tpo, "/console/outcomes/batch?year=2027")).body.report;
    const aaravId = await idOf("aarav.sharma1@demo.edu");
    expect(report.graduates.find((g: { id: string }) => g.id === aaravId)).toMatchObject({ status: "placed", where: "Juspay", ctcRupees: 900_000 });
    // The placement cell can reset a decision by resetting the application.
    await t.post(tpo, `/console/placements/${juspay}/applications`, { userIds: [aaravId], action: "reset" });
    expect((await drive(aarav, "Juspay")).application).toMatchObject({ status: "registered", decision: null });
  });
});
