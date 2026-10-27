// Placement training sessions (aptitude classes, soft-skills workshops, mock
// drives) and the attendance rules for them.

export type TrainingKind = "aptitude" | "technical" | "soft_skills" | "mock_drive" | "other";

export const TRAINING_KINDS: Record<TrainingKind, string> = {
  aptitude: "Aptitude and reasoning",
  technical: "Technical",
  soft_skills: "Soft skills",
  mock_drive: "Mock drive",
  other: "Other",
};

/** Checking in this long after the start counts as late. */
export const LATE_AFTER_MINUTES = 15;
/** Check-in can open this long before the start, and stays open at most this long after the end. */
export const CHECK_IN_GRACE_MINUTES = 30;
/** The room's check-in code changes this often; the previous code is still accepted. */
export const CHECK_IN_CODE_SECONDS = 30;
/** Attendance below this is flagged, the threshold most colleges use for eligibility. */
export const ATTENDANCE_TARGET_PCT = 75;

/** Attendance as a whole percentage, or null when there was nothing to attend. */
export function attendancePct(attended: number, held: number): number | null {
  return held > 0 ? Math.round((attended / held) * 100) : null;
}
