// Getting ready for one drive: the steps that matter for this company, each
// checked from what PlayCode already records. A step that doesn't apply to
// the drive (no practice mission, no minimum aptitude score, a drive on a
// Saturday) is left out rather than counted as done.

export type DrivePrepStep = "mission" | "interview" | "aptitude" | "profile" | "documents" | "on_duty";

export const DRIVE_PREP_STEPS: Record<DrivePrepStep, { label: string; detail: string }> = {
  mission: { label: "Pass the practice mission", detail: "The company-pattern round the placement cell picked for this drive." },
  interview: { label: "A mock interview for this drive", detail: "The AI interviewer runs it as this company's panel." },
  aptitude: { label: "An official aptitude score that meets the minimum", detail: "Only a score from a sitting counts." },
  profile: { label: "Resume headline and summary", detail: "Your resume goes to the company when you register." },
  documents: { label: "Documents uploaded", detail: "Everything the placement cell has asked for." },
  on_duty: { label: "On duty asked for the drive day", detail: "So the class you miss that day is on record." },
};

export const DRIVE_PREP_ORDER: DrivePrepStep[] = ["mission", "interview", "aptitude", "profile", "documents", "on_duty"];

/** Done, not done, or null when the step doesn't apply to this drive. */
export type DrivePrep = Record<DrivePrepStep, boolean | null>;

export function drivePrepProgress(p: DrivePrep) {
  const applies = DRIVE_PREP_ORDER.filter((k) => p[k] !== null);
  const missing = applies.filter((k) => !p[k]);
  return { done: applies.length - missing.length, total: applies.length, missing };
}

/** A drive on a weekday means missing class, so on duty applies; "2026-11-20" is a Friday. */
export function isWeekday(day: string): boolean {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}
