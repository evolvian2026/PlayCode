import { db, pool } from "../db/client";
import { deliverLtiScores } from "../services/lti";
import { deliverDue } from "../services/webhooks";

// Every minute: send due webhook deliveries and LMS grade passbacks (including retries).
// Usage: pnpm webhooks:deliver
const now = new Date();
console.log("webhooks", await deliverDue(db, now, { limit: 1000 }));
console.log("lms scores", await deliverLtiScores(db, now, { limit: 1000 }));
await pool.end();
