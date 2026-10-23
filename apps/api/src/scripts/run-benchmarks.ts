import { db, pool } from "../db/client";
import { snapshotBenchmarks } from "../services/benchmarks";
import { recordJob } from "../services/jobs";

// Nightly: snapshot each institution's aggregates for peer benchmarks.
// Usage: pnpm benchmarks:run
const now = new Date();
try {
  console.log(await recordJob(db, "benchmarks", now, () => snapshotBenchmarks(db, now)));
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
