import { daysBetween } from "../dates";

// Readiness (v1, rules-based): a 0-100 estimate per company profile of how
// ready a student is for that profile's online test today.
//   Readiness_p = sum over skills of w(p,s) * Mastery_s * Recency_s / sum of w
// Skills never attempted count as 0 (coverage).

export interface ReadinessProfile {
  id: string;
  name: string;
  /** Skill id or topic prefix (e.g. "loops" matches "loops.nested") to weight. */
  weights: Record<string, number>;
}

export const READINESS_PROFILES: ReadinessProfile[] = [
  {
    id: "service",
    name: "Service companies",
    weights: { basics: 3, loops: 3, conditionals: 2, arrays: 2, strings: 2, functions: 2, pseudocode: 3, oop: 1 },
  },
  {
    id: "product",
    name: "Product companies",
    weights: { arrays: 3, strings: 3, recursion: 3, complexity: 3, functions: 2, oop: 2, pointers: 1, loops: 1 },
  },
];

export interface SkillMastery {
  skillId: string;
  mastery: number; // 0-100
  lastPractisedAt: string | null; // YYYY-MM-DD
}

export function recencyFactor(lastPractisedAt: string | null, today: string): number {
  if (!lastPractisedAt) return 0;
  const days = daysBetween(lastPractisedAt, today);
  if (days <= 30) return 1;
  return Math.max(0.5, 1 - (days - 30) / 120);
}

function topicOf(skillId: string): string {
  return skillId.split(".")[0]!;
}

export interface ReadinessComponent {
  key: string;
  weight: number;
  mastery: number;
  recency: number;
  contribution: number;
}

export interface ReadinessResult {
  profileId: string;
  score: number;
  components: ReadinessComponent[];
}

/**
 * Score one profile. When a weight key is a topic, the topic's mastery is the
 * mean of its skills' recency-adjusted mastery, counting only skills that exist
 * in `skillIdsByTopic` so unattempted skills pull the score down.
 */
export function computeReadiness(
  profile: ReadinessProfile,
  masteries: SkillMastery[],
  skillIdsByTopic: Record<string, string[]>,
  today: string,
): ReadinessResult {
  const bySkill = new Map(masteries.map((m) => [m.skillId, m]));
  const components: ReadinessComponent[] = [];
  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(profile.weights)) {
    const skillIds = skillIdsByTopic[key] ?? (bySkill.has(key) ? [key] : []);
    if (skillIds.length === 0) continue; // topic not in the syllabus yet
    let sum = 0;
    let recencySum = 0;
    for (const id of skillIds) {
      const m = bySkill.get(id);
      const recency = recencyFactor(m?.lastPractisedAt ?? null, today);
      sum += (m?.mastery ?? 0) * recency;
      recencySum += recency;
    }
    const mastery = sum / skillIds.length;
    components.push({ key, weight, mastery: Math.round(mastery), recency: Math.round((recencySum / skillIds.length) * 100) / 100, contribution: weight * mastery });
    weighted += weight * mastery;
    totalWeight += weight;
  }
  const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  return { profileId: profile.id, score, components };
}

export function groupSkillsByTopic(skillIds: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of skillIds) (out[topicOf(id)] ??= []).push(id);
  return out;
}

export function readinessBand(score: number): "ready" | "almost" | "building" | "at_risk" {
  if (score >= 70) return "ready";
  if (score >= 50) return "almost";
  if (score >= 30) return "building";
  return "at_risk";
}
