// Delivery in spoken mock interviews: pace and filler words, measured from the
// browser's transcript of each answer and how long the student spoke. These are
// rough signals (transcripts drop some fillers), shown as coaching, not scored
// on their own.

/** Fillers counted in answers. Whole words or phrases, case-insensitive. */
export const FILLERS = ["um", "umm", "uh", "uhh", "er", "erm", "hmm", "basically", "actually", "you know", "i mean", "kind of", "sort of"] as const;

/** Comfortable interview pace, words per minute. */
export const PACE_RANGE = { min: 110, max: 170 } as const;

export interface SpokenAnswer {
  words: number;
  durationMs: number;
  fillers: number;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function countFillers(text: string): number {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ")} `;
  let n = 0;
  for (const f of FILLERS) {
    let i = lower.indexOf(` ${f} `);
    while (i !== -1) {
      n++;
      i = lower.indexOf(` ${f} `, i + f.length + 1);
    }
  }
  return n;
}

export function spokenAnswer(text: string, durationMs: number): SpokenAnswer & { wpm: number } {
  const words = wordCount(text);
  return { words, durationMs, fillers: countFillers(text), wpm: durationMs > 0 ? Math.round(words / (durationMs / 60_000)) : 0 };
}

export interface Delivery {
  spokenAnswers: number;
  wordsPerMinute: number;
  fillersPer100Words: number;
  pace: "slow" | "good" | "fast";
  tips: string[];
}

/** Overall delivery across the spoken answers, or null if none were spoken. */
export function deliverySummary(answers: SpokenAnswer[]): Delivery | null {
  const spoken = answers.filter((a) => a.durationMs > 0 && a.words > 0);
  if (spoken.length === 0) return null;
  const words = spoken.reduce((s, a) => s + a.words, 0);
  const minutes = spoken.reduce((s, a) => s + a.durationMs, 0) / 60_000;
  const fillers = spoken.reduce((s, a) => s + a.fillers, 0);
  const wordsPerMinute = Math.round(words / minutes);
  const fillersPer100Words = Math.round((fillers / words) * 1000) / 10;
  const pace = wordsPerMinute < PACE_RANGE.min ? "slow" : wordsPerMinute > PACE_RANGE.max ? "fast" : "good";
  const tips: string[] = [];
  if (pace === "slow") tips.push("Your pace was slow. Think first, then answer in full sentences without long pauses.");
  if (pace === "fast") tips.push("You spoke fast. Slow down so the interviewer can follow your reasoning.");
  if (fillersPer100Words >= 3) tips.push("Cut filler words (um, basically, actually). A short pause sounds more confident.");
  if (words / spoken.length < 25) tips.push("Your answers were short. Explain your reasoning, not just the result.");
  if (tips.length === 0) tips.push("Clear delivery: steady pace and few fillers.");
  return { spokenAnswers: spoken.length, wordsPerMinute, fillersPer100Words, pace, tips };
}
