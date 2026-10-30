// Drive days: messages to a drive's applicants, student coordinators at the
// reporting desk, and what an offer is made of.

export type DriveAudience = "all" | "in_selection" | "round" | "offered" | "not_selected";

export const DRIVE_AUDIENCES: Record<DriveAudience, string> = {
  all: "Everyone registered",
  in_selection: "Still in the selection",
  round: "Waiting for a round",
  offered: "With an offer",
  not_selected: "Not selected",
};

/** Whether an application is in an update's audience (`round` is the index of the round they're waiting for). */
export function inAudience(app: { status: string; roundsCleared: number }, audience: DriveAudience, round: number | null): boolean {
  const selecting = app.status === "registered" || app.status === "shortlisted";
  switch (audience) {
    case "all":
      return app.status !== "withdrawn";
    case "in_selection":
      return selecting;
    case "round":
      return selecting && app.roundsCleared === round;
    case "offered":
      return app.status === "offered";
    case "not_selected":
      return app.status === "rejected";
  }
}

/** The most students coordinating one drive. */
export const MAX_COORDINATORS = 6;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Coordinators can use the reporting desk from the day before the drive to the day after. */
export function deskOpen(driveDate: string, today: string): boolean {
  return today >= addDays(driveDate, -1) && today <= addDays(driveDate, 1);
}

/** What an offer is made of, as the company states it. All amounts in rupees. */
export interface OfferDetails {
  fixedRupees?: number | null;
  variableRupees?: number | null;
  joiningBonusRupees?: number | null;
  /** Service agreement: months the student commits to, and what leaving early costs. */
  bondMonths?: number | null;
  bondAmountRupees?: number | null;
  probationMonths?: number | null;
  notes?: string;
}

export function offerDetailsError(d: OfferDetails, ctcRupees: number): string | null {
  const fixed = d.fixedRupees ?? 0;
  const variable = d.variableRupees ?? 0;
  if (fixed + variable > ctcRupees) return "Fixed and variable pay add up to more than the CTC";
  if (d.bondAmountRupees && !d.bondMonths) return "Enter how long the service agreement is";
  return null;
}

/** Share of the CTC that is fixed pay, in percent (null when the fixed pay isn't stated). */
export function fixedShare(d: OfferDetails | null, ctcRupees: number): number | null {
  return d?.fixedRupees ? Math.round((d.fixedRupees / ctcRupees) * 100) : null;
}
