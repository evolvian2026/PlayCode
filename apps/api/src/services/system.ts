import { readFileSync } from "node:fs";
import { queueBacklog } from "../execution/job-queue";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { ltiScores, notifications, webhookDeliveries } from "../db/schema";
import type { Gauge } from "../lib/metrics";
import { jobStatus } from "./jobs";

// What PlayCode staff (and monitoring) need to know about the running
// system: database reachable and migrated, scheduled jobs firing, and
// outboxes draining.

const journal = (): { tag: string }[] => {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")).entries;
  } catch {
    return [];
  }
};

export async function readiness(db: Db) {
  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    return { ready: false, database: false, migrations: null, error: (err as Error).message };
  }
  const expected = journal().length;
  let applied = 0;
  try {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = r.rows[0]?.n ?? 0;
  } catch {
    applied = 0;
  }
  // When the journal isn't shipped (some deployments), only the database check applies.
  const migrated = expected === 0 || applied >= expected;
  return { ready: migrated, database: true, migrations: { applied, expected: expected || null } };
}

export async function backlog(db: Db) {
  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const runs = await queueBacklog(db);
  return {
    notificationsPending: await count(db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(eq(notifications.status, "pending"))),
    webhooksPending: await count(db.select({ n: sql<number>`count(*)::int` }).from(webhookDeliveries).where(eq(webhookDeliveries.status, "pending"))),
    webhooksFailed: await count(db.select({ n: sql<number>`count(*)::int` }).from(webhookDeliveries).where(eq(webhookDeliveries.status, "failed"))),
    lmsScoresPending: await count(db.select({ n: sql<number>`count(*)::int` }).from(ltiScores).where(eq(ltiScores.status, "pending"))),
    /** Code runs waiting for, and being run by, execution workers (EXECUTION_MODE=queue). */
    codeRunsQueued: runs.queued,
    codeRunsRunning: runs.running,
  };
}

export async function systemStatus(db: Db, now: Date) {
  const [ready, jobs, queues, size] = await Promise.all([
    readiness(db),
    jobStatus(db, now),
    backlog(db),
    db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`),
  ]);
  return { ready, jobs, backlog: queues, databaseBytes: Number(size.rows[0]?.bytes ?? 0), version: process.env.APP_VERSION ?? null, checkedAt: now };
}

/** Gauges for /metrics. */
export async function systemGauges(db: Db, now: Date): Promise<Gauge[]> {
  const [jobs, queues] = await Promise.all([jobStatus(db, now), backlog(db)]);
  return [
    { name: "playcode_job_healthy", help: "1 when the scheduled job's last run succeeded and it is not overdue.", values: jobs.map((j) => ({ labels: { job: j.job }, value: j.healthy ? 1 : 0 })) },
    {
      name: "playcode_job_last_success_timestamp_seconds",
      help: "When the scheduled job last succeeded (0: never).",
      values: jobs.map((j) => ({ labels: { job: j.job }, value: j.lastSuccessAt ? Math.round(new Date(j.lastSuccessAt).getTime() / 1000) : 0 })),
    },
    { name: "playcode_outbox_pending", help: "Items waiting to be delivered.", values: [{ labels: { outbox: "notifications" }, value: queues.notificationsPending }, { labels: { outbox: "webhooks" }, value: queues.webhooksPending }, { labels: { outbox: "lms_scores" }, value: queues.lmsScoresPending }] },
    { name: "playcode_webhook_deliveries_failed", help: "Webhook deliveries that gave up after all retries.", values: [{ value: queues.webhooksFailed }] },
    { name: "playcode_code_runs", help: "Code runs in the execution queue, by state.", values: [{ labels: { state: "queued" }, value: queues.codeRunsQueued }, { labels: { state: "running" }, value: queues.codeRunsRunning }] },
  ];
}
