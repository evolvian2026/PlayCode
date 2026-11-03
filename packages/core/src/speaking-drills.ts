// Speaking drills in the style of the automated English tests service
// companies use in hiring (Versant, SVAR): read a sentence aloud, or hear one
// and repeat it. Each answer is scored by how many of the sentence's words the
// browser's speech recognition heard, in order. That is a rough measure of
// clarity (if the recogniser understood the word, a listener probably would),
// not of accent, and it needs no AI.

import { wordCount } from "./speech";

export type DrillKind = "read" | "repeat";

export const DRILL_KINDS: Record<DrillKind, { label: string; detail: string }> = {
  read: { label: "Read aloud", detail: "A sentence appears. Read it aloud clearly, at a natural pace." },
  repeat: { label: "Listen and repeat", detail: "You hear a sentence once. Say it back exactly as you heard it." },
};

/** Sentences per sitting. */
export const DRILL_LENGTH = 8;

export interface DrillSentence {
  id: string;
  /** 1 short and plain, 2 everyday workplace, 3 longer with less common words. */
  level: 1 | 2 | 3;
  text: string;
}

// Workplace and campus sentences without numbers or contractions, which
// recognisers write in more than one way ("5" or "five", "don't" or "do not").
export const DRILL_SENTENCES: DrillSentence[] = [
  { id: "s01", level: 1, text: "Please close the door when you leave." },
  { id: "s02", level: 1, text: "The meeting starts after lunch." },
  { id: "s03", level: 1, text: "She sent the report this morning." },
  { id: "s04", level: 1, text: "Can you share the file with me?" },
  { id: "s05", level: 1, text: "The train was late again today." },
  { id: "s06", level: 1, text: "We need more chairs in this room." },
  { id: "s07", level: 1, text: "He works in the testing team." },
  { id: "s08", level: 1, text: "Call me back when you are free." },
  { id: "s09", level: 1, text: "The printer on this floor is not working." },
  { id: "s10", level: 1, text: "Our manager will join us later." },
  { id: "s11", level: 1, text: "I left my laptop charger at home." },
  { id: "s12", level: 1, text: "Lunch will be served in the hall." },
  { id: "s13", level: 2, text: "The client asked for a demo of the new features next week." },
  { id: "s14", level: 2, text: "Please update the ticket before you close it for the day." },
  { id: "s15", level: 2, text: "Our team fixed most of the bugs that were reported yesterday." },
  { id: "s16", level: 2, text: "The training session has been moved to the second floor." },
  { id: "s17", level: 2, text: "I would like to know more about the role and the team." },
  { id: "s18", level: 2, text: "Make sure the code is reviewed before it goes to production." },
  { id: "s19", level: 2, text: "The interview panel was impressed by her project on water quality." },
  { id: "s20", level: 2, text: "Several students asked for extra time to finish the assignment." },
  { id: "s21", level: 2, text: "The network was slow, so the online test started late." },
  { id: "s22", level: 2, text: "He explained the problem clearly and suggested a simple solution." },
  { id: "s23", level: 2, text: "Customers can now pay their bills through the mobile app." },
  { id: "s24", level: 2, text: "Remember to back up your work before installing the update." },
  { id: "s25", level: 3, text: "The company is looking for graduates who communicate clearly and learn quickly." },
  { id: "s26", level: 3, text: "Although the deadline was tight, the team delivered the project without any major issues." },
  { id: "s27", level: 3, text: "Regular feedback from customers helps us decide which features to build first." },
  { id: "s28", level: 3, text: "The security team recommends changing your password whenever you suspect a problem." },
  { id: "s29", level: 3, text: "Candidates should carry a printed copy of their resume and a valid identity card." },
  { id: "s30", level: 3, text: "Managing your time well is just as important as having strong technical skills." },
  { id: "s31", level: 3, text: "The new office building has been designed to use less electricity and water." },
  { id: "s32", level: 3, text: "Before you present your idea, think about the questions your audience might ask." },
  { id: "s33", level: 3, text: "Working with people from different backgrounds taught me to listen more carefully." },
  { id: "s34", level: 3, text: "The quarterly results show a steady increase in the number of active users." },
  { id: "s35", level: 3, text: "Please read the instructions carefully before you begin answering the questions." },
  { id: "s36", level: 3, text: "Our software automatically detects unusual activity and alerts the support team." },
];

/** Which levels each kind draws on: long sentences are read, short ones repeated. */
const LEVELS: Record<DrillKind, (1 | 2 | 3)[]> = { read: [2, 3], repeat: [1, 2] };

/** A sitting's sentences: a shuffled mix from the kind's levels, easier first. */
export function pickDrillSentences(kind: DrillKind, random: () => number = Math.random): DrillSentence[] {
  const pool = DRILL_SENTENCES.filter((s) => LEVELS[kind].includes(s.level));
  const shuffled = pool.map((s) => ({ s, r: random() })).sort((a, b) => a.r - b.r).map((x) => x.s);
  return shuffled.slice(0, DRILL_LENGTH).sort((a, b) => a.level - b.level);
}

/** Lower-case words without punctuation; hyphenated words count as two. */
export function drillWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

export interface DrillMatch {
  /** Share of the sentence's words heard, in order, 0-100. */
  accuracy: number;
  /** Each word of the sentence and whether it was heard. */
  words: { word: string; heard: boolean }[];
  /** Words heard that aren't in the sentence. */
  extra: number;
}

/** Match what was heard against the sentence, word by word in order (longest common subsequence). */
export function matchDrill(target: string, heard: string): DrillMatch {
  const a = drillWords(target);
  const b = drillWords(heard);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const matched = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      matched.add(i);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  // The display keeps the sentence's own words and punctuation.
  const shown = target.split(/\s+/);
  let k = 0;
  const words = shown.map((w) => {
    const n = drillWords(w).length;
    const heardAll = n > 0 && Array.from({ length: n }, (_, x) => matched.has(k + x)).every(Boolean);
    k += n;
    return { word: w, heard: n === 0 || heardAll };
  });
  return { accuracy: a.length ? Math.round((matched.size / a.length) * 100) : 0, words, extra: Math.max(0, b.length - matched.size) };
}

export interface DrillItemResult {
  sentenceId: string;
  heard: string;
  spokenMs: number;
  accuracy: number;
}

/** A sitting's score: mean accuracy, and for reading, words a minute across the sentences read. */
export function drillScore(kind: DrillKind, items: { heard: string; spokenMs: number; accuracy: number }[]) {
  const accuracy = items.length ? Math.round(items.reduce((s, i) => s + i.accuracy, 0) / items.length) : 0;
  const ms = items.reduce((s, i) => s + i.spokenMs, 0);
  const words = items.reduce((s, i) => s + wordCount(i.heard), 0);
  return { accuracy, wpm: kind === "read" && ms > 0 ? Math.round(words / (ms / 60_000)) : null };
}

/** How an accuracy reads, as automated tests band it. */
export function drillBand(accuracy: number): "clear" | "mostly" | "unclear" {
  return accuracy >= 85 ? "clear" : accuracy >= 60 ? "mostly" : "unclear";
}

export const DRILL_BANDS = {
  clear: "Clear: almost every word came through",
  mostly: "Mostly clear: some words were missed",
  unclear: "Hard to follow: many words were missed",
} as const;
