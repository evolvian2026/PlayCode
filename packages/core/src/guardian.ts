// Monthly progress emails to a parent or guardian, which a student chooses to
// send. The guardian confirms the address first, and either side can stop it.

export type GuardianRelation = "father" | "mother" | "guardian";

export const GUARDIAN_RELATIONS: Record<GuardianRelation, string> = { father: "Father", mother: "Mother", guardian: "Guardian" };

/** A month's report goes out from this local hour on the 1st. */
export const GUARDIAN_REPORT_HOUR = 9;
/** After this many days into the next month, a missed report is skipped rather than sent late. */
export const GUARDIAN_REPORT_LATEST_DAY = 7;

/**
 * The month ("2026-10") whose report is due on this local date and hour, or
 * null outside the sending window.
 */
export function guardianReportMonth(localDate: string, hour: number): string | null {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  if (d > GUARDIAN_REPORT_LATEST_DAY || (d === 1 && hour < GUARDIAN_REPORT_HOUR)) return null;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** First and last day of a month, "2026-10" to "2026-10-01" and "2026-10-31". */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
