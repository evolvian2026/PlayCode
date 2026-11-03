// Graduate outcomes beyond campus drives: offers found off campus, admissions
// for higher studies, qualifying exams and startups. Students report them,
// the placement cell verifies them, and the batch report counts each graduate
// once, the way NIRF and NAAC ask for it.

export type OutcomeKind = "job" | "higher_studies" | "exam" | "startup";

export const OUTCOME_KINDS: Record<OutcomeKind, { label: string; organisation: string; detail: string }> = {
  job: { label: "Job offer from off campus", organisation: "Company", detail: "Role" },
  higher_studies: { label: "Admission for higher studies", organisation: "University or institute", detail: "Programme, e.g. M.Tech in CSE" },
  exam: { label: "Qualifying exam cleared", organisation: "Exam", detail: "Score, rank or percentile" },
  startup: { label: "Started a company", organisation: "Company name", detail: "What it does" },
};

/** The exams NAAC asks about (criterion 5.2.3), plus a catch-all. */
export const QUALIFYING_EXAMS = ["GATE", "CAT", "GRE", "GMAT", "JAM", "NET", "IELTS", "TOEFL", "Civil services", "State government", "Other"] as const;

export type GraduateStatus = "placed" | "higher_studies" | "startup" | "not_known";

export const GRADUATE_STATUSES: Record<GraduateStatus, string> = {
  placed: "Placed",
  higher_studies: "Higher studies",
  startup: "Entrepreneurship",
  not_known: "Not known yet",
};

/**
 * One status per graduate, so the columns add up to the batch: a job offer
 * (on or off campus) counts first, then an admission, then a startup.
 * Qualifying exams are counted separately, since clearing one isn't an outcome
 * on its own.
 */
export function graduateStatus(s: { offer: boolean; higherStudies: boolean; startup: boolean }): GraduateStatus {
  if (s.offer) return "placed";
  if (s.higherStudies) return "higher_studies";
  if (s.startup) return "startup";
  return "not_known";
}
