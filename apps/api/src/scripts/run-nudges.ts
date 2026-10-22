import { db, pool } from "../db/client";
import { processOutbox } from "../services/notifications";
import { runNudges } from "../services/nudges";

// Hourly job: queue automatic nudges (streaks, due assignments, open tests)
// and deliver everything pending. Usage: pnpm nudges:run
const now = new Date();
console.log("queued", await runNudges(db, now));
console.log("delivered", await processOutbox(db, now, 5000));
await pool.end();
