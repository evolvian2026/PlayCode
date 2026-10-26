// Mock interview kinds and how each is scored. Technical rounds (service or
// product company) and the HR round use different scorecard dimensions.

export type InterviewTrack = "service" | "product" | "hr";

export const INTERVIEW_TRACK_LABELS: Record<InterviewTrack, string> = {
  service: "Service company",
  product: "Product company",
  hr: "HR round",
};

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

/** The scorecard dimensions for a kind of interview, as [key, label] pairs. */
export function interviewDimensions(track: InterviewTrack): readonly (readonly [string, string])[] {
  return track === "hr" ? HR_DIMENSIONS : TECHNICAL_DIMENSIONS;
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
