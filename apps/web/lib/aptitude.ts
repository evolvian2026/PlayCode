/** Pill colour for an adaptive-test score band. */
export const BAND_TONE: Record<string, string> = { strong: "good", good: "good", developing: "warn", needs_work: "bad" };

/** Seconds as "1m 35s", or "40s" under a minute. */
export function duration(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
