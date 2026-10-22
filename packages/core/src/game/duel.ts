// 1v1 duels: both players get the same short set of questions against the
// clock. More correct answers wins; on a tie the faster total time wins.

export const DUEL_QUESTIONS = 5;
export const DUEL_SECONDS = 180;
export const DUEL_COUNTDOWN_MS = 3_000;
export const DUEL_INVITE_TTL_MS = 2 * 60_000;
export const DUEL_XP = { win: 30, draw: 15, loss: 5, perCorrect: 4 } as const;
export const DUEL_DAILY_XP_LIMIT = 5; // duels per day that earn XP

export interface DuelScore {
  userId: string;
  correct: number;
  timeMs: number;
}

export type DuelOutcome = "win" | "loss" | "draw";

export function duelOutcome(a: DuelScore, b: DuelScore): { a: DuelOutcome; b: DuelOutcome } {
  if (a.correct !== b.correct) return a.correct > b.correct ? { a: "win", b: "loss" } : { a: "loss", b: "win" };
  if (a.correct === 0 || a.timeMs === b.timeMs) return { a: "draw", b: "draw" };
  return a.timeMs < b.timeMs ? { a: "win", b: "loss" } : { a: "loss", b: "win" };
}

/** Standard Elo, K = 32. */
export function duelRatings(ra: number, rb: number, outcomeA: DuelOutcome): { a: number; b: number } {
  const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
  const score = outcomeA === "win" ? 1 : outcomeA === "draw" ? 0.5 : 0;
  const delta = Math.round(32 * (score - expected));
  return { a: ra + delta, b: rb - delta };
}

export function duelXp(outcome: DuelOutcome, correct: number): number {
  return DUEL_XP[outcome] + correct * DUEL_XP.perCorrect;
}
