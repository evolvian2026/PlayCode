import type { Difficulty } from "./questions";

// Self-serve mock tests on the pattern of company online tests: sections in a
// fixed order, each with its own timer, and no going back to a closed section.
// The clock never stops: a student who leaves mid-section comes back to find
// the sections that ran out in the meantime closed, as in a real test centre.

export type MockPatternId = "service" | "product";

export interface MockSectionSpec {
  title: string;
  minutes: number;
  /** Quick questions (multiple choice and the like), or coding problems. */
  kind: "quick" | "coding";
  /** Topics to draw from: the part of a skill id before the dot. */
  topics: string[];
  count: number;
  maxDifficulty?: Difficulty;
  /** Marks per question; coding earns a share of them for each test passed. */
  marks: number;
  /** The percentage to aim for; sections below it are what to practise next. */
  target: number;
}

export interface MockPattern {
  id: MockPatternId;
  name: string;
  description: string;
  sections: MockSectionSpec[];
}

export const MOCK_PATTERNS: MockPattern[] = [
  {
    id: "service",
    name: "Service-company pattern",
    description: "Aptitude, reasoning, verbal ability, programming logic and one coding problem, like the online tests of mass recruiters.",
    sections: [
      { title: "Quantitative aptitude", minutes: 10, kind: "quick", topics: ["aptitude"], count: 6, marks: 1, target: 60 },
      { title: "Logical reasoning", minutes: 8, kind: "quick", topics: ["reasoning"], count: 5, marks: 1, target: 60 },
      { title: "Verbal ability", minutes: 8, kind: "quick", topics: ["verbal"], count: 6, marks: 1, target: 60 },
      { title: "Programming logic", minutes: 9, kind: "quick", topics: ["pseudocode", "basics", "loops", "conditionals", "functions"], count: 6, marks: 1, target: 60 },
      { title: "Hands-on coding", minutes: 25, kind: "coding", topics: ["coding"], count: 1, maxDifficulty: 2, marks: 5, target: 50 },
    ],
  },
  {
    id: "product",
    name: "Product-company pattern",
    description: "CS fundamentals, programming concepts and two coding problems, like the first round at product companies.",
    sections: [
      { title: "CS fundamentals", minutes: 10, kind: "quick", topics: ["dbms", "os", "networks"], count: 8, marks: 1, target: 60 },
      { title: "Programming concepts", minutes: 12, kind: "quick", topics: ["arrays", "strings", "recursion", "complexity", "oop", "pointers"], count: 8, marks: 1, target: 60 },
      { title: "Coding", minutes: 45, kind: "coding", topics: ["coding"], count: 2, marks: 10, target: 50 },
    ],
  },
];

export function mockPattern(id: string): MockPattern | undefined {
  return MOCK_PATTERNS.find((p) => p.id === id);
}

export const mockMinutes = (p: MockPattern) => p.sections.reduce((n, s) => n + s.minutes, 0);

/**
 * Where an attempt stands at `now`. Sections whose time ran out are closed and
 * the next one's timer starts from when the last one ended, not from now.
 */
export function sectionClock(sections: { minutes: number }[], current: number, deadline: Date, now: Date) {
  let section = current;
  let end = deadline;
  while (section < sections.length && end.getTime() <= now.getTime()) {
    section++;
    if (section < sections.length) end = new Date(end.getTime() + sections[section]!.minutes * 60_000);
  }
  return { section, deadline: end, finished: section >= sections.length };
}

/** Percentiles appear only once enough students have taken the same pattern. */
export const MOCK_PERCENTILE_MIN = 20;

/** Share of attempts scoring below `mine` (ties count half), 0-100; null with too few attempts to compare. */
export function percentile(scores: number[], mine: number): number | null {
  if (scores.length < MOCK_PERCENTILE_MIN) return null;
  const below = scores.filter((s) => s < mine).length;
  const equal = scores.filter((s) => s === mine).length;
  return Math.round(((below + equal / 2) / scores.length) * 100);
}

/** Sections under their target, furthest below first: what to practise next. */
export function mockFocus(pattern: MockPattern, sections: { score: number; max: number }[]) {
  return pattern.sections
    .map((spec, i) => {
      const s = sections[i];
      const pct = s && s.max > 0 ? Math.round((Math.max(0, s.score) / s.max) * 100) : 0;
      return { section: i, title: spec.title, pct, target: spec.target, gap: spec.target - pct };
    })
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .map(({ gap: _gap, ...x }) => x);
}
