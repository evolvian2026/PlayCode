import type { Difficulty } from "../questions";

// XP rewards getting it right, not guessing fast or farming easy questions.
// All numbers are defaults; tenants can override them via XpRules.

export interface XpRules {
  baseByDifficulty: Record<Difficulty, number>;
  firstAttemptBonus: number; // multiplier added on first-ever attempt of a question
  speedBonus: number; // multiplier added when correct and faster than half the expected time
  hintPenalty: number; // multiplier removed per hint used
  repeatFactor: number; // share of XP for a question already answered correctly before
  belowLevelFactor: number; // share of XP when the question is far below the player's rating
  belowLevelGap: number; // rating gap that counts as "far below"
  dailyRepeatCap: number; // max XP per day from repeats
}

export const DEFAULT_XP_RULES: XpRules = {
  baseByDifficulty: { 1: 10, 2: 20, 3: 40 },
  firstAttemptBonus: 0.25,
  speedBonus: 0.2,
  hintPenalty: 0.25,
  repeatFactor: 0.2,
  belowLevelFactor: 0.2,
  belowLevelGap: 300,
  dailyRepeatCap: 100,
};

export interface XpInput {
  correct: boolean;
  difficulty: Difficulty;
  firstAttempt: boolean;
  previouslyCorrect: boolean;
  hintsUsed: number;
  timeMs: number;
  expectedTimeMs: number;
  playerRating: number;
  questionRating: number;
  repeatXpToday: number;
}

export interface XpResult {
  xp: number;
  breakdown: { label: string; value: number }[];
  countsAsRepeat: boolean;
}

export function computeXp(input: XpInput, rules: XpRules = DEFAULT_XP_RULES): XpResult {
  if (!input.correct) return { xp: 0, breakdown: [], countsAsRepeat: false };
  const base = rules.baseByDifficulty[input.difficulty];
  const breakdown: { label: string; value: number }[] = [{ label: "Correct", value: base }];
  let multiplier = 1;
  if (input.firstAttempt) {
    multiplier += rules.firstAttemptBonus;
    breakdown.push({ label: "First try", value: Math.round(base * rules.firstAttemptBonus) });
  }
  if (input.hintsUsed === 0 && input.timeMs > 0 && input.timeMs < input.expectedTimeMs / 2) {
    multiplier += rules.speedBonus;
    breakdown.push({ label: "Speed", value: Math.round(base * rules.speedBonus) });
  }
  if (input.hintsUsed > 0) {
    const penalty = Math.min(1, input.hintsUsed * rules.hintPenalty);
    multiplier -= penalty;
    breakdown.push({ label: `${input.hintsUsed} hint${input.hintsUsed > 1 ? "s" : ""}`, value: -Math.round(base * penalty) });
  }
  multiplier = Math.max(0, multiplier);
  let xp = base * multiplier;

  if (input.playerRating - input.questionRating > rules.belowLevelGap) {
    xp *= rules.belowLevelFactor;
    breakdown.push({ label: "Too easy for you", value: -Math.round(base * multiplier * (1 - rules.belowLevelFactor)) });
  }
  const countsAsRepeat = input.previouslyCorrect;
  if (countsAsRepeat) {
    xp *= rules.repeatFactor;
    const room = Math.max(0, rules.dailyRepeatCap - input.repeatXpToday);
    xp = Math.min(xp, room);
    breakdown.push({ label: "Repeat", value: 0 });
  }
  return { xp: Math.round(xp), breakdown, countsAsRepeat };
}

/** Expected solve time by difficulty, used for the speed bonus. */
export function expectedTimeMs(difficulty: Difficulty): number {
  return { 1: 45_000, 2: 75_000, 3: 120_000 }[difficulty];
}

// Levels: level n starts at 50 * n * (n - 1) XP, so level 2 = 100 XP, level 10 = 4,500 XP.
export const MAX_LEVEL = 50;

export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function levelProgress(xp: number): { level: number; title: string; current: number; needed: number } {
  const level = levelForXp(xp);
  const start = xpForLevel(level);
  const next = level >= MAX_LEVEL ? start : xpForLevel(level + 1);
  return { level, title: levelTitle(level), current: xp - start, needed: next - start };
}

export function levelTitle(level: number): string {
  if (level >= 40) return "Grandmaster";
  if (level >= 30) return "Architect";
  if (level >= 20) return "Hacker";
  if (level >= 10) return "Coder";
  return "Rookie";
}
