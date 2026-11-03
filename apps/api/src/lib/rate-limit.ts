import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { rateLimits } from "../db/schema";
import { HttpError } from "./errors";

// Rate limits shared by every API instance, kept in Postgres. Each key counts
// hits in fixed windows; the limit applies to a sliding estimate (this
// window's hits plus the previous window's, weighted by how much of it still
// overlaps), which avoids the double burst at window edges. Every attempt
// counts, including refused ones, so hammering keeps a client locked out.

export async function rateLimit(key: string, max: number, windowMs: number, now = new Date(), message = "Too many attempts"): Promise<void> {
  const t = now.getTime();
  const start = new Date(Math.floor(t / windowMs) * windowMs);
  const previous = new Date(start.getTime() - windowMs);
  const [current] = await db
    .insert(rateLimits)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  const [prev] = await db.select({ count: rateLimits.count }).from(rateLimits).where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, previous)));
  const overlap = 1 - (t - start.getTime()) / windowMs;
  const estimate = current!.count + (prev?.count ?? 0) * overlap;
  // Now and then, drop counters older than a day.
  if (Math.random() < 0.01) void db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(t - 86_400_000))).catch(() => {});
  if (estimate > max) {
    const retryS = Math.max(1, Math.ceil((start.getTime() + windowMs - t) / 1000));
    throw new HttpError(429, "rate_limited", `${message}. Try again in ${retryS} seconds.`);
  }
}

/** Tests reset the counters between runs. */
export async function resetRateLimits(): Promise<void> {
  await db.delete(rateLimits);
}
