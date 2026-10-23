import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { assessments, attemptSnapshots, authSessions, jobRuns, loginCodes, notifications, tenants, users } from "../src/db/schema";
import { getObject, putObject } from "../src/lib/storage";
import { jobStatus, recordJob } from "../src/services/jobs";
import { runRetention } from "../src/services/retention";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
const DAY = 86_400_000;

beforeAll(async () => {
  t = await setup();
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("data retention", () => {
  let snapshotKey: string;
  let assessmentId: string;

  beforeAll(async () => {
    const student = await t.login("student@demo.edu");
    [{ id: assessmentId }] = (await db.select({ id: assessments.id }).from(assessments).where(eq(assessments.title, "Mock placement drive 1"))) as [{ id: string }];
    const attempt = (await t.post(student, `/student/assessments/${assessmentId}/start`, { deviceId: "device-retention" })).body.id;
    snapshotKey = `snapshots/test-${attempt}.jpg`;
    await putObject(snapshotKey, Buffer.from("fake jpeg"));
    await db.insert(attemptSnapshots).values({ attemptId: attempt, storageKey: snapshotKey, contentType: "image/jpeg", at: START });
  });

  it("keeps webcam snapshots until the retention period after the test closes", async () => {
    // Closed 60 days ago: within the default 90 days.
    await db.update(assessments).set({ closeAt: new Date(START.getTime() - 60 * DAY) }).where(eq(assessments.id, assessmentId));
    expect((await runRetention(db, START)).snapshots).toBe(0);
    // An institution can choose a shorter period.
    const admin = await t.login("admin@demo.edu");
    expect((await t.put(admin, "/console/retention", { snapshotRetentionDays: 3 })).status).toBe(400); // below the 7-day minimum
    expect((await t.put(admin, "/console/retention", { snapshotRetentionDays: 30 })).body.snapshotRetentionDays).toBe(30);
    const res = await runRetention(db, START);
    expect(res.snapshots).toBe(1);
    expect(await db.select().from(attemptSnapshots).where(eq(attemptSnapshots.storageKey, snapshotKey))).toHaveLength(0);
    expect(await getObject(snapshotKey)).toBeNull(); // the photo itself is gone too
  });

  it("clears sign-in leftovers and old notifications, keeping recent ones", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.insert(loginCodes).values([
      { userId: u!.id, codeHash: "x", channel: "email", expiresAt: new Date(START.getTime() - 2 * DAY) },
      { userId: u!.id, codeHash: "y", channel: "email", expiresAt: new Date(START.getTime() + 600_000) },
    ]);
    await db.insert(authSessions).values([
      { userId: u!.id, method: "password", createdAt: new Date(START.getTime() - 60 * DAY), lastSeenAt: new Date(START.getTime() - 45 * DAY) },
      { userId: u!.id, method: "password", createdAt: new Date(START.getTime() - 60 * DAY), lastSeenAt: new Date(START.getTime() - 50 * DAY), revokedAt: new Date(START.getTime() - 40 * DAY) },
    ]);
    await db.insert(notifications).values({ tenantId: demo!.id, userId: u!.id, template: "announcement", title: "Old", body: "x", dedupeKey: "old-one", createdAt: new Date(START.getTime() - 400 * DAY) });
    const before = (await db.select().from(authSessions).where(eq(authSessions.userId, u!.id))).length;
    const res = await runRetention(db, START);
    expect(res).toMatchObject({ loginCodes: 1, sessions: 2, notifications: 1 });
    expect((await db.select().from(authSessions).where(eq(authSessions.userId, u!.id))).length).toBe(before - 2);
    expect((await db.select().from(loginCodes).where(eq(loginCodes.userId, u!.id))).length).toBe(1);
    // The session signed in for this test still works.
    expect((await t.get(await t.login("student@demo.edu"), "/me")).status).toBe(200);
  });

  it("records each job run, and flags jobs that failed or stopped running", async () => {
    await recordJob(db, "retention", START, () => runRetention(db, START));
    await expect(recordJob(db, "webhooks", START, async () => { throw new Error("connection refused"); })).rejects.toThrow("connection refused");
    const status = await jobStatus(db, new Date(START.getTime() + 60_000));
    const byJob = Object.fromEntries(status.map((s) => [s.job, s]));
    expect(byJob.retention).toMatchObject({ healthy: true, lastRun: { status: "ok" } });
    expect(byJob.webhooks).toMatchObject({ healthy: false, failuresRecently: 1, lastRun: { status: "failed", error: "Error: connection refused" } });
    expect(byJob.nudges).toMatchObject({ healthy: false, lastRun: null }); // never ran
    // Two days later the nightly job is overdue.
    expect((await jobStatus(db, new Date(START.getTime() + 2.5 * DAY))).find((s) => s.job === "retention")!.healthy).toBe(false);
    expect((await db.select().from(jobRuns)).length).toBeGreaterThanOrEqual(2);
  });
});
