// Calendar helpers. Streaks and leagues run on the tenant's local calendar
// (default Asia/Kolkata), so all game dates are plain "YYYY-MM-DD" strings.

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function localDate(now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toUtcDays(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return toUtcDays(b) - toUtcDays(a);
}

export function addDays(date: string, days: number): string {
  return new Date((toUtcDays(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(toUtcDays(date) * 86_400_000).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const d = weekday(date);
  return d === 0 || d === 6;
}

/** ISO-8601 week key, e.g. "2026-W43". Leagues run Monday to Sunday. */
export function isoWeekKey(date: string): string {
  const day = (weekday(date) + 6) % 7; // Monday = 0
  const thursday = addDays(date, 3 - day);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}
