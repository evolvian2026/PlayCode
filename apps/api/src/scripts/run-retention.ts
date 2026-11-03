import { db, pool } from "../db/client";
import { recordJob } from "../services/jobs";
import { runRetention } from "../services/retention";

// Nightly: delete personal data that has outlived its purpose (webcam
// snapshots after the retention period, sign-in leftovers, old notifications).
// Usage: pnpm retention:run
const now = new Date();
try {
  console.log(await recordJob(db, "retention", now, () => runRetention(db, now)));
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
