import type { TrainingKind } from "./training";

// Is a student ready for placements: the things the placement cell needs
// from them before drives start, and what recruiters say about the batch.

export type ChecklistItem = "record" | "profile" | "documents" | "mock_interview" | "practice" | "training";

export const CHECKLIST_ITEMS: Record<ChecklistItem, { label: string; hint: string; link: string }> = {
  record: { label: "Academic record complete", hint: "CGPA, backlogs, class 10 and 12 marks and graduating year", link: "/play/placements" },
  profile: { label: "Resume headline and summary", hint: "A one-line headline and a few lines about you", link: "/play/resume" },
  documents: { label: "Documents uploaded", hint: "Everything the placement cell has asked for", link: "/play/documents" },
  mock_interview: { label: "A mock interview done", hint: "At least one full mock interview", link: "/play/interview" },
  practice: { label: "Practice readiness of 50 or more", hint: "For service or product companies", link: "/play" },
  training: { label: "Training attendance of 75% or more", hint: "In placement training sessions", link: "/play/training" },
};

/** The "almost ready" band, from where drives start to go well. */
export const CHECKLIST_READINESS = 50;
export const CHECKLIST_ATTENDANCE = 75;

/** Items that apply (null means it doesn't apply to this student yet), and which are missing. */
export function checklistProgress(items: Record<ChecklistItem, boolean | null>) {
  const keys = (Object.keys(CHECKLIST_ITEMS) as ChecklistItem[]).filter((k) => items[k] !== null);
  const missing = keys.filter((k) => !items[k]);
  return { done: keys.length - missing.length, total: keys.length, missing };
}

/** Eligible for at least this many drives and registered for none: sitting the season out. */
export const SITTING_OUT_MIN_DRIVES = 2;

export type RecruiterDimension = "aptitude" | "technical" | "communication" | "preparedness";

export const RECRUITER_DIMENSIONS: Record<RecruiterDimension, { label: string; training: TrainingKind }> = {
  aptitude: { label: "Aptitude and reasoning", training: "aptitude" },
  technical: { label: "Technical knowledge", training: "technical" },
  communication: { label: "Communication", training: "soft_skills" },
  preparedness: { label: "Preparedness (resume, company research, punctuality)", training: "mock_drive" },
};

export type ReturnIntention = "yes" | "maybe" | "no";
export const RETURN_INTENTIONS: Record<ReturnIntention, string> = { yes: "Will come back next year", maybe: "May come back", no: "Not next year" };

/** Below this average (out of 5) a dimension is a training priority. */
export const PRIORITY_BELOW = 3.5;

/** Dimensions by average rating, lowest first, flagged where training should focus. */
export function trainingPriorities(averages: Partial<Record<RecruiterDimension, number | null>>) {
  return (Object.keys(RECRUITER_DIMENSIONS) as RecruiterDimension[])
    .filter((d) => averages[d] != null)
    .map((d) => ({ dimension: d, average: averages[d]!, priority: averages[d]! < PRIORITY_BELOW, training: RECRUITER_DIMENSIONS[d].training }))
    .sort((a, b) => a.average - b.average);
}
