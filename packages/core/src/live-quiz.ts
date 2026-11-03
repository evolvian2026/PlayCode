// Live classroom quizzes: the teacher shows one question at a time with a
// timer; students answer on their phones. A right answer scores 500 to 1000
// points, more the faster it comes; a wrong or missing answer scores nothing.

export const LIVE_MIN_SECONDS = 10;
export const LIVE_MAX_SECONDS = 120;
export const LIVE_MAX_QUESTIONS = 30;

export type LiveStatus = "lobby" | "question" | "reveal" | "ended";

export function livePoints(correct: boolean, elapsedMs: number, limitMs: number): number {
  if (!correct || elapsedMs > limitMs) return 0;
  return Math.round(1000 - 500 * Math.max(0, elapsedMs) / limitMs);
}

/** The status players see: a question whose time is up counts as revealed. */
export function liveStatus(q: { status: LiveStatus; questionStartedAt: Date | null; secondsPerQuestion: number }, now: Date): LiveStatus {
  if (q.status === "question" && q.questionStartedAt && now.getTime() >= q.questionStartedAt.getTime() + q.secondsPerQuestion * 1000) return "reveal";
  return q.status;
}

export interface LiveScore {
  userId: string;
  score: number;
  /** When they last scored, to break ties in favour of whoever got there first. */
  lastScoredAt: number;
}

export function liveRanking<T extends LiveScore>(players: T[]): (T & { rank: number })[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.lastScoredAt - b.lastScoredAt || a.userId.localeCompare(b.userId));
  return sorted.map((p, i) => ({ ...p, rank: i > 0 && sorted[i - 1]!.score === p.score && sorted[i - 1]!.lastScoredAt === p.lastScoredAt ? i : i + 1 }));
}

/** A 6-digit join code. */
export function liveJoinCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 900_000) + 100_000);
}
