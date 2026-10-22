import { db, pool } from "../db/client";
import { deliverDue } from "../services/webhooks";

// Every minute: send due webhook deliveries (including retries).
// Usage: pnpm webhooks:deliver
console.log(await deliverDue(db, new Date(), { limit: 1000 }));
await pool.end();
