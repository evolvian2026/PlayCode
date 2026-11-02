import { APTITUDE_TEMPLATES, type AptitudeTopic } from "./aptitude-gen";

// An adaptive aptitude test, in the style of the tests mass recruiters use:
// each answer moves an estimate of ability, the next question is pitched at
// that estimate, and the score is the estimate on a 100 to 900 scale. Ability
// and question difficulty share one scale (a Rasch model); the estimate is
// the mean of the posterior over a grid, from a standard normal prior, so a
// few answers can't send it to an extreme.

export interface AdaptiveSection {
  key: AptitudeTopic;
  title: string;
  items: number;
  minutes: number;
}

export const ADAPTIVE_SECTIONS: AdaptiveSection[] = [
  { key: "quant", title: "Quantitative ability", items: 12, minutes: 18 },
  { key: "reasoning", title: "Logical reasoning", items: 10, minutes: 12 },
];

/** Difficulty of a level on the ability scale: level 3 is average. */
export const levelDifficulty = (level: number) => level - 3;

const GRID = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);

/** Ability estimate and its uncertainty from the answers so far. */
export function estimateAbility(answers: { level: number; correct: boolean }[]): { theta: number; se: number } {
  const logPost = GRID.map((t) => {
    let lp = -(t * t) / 2;
    for (const a of answers) {
      const p = 1 / (1 + Math.exp(-(t - levelDifficulty(a.level))));
      lp += Math.log(a.correct ? p : 1 - p);
    }
    return lp;
  });
  const max = Math.max(...logPost);
  const w = logPost.map((lp) => Math.exp(lp - max));
  const total = w.reduce((s, x) => s + x, 0);
  const theta = GRID.reduce((s, t, i) => s + t * w[i]!, 0) / total;
  const variance = GRID.reduce((s, t, i) => s + (t - theta) ** 2 * w[i]!, 0) / total;
  return { theta: Math.round(theta * 100) / 100, se: Math.round(Math.sqrt(variance) * 100) / 100 };
}

/** The level to ask next: the one closest to the current estimate. */
export function nextLevel(theta: number): number {
  return Math.min(5, Math.max(1, Math.round(theta + 3)));
}

/** The template to ask next: the topic's least asked so far, so the section covers its ground. */
export function nextTemplate(topic: AptitudeTopic, asked: string[], r: () => number): string {
  const ids = APTITUDE_TEMPLATES.filter((t) => t.topic === topic).map((t) => t.id);
  const count = (id: string) => asked.filter((a) => a === id).length;
  const least = Math.min(...ids.map(count));
  const pool = ids.filter((id) => count(id) === least && id !== asked.at(-1));
  const from = pool.length ? pool : ids.filter((id) => count(id) === least);
  return from[Math.floor(r() * from.length)]!;
}

/** Ability on a 100 to 900 scale, in steps of 5: 500 is average. */
export function scaledScore(theta: number): number {
  return Math.min(900, Math.max(100, Math.round((500 + 100 * theta) / 5) * 5));
}

export function scoreBand(score: number): "strong" | "good" | "developing" | "needs_work" {
  return score >= 650 ? "strong" : score >= 525 ? "good" : score >= 400 ? "developing" : "needs_work";
}

export const SCORE_BANDS: Record<ReturnType<typeof scoreBand>, string> = {
  strong: "Strong",
  good: "Good",
  developing: "Developing",
  needs_work: "Needs work",
};

/**
 * The level to drill a topic at, from how a student has done on it: the
 * level they've been answering, one easier if they get most wrong, one
 * harder if they get most right.
 */
export function suggestedDrillLevel(accuracyPct: number, averageLevel: number): number {
  const step = accuracyPct < 50 ? -1 : accuracyPct >= 80 ? 1 : 0;
  return Math.min(5, Math.max(1, Math.round(averageLevel) + step));
}

/** The time a test allows for one question of a section, in seconds: 90 for quantitative ability, 72 for reasoning. */
export function paceTarget(topic: AptitudeTopic): number {
  const s = ADAPTIVE_SECTIONS.find((x) => x.key === topic)!;
  return Math.round((s.minutes * 60) / s.items);
}

/** The middle of a set of answer times, or null with too few to say: one slow question shouldn't label a topic. */
export function medianSeconds(times: number[], min = 3): number | null {
  if (times.length < min) return null;
  const xs = [...times].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return Math.round(xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2);
}

/** Slow when the usual answer takes more than a quarter longer than the test allows. */
export function paceVerdict(seconds: number, target: number): "slow" | "on_pace" {
  return seconds > target * 1.25 ? "slow" : "on_pace";
}

/**
 * How far two scores must differ to count as a change. A score is an
 * estimate with a likely range of about 30 to 40 points either way, so a
 * smaller difference between two sittings may be nothing but that.
 */
export const SCORE_CHANGE_MARGIN = 30;

export function scoreMove(from: number, to: number): "up" | "same" | "down" {
  return to - from >= SCORE_CHANGE_MARGIN ? "up" : from - to >= SCORE_CHANGE_MARGIN ? "down" : "same";
}

export const BAND_ORDER = ["needs_work", "developing", "good", "strong"] as const;
type Band = (typeof BAND_ORDER)[number];

export interface ScorePair {
  from: { score: number; scores: Record<string, number> };
  to: { score: number; scores: Record<string, number> };
}

/** Two sittings compared over the students who took both: averages, who moved, and band to band. */
export function compareScores(pairs: ScorePair[]) {
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const moves = pairs.map((p) => scoreMove(p.from.score, p.to.score));
  const bands = Object.fromEntries(BAND_ORDER.map((f) => [f, Object.fromEntries(BAND_ORDER.map((t) => [t, 0]))])) as Record<Band, Record<Band, number>>;
  for (const p of pairs) bands[scoreBand(p.from.score)][scoreBand(p.to.score)]++;
  return {
    students: pairs.length,
    from: avg(pairs.map((p) => p.from.score)),
    to: avg(pairs.map((p) => p.to.score)),
    change: avg(pairs.map((p) => p.to.score - p.from.score)),
    up: moves.filter((m) => m === "up").length,
    same: moves.filter((m) => m === "same").length,
    down: moves.filter((m) => m === "down").length,
    sections: Object.fromEntries(
      ADAPTIVE_SECTIONS.map((s) => {
        const both = pairs.filter((p) => p.from.scores[s.key] != null && p.to.scores[s.key] != null);
        return [s.key, { from: avg(both.map((p) => p.from.scores[s.key]!)), to: avg(both.map((p) => p.to.scores[s.key]!)), change: avg(both.map((p) => p.to.scores[s.key]! - p.from.scores[s.key]!)) }];
      }),
    ) as Record<AptitudeTopic, { from: number | null; to: number | null; change: number | null }>,
    bands,
  };
}

/** An official score counts for this long: after a year it no longer reflects the student. */
export const OFFICIAL_SCORE_MONTHS = 12;
