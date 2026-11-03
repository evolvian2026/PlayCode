import { addDays, daysBetween } from "./dates";
import { READINESS_PROFILES } from "./game/readiness";

// Study plans: from today to a target (a placement drive or a date), one task
// a day. Most days practise one skill, chosen by how much it matters for the
// target kind of company and how far the student is from mastering it; every
// seventh day reviews fading skills; the last day before the target is a
// mock round. The plan is a schedule, not a promise: it can be rebuilt from
// today at any time.

/** Mastery a plan aims for on each weighted skill. */
export const PLAN_TARGET_MASTERY = 70;
/** Rough mastery gained from one focused day on a skill, for spreading days over gaps. */
const GAIN_PER_DAY = 15;
export const PLAN_MAX_DAYS = 120;
/** Answers on the day's skill that count the day as done (so does finishing a practice session on it). */
export const PLAN_DAILY_ANSWERS = 8;

export type PlanDay =
  | { date: string; kind: "skill"; skillId: string }
  | { date: string; kind: "review" }
  | { date: string; kind: "mission"; packId: string | null };

export interface PlanSkill {
  id: string;
  /** Mastery 0-100 now. */
  mastery: number;
  /** Skills with no questions can't be practised. */
  practisable: boolean;
}

function weightOf(profileId: string, skillId: string): number {
  const profile = READINESS_PROFILES.find((p) => p.id === profileId);
  if (!profile) return 0;
  const topic = skillId.split(".")[0]!;
  return profile.weights[skillId] ?? profile.weights[topic] ?? 0;
}

/**
 * Build the plan for the days from today up to (not including) the target
 * date. `missionPackId` is the mock round for the last day.
 */
export function buildStudyPlan(args: { skills: PlanSkill[]; profileId: string; today: string; targetDate: string; missionPackId: string | null }): PlanDay[] {
  const days = Math.min(PLAN_MAX_DAYS, daysBetween(args.today, args.targetDate));
  if (days < 1) return [];
  const gaps = new Map(
    args.skills
      .filter((s) => s.practisable && weightOf(args.profileId, s.id) > 0)
      .map((s) => [s.id, { weight: weightOf(args.profileId, s.id), gap: Math.max(0, PLAN_TARGET_MASTERY - s.mastery) }]),
  );
  const plan: PlanDay[] = [];
  let lastSkill: string | null = null;
  for (let i = 0; i < days; i++) {
    const date = addDays(args.today, i);
    if (i === days - 1 && days >= 3) {
      plan.push({ date, kind: "mission", packId: args.missionPackId });
      continue;
    }
    if ((i + 1) % 7 === 0) {
      plan.push({ date, kind: "review" });
      continue;
    }
    // The skill with the largest weighted gap, not the same as yesterday's when there is a choice.
    const ranked = [...gaps.entries()].sort((a, b) => b[1].weight * b[1].gap - a[1].weight * a[1].gap || b[1].weight - a[1].weight || a[0].localeCompare(b[0]));
    const pick = ranked.find(([id, g]) => g.gap > 0 && id !== lastSkill) ?? ranked.find(([, g]) => g.gap > 0);
    if (!pick) {
      // Everything weighted is mastered: keep it fresh.
      plan.push({ date, kind: "review" });
      continue;
    }
    plan.push({ date, kind: "skill", skillId: pick[0] });
    pick[1].gap = Math.max(0, pick[1].gap - GAIN_PER_DAY);
    lastSkill = pick[0];
  }
  return plan;
}

export type PlanDayStatus = "done" | "missed" | "today" | "upcoming";

export function planDayStatus(day: PlanDay, done: boolean, today: string): PlanDayStatus {
  if (done) return "done";
  if (day.date < today) return "missed";
  return day.date === today ? "today" : "upcoming";
}
