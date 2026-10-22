import { db, pool } from "../db/client";
import { processOutbox } from "../services/notifications";
import { runNudges } from "../services/nudges";
import { sendDueReports } from "../services/reports";
import { reviewPendingSnapshots } from "../services/snapshot-review";

// Hourly job: queue automatic nudges (streaks, due assignments, open tests)
// and deliver everything pending; also catch up on webcam snapshots of
// level-3 tests that missed their AI review, and email the weekly reports
// that are due. Usage: pnpm nudges:run
const now = new Date();
console.log("queued", await runNudges(db, now));
console.log("delivered", await processOutbox(db, now, 5000));
console.log("snapshots reviewed", await reviewPendingSnapshots(db, now));
console.log("reports", await sendDueReports(db, now));
await pool.end();
