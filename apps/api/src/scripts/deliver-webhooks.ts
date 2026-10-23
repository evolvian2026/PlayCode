import { db, pool } from "../db/client";
import { recordJob } from "../services/jobs";
import { deliverLtiScores } from "../services/lti";
import { deliverDue } from "../services/webhooks";

// Every minute: send due webhook deliveries and LMS grade passbacks (including retries).
// Usage: pnpm webhooks:deliver
const now = new Date();
try {
  console.log(await recordJob(db, "webhooks", now, async () => ({ webhooks: await deliverDue(db, now, { limit: 1000 }), lmsScores: await deliverLtiScores(db, now, { limit: 1000 }) })));
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
