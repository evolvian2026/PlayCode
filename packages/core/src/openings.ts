// Openings found outside campus drives, and where accepted offers stand
// between the offer and the first day at work.

export type OpeningKind = "off_campus" | "pool_campus" | "internship";

export const OPENING_KINDS: Record<OpeningKind, string> = {
  off_campus: "Off-campus",
  pool_campus: "Pool campus",
  internship: "Internship",
};

export type OpeningResponse = "applied" | "not_interested";

/** "open", "closing" (today or tomorrow is the last day) or "closed", for a closing date against today (both "2026-10-29"). */
export function openingState(closesOn: string, today: string): "open" | "closing" | "closed" {
  if (closesOn < today) return "closed";
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return closesOn <= tomorrow ? "closing" : "open";
}

export type JoiningStatus = "awaiting_letter" | "letter_received" | "date_given" | "joined" | "revoked";

export const JOINING_STATUSES: Record<JoiningStatus, string> = {
  awaiting_letter: "Waiting for the offer letter",
  letter_received: "Offer letter received",
  date_given: "Joining date given",
  joined: "Joined",
  revoked: "Offer withdrawn by the company",
};

/** Statuses a student can report; only the placement cell records a withdrawn offer, since it reopens drives. */
export const STUDENT_JOINING_STATUSES: JoiningStatus[] = ["awaiting_letter", "letter_received", "date_given", "joined"];

/** Days after which an accepted offer with no joining date counts as delayed. */
export const JOINING_DELAY_DAYS = 90;

/**
 * Whether an accepted offer is delayed: no joining date (and not joined)
 * this long after the drive, or a joining date that has passed without
 * the student joining.
 */
export function joiningDelayed(o: { status: JoiningStatus | null; joiningDate: string | null; driveDate: string }, today: string): boolean {
  if (o.status === "joined" || o.status === "revoked") return false;
  if (o.joiningDate) return o.joiningDate < today;
  const since = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${o.driveDate}T00:00:00Z`)) / 86_400_000;
  return since > JOINING_DELAY_DAYS;
}
