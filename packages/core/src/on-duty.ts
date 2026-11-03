import { addDays } from "./dates";

// On duty: a student away from class for a placement drive, an off-campus
// interview or a placement event, with the placement cell's approval, so the
// class teacher marks them present.

export type OnDutyPart = "full" | "forenoon" | "afternoon";
export type OnDutyReason = "drive" | "opening" | "other";
export type OnDutyStatus = "pending" | "approved" | "rejected" | "cancelled";

export const ON_DUTY_PARTS: Record<OnDutyPart, string> = { full: "Full day", forenoon: "Forenoon", afternoon: "Afternoon" };

/** How far back a student can ask (they often ask after the day), and how far ahead. */
export const ON_DUTY_DAYS_BACK = 14;
export const ON_DUTY_DAYS_AHEAD = 30;
/** Later rounds of a drive can run for a few days after the drive date. */
export const DRIVE_ROUND_DAYS = 7;

/** Two requests on the same day clash unless one is the forenoon and the other the afternoon. */
export function partsOverlap(a: OnDutyPart, b: OnDutyPart): boolean {
  return a === "full" || b === "full" || a === b;
}

/** Why a date can't be asked for, or null if it can. For a drive, the date must be the drive day or a few days after it. */
export function onDutyDateError(date: string, today: string, driveDate?: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a date";
  if (date < addDays(today, -ON_DUTY_DAYS_BACK)) return `Ask within ${ON_DUTY_DAYS_BACK} days of the day`;
  if (date > addDays(today, ON_DUTY_DAYS_AHEAD)) return `You can ask up to ${ON_DUTY_DAYS_AHEAD} days ahead`;
  if (driveDate && (date < driveDate || date > addDays(driveDate, DRIVE_ROUND_DAYS))) return "Choose the drive day, or a day of its later rounds";
  return null;
}

/** The reference printed on the letter, from the request id. */
export function onDutyRef(id: string): string {
  return `OD-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
