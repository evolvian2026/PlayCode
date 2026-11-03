import { addDays, daysBetween } from "../dates";

// Spaced review: placement tests come months after a skill is first learned,
// and unpractised skills fade. Each skill a student has started sits on a
// Leitner-style ladder of review intervals. Remembering a skill when it is due
// moves it up a step (a longer gap before the next review); a wrong answer
// moves it down one. Practising early refreshes the due date without moving
// it up, so cramming doesn't earn long gaps.

/** Days until the next review at each step. */
export const REVIEW_INTERVALS = [2, 5, 12, 30, 60, 120] as const;
/** Below this mastery a skill still needs learning, not reviewing. */
export const REVIEW_MIN_MASTERY = 35;
/** Questions per due skill in a review session, and skills per session. */
export const REVIEW_PER_SKILL = 2;
export const REVIEW_MAX_SKILLS = 5;

export interface ReviewState {
  step: number;
  /** YYYY-MM-DD, or null for a skill never practised. */
  dueOn: string | null;
}

export function reviewInterval(step: number): number {
  return REVIEW_INTERVALS[Math.max(0, Math.min(step, REVIEW_INTERVALS.length - 1))]!;
}

/** The skill's review state after an answer on it today. */
export function afterAnswer(state: ReviewState, correct: boolean, today: string): ReviewState {
  const due = state.dueOn !== null && state.dueOn <= today;
  let step = state.step;
  if (!correct) step = Math.max(0, step - 1);
  else if (due) step = Math.min(step + 1, REVIEW_INTERVALS.length - 1);
  return { step, dueOn: addDays(today, reviewInterval(step)) };
}

export interface ReviewSkill {
  skillId: string;
  mastery: number;
  step: number;
  dueOn: string | null;
}

/** Skills due for review today, most overdue first (ties: stronger skills first, they have the most to lose). */
export function dueForReview<T extends ReviewSkill>(skills: T[], today: string): (T & { overdueDays: number })[] {
  return skills
    .filter((s) => s.dueOn !== null && s.dueOn <= today && s.mastery >= REVIEW_MIN_MASTERY)
    .map((s) => ({ ...s, overdueDays: daysBetween(s.dueOn!, today) }))
    .sort((a, b) => b.overdueDays - a.overdueDays || b.mastery - a.mastery || a.skillId.localeCompare(b.skillId));
}

/** How long a skill can go unreviewed: the current interval. Shown as "keeps for N days". */
export function retentionLabel(step: number): string {
  const d = reviewInterval(step);
  return d >= 30 ? `${Math.round(d / 30)} month${d >= 60 ? "s" : ""}` : `${d} days`;
}
