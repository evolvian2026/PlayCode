import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { institutionMetrics, tenants } from "../src/db/schema";
import { snapshotBenchmarks } from "../src/services/benchmarks";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

/** Peer institutions with snapshots only (their students aren't needed to compare). */
async function addPeers(values: number[]) {
  for (const [i, v] of values.entries()) {
    const [peer] = await db.insert(tenants).values({ name: `Peer ${i}`, slug: `peer-${i}-${v}` }).returning();
    await db.insert(institutionMetrics).values({
      tenantId: peer!.id,
      day: "2026-10-22",
      students: 100,
      values: { serviceReadiness: v, productReadiness: v / 2, weeklyActivePct: v, answersPerActive: v / 5 },
      createdAt: START,
    });
  }
}

describe("peer benchmarks", () => {
  it("snapshots institutions with enough students and an active licence", async () => {
    const res = await snapshotBenchmarks(db, START);
    expect(res.measured).toBe(1); // the demo college; Sunrise has 4 students
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    const [row] = await db.select().from(institutionMetrics).where(eq(institutionMetrics.tenantId, demo!.id));
    expect(row!.students).toBe(31);
    expect(row!.values.weeklyActivePct).toBeGreaterThan(0);
    expect(row!.values.serviceReadiness).toBeGreaterThan(0);
    // Running again the same day replaces the snapshot.
    await snapshotBenchmarks(db, START);
    expect(await db.select().from(institutionMetrics).where(eq(institutionMetrics.tenantId, demo!.id))).toHaveLength(1);
  });

  it("shows nothing to compare until there are enough peers", async () => {
    await addPeers([10, 20, 30, 40]);
    const res = (await t.get(tpo, "/console/benchmarks")).body;
    expect(res).toMatchObject({ measured: true, students: 31, peerCount: 4, rows: null });
  });

  it("compares with peers without naming them", async () => {
    await addPeers([90]);
    const res = (await t.get(tpo, "/console/benchmarks")).body;
    expect(res.peerCount).toBe(5);
    expect(res.rows).toHaveLength(4);
    const active = res.rows.find((r: { metric: string }) => r.metric === "weeklyActivePct");
    expect(active).toMatchObject({ peerMedian: 30, peerTopQuartile: 40 });
    expect(active.percentile % 10).toBe(0);
    expect(JSON.stringify(res)).not.toContain("Peer ");
  });

  it("is for institution-wide staff only", async () => {
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/benchmarks")).status).toBe(403);
    // A college that hasn't been measured is told why.
    const sunrise = await t.login("admin@sunrise.edu");
    expect((await t.get(sunrise, "/console/benchmarks")).body).toEqual({ measured: false, minStudents: 20 });
  });
});
