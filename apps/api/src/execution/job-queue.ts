import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import pg from "pg";
import type { CodeLanguage } from "@playcode/core";
import type { Db } from "../db/client";
import { executionJobs } from "../db/schema";
import { env } from "../env";
import { HttpError } from "../lib/errors";
import { RANK, type Priority } from "./queue";
import type { RunOutcome, Runner } from "./types";

// The execution queue (EXECUTION_MODE=queue). API instances write a job row
// and wait; worker processes (`pnpm worker`) claim jobs in priority order with
// FOR UPDATE SKIP LOCKED, run them, store the outcome and NOTIFY. Untrusted
// code then runs on worker machines, sized and scaled separately from the API,
// and a burst of contest submissions queues instead of starving the API.

const DONE_CHANNEL = "playcode_exec_done";
/** How long an API request waits for a run before giving up. */
const WAIT_MS = 60_000;
const POLL_MS = 1_000;
/** A job running this long has lost its worker; it goes back in the queue. */
const STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
const KEEP_MS = 86_400_000;

// ---------- API side ----------

const waiters = new Map<string, () => void>();
let listener: Promise<pg.Client> | null = null;

/** One LISTEN connection per process, shared by every waiting request. */
function listen(): Promise<pg.Client> {
  listener ??= (async () => {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    client.on("notification", (m) => {
      if (m.channel === DONE_CHANNEL && m.payload) waiters.get(m.payload)?.();
    });
    const reset = () => {
      listener = null;
      void client.end().catch(() => {});
    };
    client.on("error", reset);
    await client.connect();
    await client.query(`LISTEN ${DONE_CHANNEL}`);
    return client;
  })().catch((err) => {
    listener = null;
    throw err;
  });
  return listener;
}

/** Close the LISTEN connection (on shutdown). */
export async function closeQueueListener(): Promise<void> {
  const current = listener;
  listener = null;
  if (current) await (await current.catch(() => null))?.end().catch(() => {});
}

/** Queue a run and wait for a worker to finish it. Polls as well, so a dropped LISTEN only slows things down. */
export async function runQueued(db: Db, priority: Priority, language: CodeLanguage, source: string, inputs: string[]): Promise<RunOutcome[]> {
  await listen().catch(() => {});
  const [job] = await db.insert(executionJobs).values({ priority: RANK[priority], language, source, inputs }).returning({ id: executionJobs.id });
  const deadline = Date.now() + WAIT_MS;
  try {
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POLL_MS);
        waiters.set(job!.id, () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const [row] = await db.select({ status: executionJobs.status, result: executionJobs.result }).from(executionJobs).where(eq(executionJobs.id, job!.id));
      if (row?.status === "done") return row.result as RunOutcome[];
      if (row?.status === "failed") throw new HttpError(503, "runner_failed", "The code runner couldn't run this. Try again.");
    }
  } finally {
    waiters.delete(job!.id);
  }
  // Nobody picked it up in time: withdraw it if it hasn't started, so it doesn't run for nobody.
  await db.delete(executionJobs).where(and(eq(executionJobs.id, job!.id), eq(executionJobs.status, "queued")));
  throw new HttpError(503, "runner_busy", "Code is taking too long to run right now. Try again in a moment.");
}

/** Jobs waiting for a worker, for monitoring. */
export async function queueBacklog(db: Db) {
  const [row] = await db
    .select({ queued: sql<number>`count(*) filter (where ${executionJobs.status} = 'queued')::int`, running: sql<number>`count(*) filter (where ${executionJobs.status} = 'running')::int` })
    .from(executionJobs);
  return { queued: row?.queued ?? 0, running: row?.running ?? 0 };
}

// ---------- Worker side ----------

type ClaimedJob = {
  id: string;
  language: CodeLanguage;
  source: string;
  inputs: string[];
  attempts: number;
};

async function claim(db: Db, workerId: string): Promise<ClaimedJob | null> {
  const res = await db.execute<ClaimedJob>(sql`
    update ${executionJobs} set status = 'running', started_at = now(), worker_id = ${workerId}, attempts = attempts + 1
    where id = (
      select id from ${executionJobs} where status = 'queued'
      order by priority, created_at
      for update skip locked
      limit 1
    )
    returning id, language, source, inputs, attempts`);
  return res.rows[0] ?? null;
}

async function finish(db: Db, id: string, set: Partial<typeof executionJobs.$inferInsert>) {
  await db.update(executionJobs).set({ ...set, finishedAt: new Date() }).where(eq(executionJobs.id, id));
  await db.execute(sql`select pg_notify(${DONE_CHANNEL}, ${id})`);
}

/** Put back jobs whose worker died mid-run, give up on those that keep failing, and delete old finished jobs (they hold student code). */
export async function sweepJobs(db: Db, now = new Date()) {
  const stale = new Date(now.getTime() - STALE_MS);
  const requeued = await db
    .update(executionJobs)
    .set({ status: "queued", workerId: null, startedAt: null })
    .where(and(eq(executionJobs.status, "running"), lt(executionJobs.startedAt, stale), lt(executionJobs.attempts, MAX_ATTEMPTS)))
    .returning({ id: executionJobs.id });
  const failed = await db
    .update(executionJobs)
    .set({ status: "failed", error: "Worker stopped while running it", finishedAt: now })
    .where(and(eq(executionJobs.status, "running"), lt(executionJobs.startedAt, stale)))
    .returning({ id: executionJobs.id });
  for (const f of failed) await db.execute(sql`select pg_notify(${DONE_CHANNEL}, ${f.id})`);
  const pruned = await db
    .delete(executionJobs)
    .where(and(inArray(executionJobs.status, ["done", "failed"]), lt(executionJobs.finishedAt, new Date(now.getTime() - KEEP_MS))))
    .returning({ id: executionJobs.id });
  return { requeued: requeued.length, failed: failed.length, pruned: pruned.length };
}

/**
 * Run jobs from the queue until stopped: `concurrency` at a time, highest
 * priority first. A job that throws is retried up to MAX_ATTEMPTS times.
 */
export function startWorker(opts: { db: Db; runner: Runner; concurrency: number; workerId?: string; idleMs?: number; log?: (msg: string) => void }) {
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const idleMs = opts.idleMs ?? 250;
  let stopping = false;
  let wake: (() => void) | null = null;
  const nap = (ms: number) => new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    wake = () => {
      clearTimeout(t);
      r();
    };
  });

  const slot = async () => {
    while (!stopping) {
      let job: ClaimedJob | null = null;
      try {
        job = await claim(opts.db, workerId);
      } catch (err) {
        opts.log?.(`claim failed: ${(err as Error).message}`);
      }
      if (!job) {
        await nap(idleMs);
        continue;
      }
      try {
        const outcomes = await opts.runner.run(job.language, job.source, job.inputs);
        await finish(opts.db, job.id, { status: "done", result: outcomes });
      } catch (err) {
        const retry = job.attempts < MAX_ATTEMPTS;
        opts.log?.(`job ${job.id} failed (attempt ${job.attempts}): ${(err as Error).message}`);
        if (retry) await opts.db.update(executionJobs).set({ status: "queued", workerId: null, startedAt: null }).where(eq(executionJobs.id, job.id));
        else await finish(opts.db, job.id, { status: "failed", error: String((err as Error).message).slice(0, 2000) });
      }
    }
  };
  const sweeper = setInterval(() => void sweepJobs(opts.db).catch((err) => opts.log?.(`sweep failed: ${(err as Error).message}`)), 30_000);
  const slots = Array.from({ length: opts.concurrency }, () => slot());
  return {
    workerId,
    async stop() {
      stopping = true;
      clearInterval(sweeper);
      (wake as (() => void) | null)?.();
      await Promise.all(slots);
    },
  };
}
