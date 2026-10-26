import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { aiUsage, tenants } from "../src/db/schema";
import { setAiProvider, type AiProvider, type InsightFacts } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
const seen: InsightFacts[] = [];
const notUsed = async () => {
  throw new Error("not used");
};
const fakeAi: AiProvider = {
  coachHint: notUsed,
  draftQuestions: notUsed,
  draftCodingProblems: notUsed,
  draftSqlProblems: notUsed,
  reviewSnapshot: notUsed,
  interviewTurn: notUsed,
  interviewScorecard: notUsed,
  async weeklyInsights(facts) {
    seen.push(facts);
    return {
      value: {
        headline: `${facts.activeThisWeekPct}% of students practised this week.`,
        points: [
          { text: `Weakest skill: ${facts.weakestSkills[0]?.name}.`, tone: "act" },
          { text: "Streaks are holding.", tone: "good" },
        ],
        actions: ["Set an assignment on the weakest skill.", "Remind inactive students.", "Run a mock test.", "A fourth action that is dropped."],
      },
      usage: { inputTokens: 900, outputTokens: 150, cacheReadTokens: 0 },
    };
  },
};

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  setAiProvider(fakeAi);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("weekly insights", () => {
  it("writes a briefing from aggregates only, once a day per scope", async () => {
    expect((await t.get(tpo, "/console/insights")).body).toMatchObject({ available: true, report: null, scope: "the whole institution" });
    const res = (await t.post(tpo, "/console/insights", {})).body;
    expect(res.report.headline).toMatch(/% of students practised this week\.$/);
    expect(res.report.actions).toHaveLength(3);
    expect(seen).toHaveLength(1);
    const facts = seen[0]!;
    expect(facts).toMatchObject({ scope: "the whole institution", students: 31 });
    expect(facts.weakestSkills.length).toBeLessThanOrEqual(5);
    expect(facts.readiness).toHaveLength(2);
    expect(facts.assignments.length).toBeGreaterThan(0);
    // No student is named or identified.
    const json = JSON.stringify(facts);
    expect(json).not.toContain("Riya");
    expect(json).not.toContain("@demo.edu");
    expect(json).not.toContain("CSE27A");
    // Asking again the same day returns the cached briefing.
    expect((await t.post(tpo, "/console/insights", {})).body.report).toEqual(res.report);
    expect(seen).toHaveLength(1);
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    expect((await db.select().from(aiUsage).where(eq(aiUsage.tenantId, demo!.id))).filter((u) => u.feature === "weekly_insights")).toHaveLength(1);
  });

  it("scopes to a unit, or to a teacher's own sections", async () => {
    const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
    const cseA = units.find((u) => u.name === "CSE 2027 - A")!;
    const res = (await t.post(tpo, "/console/insights", { unitId: cseA.id })).body;
    expect(res.scope).toBe("CSE 2027 - A");
    expect(seen.at(-1)!.students).toBeLessThan(31);
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, "/console/insights")).body.scope).toBe("your batches and sections");
    await t.post(faculty, "/console/insights", {});
    expect(seen.at(-1)!.scope).toBe("your batches and sections");
    expect((await t.get(await t.login("student@demo.edu"), "/console/insights")).status).toBe(403);
  });

  it("follows the plan and whether AI is on", async () => {
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ plan: "starter" }).where(eq(tenants.id, demo!.id));
    const off = (await t.get(tpo, "/console/insights")).body;
    expect(off.available).toBe(false);
    expect(off.reason).toContain("Weekly AI insights");
    await db.update(tenants).set({ plan: "pro" }).where(eq(tenants.id, demo!.id));
    setAiProvider(null);
    expect((await t.get(tpo, "/console/insights")).body.available).toBe(false);
    setAiProvider(fakeAi);
  });
});
