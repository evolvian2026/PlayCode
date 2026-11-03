// Mock interview kinds and how each is scored. Technical rounds (service or
// product company), the HR round and the project round (about the student's
// own projects and internships) use different scorecard dimensions.

export type InterviewTrack = "service" | "product" | "hr" | "project";

export const INTERVIEW_TRACK_LABELS: Record<InterviewTrack, string> = {
  service: "Service company",
  product: "Product company",
  hr: "HR round",
  project: "Project round",
};

/**
 * What an interview is about beyond its track, fixed when it starts: the
 * drive it prepares for (with what past candidates reported of the company's
 * rounds), or the projects and internships on the student's resume.
 */
export interface InterviewContext {
  company?: string;
  role?: string;
  /** Published interview experiences for the company: round names and what was asked. */
  experiences?: string[];
  projects?: { kind: "project" | "internship"; title: string; organisation: string; months: string; description: string; link: string | null }[];
}

export const TECHNICAL_DIMENSIONS = [
  ["problemSolving", "Problem solving"],
  ["fundamentals", "Fundamentals"],
  ["communication", "Communication"],
  ["code", "Code"],
] as const;

export const HR_DIMENSIONS = [
  ["structure", "Structure (STAR)"],
  ["evidence", "Specific examples"],
  ["communication", "Communication"],
  ["selfAwareness", "Self-awareness"],
] as const;

export const PROJECT_DIMENSIONS = [
  ["explanation", "Explaining the project"],
  ["ownership", "Own contribution"],
  ["depth", "Technical depth"],
  ["tradeoffs", "Trade-offs and limits"],
] as const;

/** The scorecard dimensions for a kind of interview, as [key, label] pairs. */
export function interviewDimensions(track: InterviewTrack): readonly (readonly [string, string])[] {
  return track === "hr" ? HR_DIMENSIONS : track === "project" ? PROJECT_DIMENSIONS : TECHNICAL_DIMENSIONS;
}

/** The rubric an interviewer (faculty or alumni) fills after a mock interview in person or on a call. */
export const PANEL_RUBRIC = [
  ["communication", "Communication"],
  ["technical", "Technical knowledge"],
  ["problemSolving", "Problem solving"],
  ["confidence", "Confidence and presence"],
] as const;

export type PanelRecommendation = "ready" | "almost" | "not_yet";

export const PANEL_RECOMMENDATIONS: Record<PanelRecommendation, string> = {
  ready: "Ready for interviews",
  almost: "Almost there",
  not_yet: "Needs more practice",
};

export const PANEL_KINDS = { technical: "Technical", hr: "HR", general: "General" } as const;
export type PanelKind = keyof typeof PANEL_KINDS;
