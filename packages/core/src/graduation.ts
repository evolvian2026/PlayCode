// Graduating a batch: accounts become read-only (so seats are freed), and
// graduates are asked to join the alumni list and to say how training and
// placement went, in an exit survey the placement cell sees without names.

export type ExitItem = "training" | "practice" | "information" | "support" | "overall";

export const EXIT_ITEMS: Record<ExitItem, string> = {
  training: "Placement training sessions (aptitude, coding, soft skills)",
  practice: "Practice and mock interviews",
  information: "Information about drives and companies",
  support: "Help from the placement cell when you needed it",
  overall: "The placement process overall",
};

/** How long a graduation can be undone, for a batch marked by mistake. */
export const GRADUATION_UNDO_DAYS = 14;

/** Below this many answers, comments and averages could point to a person, so the console waits. */
export const EXIT_SURVEY_MIN_RESPONSES = 3;

export interface ExitAnswer {
  ratings: Record<ExitItem, number>;
  recommend: boolean;
}

/** Averages (one decimal) and the share who'd recommend the placement support to juniors. */
export function exitSummary(answers: ExitAnswer[]) {
  const items = Object.keys(EXIT_ITEMS) as ExitItem[];
  const avg = (k: ExitItem) => (answers.length ? Math.round((answers.reduce((s, a) => s + a.ratings[k], 0) / answers.length) * 10) / 10 : null);
  return {
    responses: answers.length,
    averages: Object.fromEntries(items.map((k) => [k, avg(k)])) as Record<ExitItem, number | null>,
    recommendPct: answers.length ? Math.round((answers.filter((a) => a.recommend).length / answers.length) * 100) : null,
  };
}
