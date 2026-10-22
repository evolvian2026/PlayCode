// Proctored assessments: section marking with negative marks, and an
// integrity risk score from client-reported signals. Proctors see the score
// with its evidence; nothing here disqualifies anyone automatically.

export const INTEGRITY_EVENT_TYPES = [
  "tab_hidden",
  "focus_lost",
  "fullscreen_exit",
  "paste",
  "copy",
  "multiple_faces",
  "no_face",
  "device_changed",
] as const;
export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];

const RISK_WEIGHTS: Record<IntegrityEventType, number> = {
  tab_hidden: 8,
  focus_lost: 4,
  fullscreen_exit: 8,
  paste: 6,
  copy: 3,
  multiple_faces: 20,
  no_face: 10,
  device_changed: 25,
};

export function riskScore(counts: Partial<Record<IntegrityEventType, number>>, maxSimilarity = 0): number {
  let score = 0;
  for (const [type, n] of Object.entries(counts) as [IntegrityEventType, number][]) {
    // The first occurrence of most signals is often accidental, so it counts half.
    score += (RISK_WEIGHTS[type] ?? 0) * Math.max(0, n - 0.5);
  }
  if (maxSimilarity >= 0.85) score += 40;
  else if (maxSimilarity >= 0.7) score += 20;
  return Math.min(100, Math.round(score));
}

export interface SectionSpec {
  title: string;
  marks: number; // per correct answer
  negative: number; // deducted per wrong answer (0 for none)
}

export interface QuestionResult {
  section: number;
  answered: boolean;
  /** 0-1; code questions can earn partial credit from passed tests. */
  score: number;
}

export function scoreAttempt(sections: SectionSpec[], results: QuestionResult[]) {
  const bySection = sections.map((s) => ({ title: s.title, score: 0, max: 0, correct: 0, wrong: 0, skipped: 0 }));
  for (const r of results) {
    const spec = sections[r.section];
    const out = bySection[r.section];
    if (!spec || !out) continue;
    out.max += spec.marks;
    if (!r.answered) out.skipped++;
    else if (r.score >= 1) {
      out.correct++;
      out.score += spec.marks;
    } else if (r.score > 0) {
      out.score += spec.marks * r.score;
    } else {
      out.wrong++;
      out.score -= spec.negative;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const s of bySection) s.score = round(s.score);
  return {
    sections: bySection,
    score: round(bySection.reduce((a, s) => a + s.score, 0)),
    max: bySection.reduce((a, s) => a + s.max, 0),
  };
}
