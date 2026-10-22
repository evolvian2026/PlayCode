import { HttpError } from "./errors";

// In-process sliding-window limiter for unauthenticated endpoints (sign-in,
// public sign-up, API tokens). With several API instances, back it with Redis.

const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): void {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    const retryS = Math.ceil((windowMs - (now - recent[0]!)) / 1000);
    throw new HttpError(429, "rate_limited", `Too many attempts. Try again in ${retryS} seconds.`);
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep memory bounded.
  if (hits.size > 50_000) for (const k of [...hits.keys()].slice(0, 10_000)) hits.delete(k);
}

/** Tests reset the limiter between runs. */
export function resetRateLimits(): void {
  hits.clear();
}
