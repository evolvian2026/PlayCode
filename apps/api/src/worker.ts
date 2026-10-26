import { db, pool } from "./db/client";
import { env } from "./env";
import { createRunner } from "./execution";
import { startWorker } from "./execution/job-queue";

// Execution worker (EXECUTION_MODE=queue): runs student code from the queue,
// EXECUTION_CONCURRENCY programs at a time. Run as many as the load needs, on
// machines sized for running code; they only need the database.
// Usage: pnpm worker
const worker = startWorker({ db, runner: createRunner(), concurrency: env.EXECUTION_CONCURRENCY, log: (m) => console.error(m) });
console.log(`${worker.workerId} running ${env.EXECUTION_CONCURRENCY} at a time`);

const shutdown = async () => {
  // Finish the programs already running, then exit.
  await worker.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
