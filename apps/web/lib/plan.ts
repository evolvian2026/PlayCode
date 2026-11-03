import type { StartInput } from "./start";

export interface PlanDayView {
  date: string;
  kind: "skill" | "review" | "mission";
  skillId?: string;
  packId?: string | null;
  title: string;
  status: "done" | "missed" | "today" | "upcoming";
}

export interface StudyPlan {
  target: { label: string; date: string; profile: "service" | "product"; driveId: string | null };
  daysLeft: number;
  today: PlanDayView | null;
  doneSoFar: number;
  dueSoFar: number;
  days: PlanDayView[];
}

export function startFor(day: PlanDayView): StartInput {
  if (day.kind === "skill") return { kind: "skill", skillId: day.skillId! };
  if (day.kind === "mission" && day.packId) return { kind: "pack", packId: day.packId };
  return { kind: "review" };
}
