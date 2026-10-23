import { addDays, isoWeekKey, localDate } from "@playcode/core";
import { db, pool } from "../db/client";
import { tenants } from "../db/schema";
import { recordJob } from "../services/jobs";
import { closeLeagueWeek } from "../services/leagues";

// Weekly job: close last week's leagues for every tenant.
// Usage: pnpm league:close [YYYY-Www]
const explicit = process.argv[2];
try {
  await recordJob(db, "league", new Date(), async () => {
    const closed: Record<string, unknown> = {};
    for (const tenant of await db.select().from(tenants)) {
      const weekKey = explicit ?? isoWeekKey(addDays(localDate(new Date(), tenant.timeZone), -7));
      closed[tenant.slug] = { week: weekKey, ...(await db.transaction((tx) => closeLeagueWeek(tx, tenant.id, weekKey))) };
      console.log(`${tenant.name} ${weekKey}:`, closed[tenant.slug]);
    }
    return closed;
  });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
