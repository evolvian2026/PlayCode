import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { jobRuns } from "../db/schema";

// Scheduled jobs record each run, so PlayCode staff can see that cron is
// actually firing and what each run did, and monitoring can alert on failures.

export const JOBS = {
  nudges: { label: "Nudges, notifications, reports and billing emails", everyHours: 1 },
  webhooks: { label: "Webhook and LMS grade retries", everyHours: 1 / 60 },
  league: { label: "Close the league week", everyHours: 24 * 7 },
  retention: { label: "Data retention clean-up", everyHours: 24 },
  benchmarks: { label: "Peer benchmark snapshots", everyHours: 24 },
} as const;
export type JobName = keyof typeof JOBS;

/** Run a job and record its outcome. Re-throws the error after recording it. */
export async function recordJob<T extends Record<string, unknown>>(db: Db, job: JobName, now: Date, fn: () => Promise<T>): Promise<T> {
  const [run] = await db.insert(jobRuns).values({ job, startedAt: now }).returning({ id: jobRuns.id });
  const t0 = Date.now();
  const finished = () => new Date(now.getTime() + (Date.now() - t0));
  try {
    const summary = await fn();
    await db.update(jobRuns).set({ status: "ok", summary, finishedAt: finished() }).where(eq(jobRuns.id, run!.id));
    return summary;
  } catch (err) {
    await db.update(jobRuns).set({ status: "failed", error: String((err as Error).stack ?? err).slice(0, 4000), finishedAt: finished() }).where(eq(jobRuns.id, run!.id));
    throw err;
  }
}

/** Last run, last success and recent failures of each job, and whether it is overdue (more than twice its interval since the last success). */
export async function jobStatus(db: Db, now: Date) {
  const out = [];
  for (const [job, meta] of Object.entries(JOBS) as [JobName, (typeof JOBS)[JobName]][]) {
    const runs = await db.select().from(jobRuns).where(eq(jobRuns.job, job)).orderBy(desc(jobRuns.startedAt)).limit(20);
    const lastOk = runs.find((r) => r.status === "ok");
    const overdueAfter = Math.max(2 * meta.everyHours * 3600_000, 10 * 60_000);
    out.push({
      job,
      label: meta.label,
      everyHours: meta.everyHours,
      lastRun: runs[0] ? { status: runs[0].status, startedAt: runs[0].startedAt, finishedAt: runs[0].finishedAt, summary: runs[0].summary, error: runs[0].error?.split("\n")[0] ?? null } : null,
      lastSuccessAt: lastOk?.finishedAt ?? null,
      failuresRecently: runs.filter((r) => r.status === "failed").length,
      healthy: Boolean(lastOk && now.getTime() - (lastOk.finishedAt ?? lastOk.startedAt).getTime() <= overdueAfter) && runs[0]?.status !== "failed",
    });
  }
  return out;
}

/** Keep 90 days of run history. */
export async function pruneJobRuns(db: Db, now: Date) {
  const rows = await db.delete(jobRuns).where(and(lt(jobRuns.startedAt, new Date(now.getTime() - 90 * 86_400_000)))).returning({ id: jobRuns.id });
  return rows.length;
}
