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

/** Indian academic years run from June to May; "2026-27" is 1 June 2026 to 31 May 2027. */
export function academicYearOf(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = m >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function academicYearRange(label: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) return null;
  return { from: `${m[1]}-06-01`, to: `${Number(m[1]) + 1}-05-31` };
}

/** What students rate after a session, each from 1 to 5. */
export type FeedbackDimension = "content" | "delivery" | "relevance";

export const FEEDBACK_DIMENSIONS: Record<FeedbackDimension, string> = {
  content: "The content was worth the time",
  delivery: "The trainer explained clearly",
  relevance: "It will help me in placements",
};

/** Attendees can rate a session from its start until this many days after it ends. */
export const FEEDBACK_WINDOW_DAYS = 7;
/** Averages and comments are shown only once this many attendees have responded, so no single response can be traced back. */
export const MIN_FEEDBACK_RESPONSES = 3;

export function feedbackOpen(session: { startsAt: Date; durationMinutes: number }, now: Date): boolean {
  const end = session.startsAt.getTime() + session.durationMinutes * 60_000;
  return now.getTime() >= session.startsAt.getTime() && now.getTime() <= end + FEEDBACK_WINDOW_DAYS * 86_400_000;
}

/** Mean of 1-5 ratings to one decimal place, or null with none. */
export function meanRating(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}
