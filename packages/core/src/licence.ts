import { addDays, daysBetween } from "./dates";

// Licence lifecycle. After the end date there is a grace period with full
// access and a warning; after that the account is read-only until renewed.
// Read-only keeps sign-in, viewing, data export and privacy requests working:
// people never lose access to their own data because a contract lapsed.

export const LICENCE_GRACE_DAYS = 14;
/** Admins see a renewal reminder this many days before the end date. */
export const LICENCE_WARNING_DAYS = 30;

export type LicenceState = "active" | "ending" | "grace" | "expired";

export interface LicenceStatus {
  state: LicenceState;
  validUntil: string | null;
  /** Days left until the end date (negative once it has passed). */
  daysLeft: number | null;
  /** Last day of full access after the end date. */
  graceEndsOn: string | null;
}

/** The earliest of the given end dates applies (a college under a partner can't outlast the partner). */
export function effectiveEnd(...dates: (string | null | undefined)[]): string | null {
  const known = dates.filter((d): d is string => Boolean(d)).sort();
  return known[0] ?? null;
}

export function licenceStatus(validUntil: string | null, today: string): LicenceStatus {
  if (!validUntil) return { state: "active", validUntil: null, daysLeft: null, graceEndsOn: null };
  const daysLeft = daysBetween(today, validUntil);
  const graceEndsOn = addDays(validUntil, LICENCE_GRACE_DAYS);
  const state: LicenceState = daysLeft >= 0 ? (daysLeft <= LICENCE_WARNING_DAYS ? "ending" : "active") : today <= graceEndsOn ? "grace" : "expired";
  return { state, validUntil, daysLeft, graceEndsOn };
}

/** A new end date: the given months after today or the current end date, whichever is later. */
export function renewedUntil(validUntil: string | null, today: string, months: number): string {
  const base = validUntil && validUntil > today ? validUntil : today;
  const [y, m, d] = base.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}
