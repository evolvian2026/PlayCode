import { addDays, isoWeekKey, localDate } from "@playcode/core";
import { db, pool } from "../db/client";
import { tenants } from "../db/schema";
import { closeLeagueWeek } from "../services/leagues";

// Weekly job: close last week's leagues for every tenant.
// Usage: pnpm league:close [YYYY-Www]
const explicit = process.argv[2];
for (const tenant of await db.select().from(tenants)) {
  const weekKey = explicit ?? isoWeekKey(addDays(localDate(new Date(), tenant.timeZone), -7));
  const summary = await db.transaction((tx) => closeLeagueWeek(tx, tenant.id, weekKey));
  console.log(`${tenant.name} ${weekKey}:`, summary);
}
await pool.end();
