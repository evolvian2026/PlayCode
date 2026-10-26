// Coding contests, scored the ICPC way: more problems solved ranks higher;
// ties go to the lower penalty, which is the minutes from the start to each
// accepted solution plus 20 minutes for every rejected try before it. Compile
// errors don't count as tries. In the last minutes the public scoreboard
// freezes: later submissions show as pending until the contest ends.

export const PENALTY_MINUTES = 20;

export type Verdict = "accepted" | "wrong_answer" | "runtime_error" | "time_limit" | "compile_error";

export const VERDICT_LABELS: Record<Verdict, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  runtime_error: "Runtime error",
  time_limit: "Time limit exceeded",
  compile_error: "Compile error",
};

export interface ContestSubmission {
  userId: string;
  questionId: string;
  verdict: Verdict;
  /** Milliseconds since the contest started. */
  atMs: number;
}

export interface ProblemCell {
  /** Tries counted for the penalty (compile errors excluded), up to and including the accepted one. */
  tries: number;
  /** Minute of the accepted submission, or null. */
  solvedAtMin: number | null;
  /** Submissions made after the freeze, hidden from this scoreboard. */
  pending: number;
}

export interface ScoreRow {
  userId: string;
  rank: number;
  solved: number;
  penalty: number;
  problems: Record<string, ProblemCell>;
}

/**
 * The scoreboard for the given problems. With `freezeAtMs`, submissions at or
 * after that moment are counted only as pending (the frozen public view).
 */
export function scoreboard(subs: ContestSubmission[], problemIds: string[], opts: { freezeAtMs?: number | null } = {}): ScoreRow[] {
  const freeze = opts.freezeAtMs ?? null;
  const rows = new Map<string, ScoreRow>();
  const sorted = [...subs].sort((a, b) => a.atMs - b.atMs);
  for (const s of sorted) {
    if (!problemIds.includes(s.questionId)) continue;
    const row = rows.get(s.userId) ?? rows.set(s.userId, { userId: s.userId, rank: 0, solved: 0, penalty: 0, problems: {} }).get(s.userId)!;
    const cell = (row.problems[s.questionId] ??= { tries: 0, solvedAtMin: null, pending: 0 });
    if (cell.solvedAtMin !== null) continue; // already solved: later submissions don't matter
    if (freeze !== null && s.atMs >= freeze) {
      cell.pending++;
      continue;
    }
    if (s.verdict === "compile_error") continue;
    cell.tries++;
    if (s.verdict === "accepted") {
      cell.solvedAtMin = Math.floor(s.atMs / 60_000);
      row.solved++;
      row.penalty += cell.solvedAtMin + (cell.tries - 1) * PENALTY_MINUTES;
    }
  }
  const lastSolve = (r: ScoreRow) => Math.max(-1, ...Object.values(r.problems).map((c) => c.solvedAtMin ?? -1));
  const list = [...rows.values()].sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || lastSolve(a) - lastSolve(b) || a.userId.localeCompare(b.userId));
  // Equal solved, penalty and last solve time share a rank.
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.rank = prev && prev.solved === r.solved && prev.penalty === r.penalty && lastSolve(prev) === lastSolve(r) ? prev.rank : i + 1;
  });
  return list;
}

export type ContestState = "upcoming" | "live" | "frozen" | "ended";

export function contestState(c: { startsAt: Date; endsAt: Date; freezeMinutes: number }, now: Date): ContestState {
  if (now < c.startsAt) return "upcoming";
  if (now >= c.endsAt) return "ended";
  return c.freezeMinutes > 0 && now.getTime() >= c.endsAt.getTime() - c.freezeMinutes * 60_000 ? "frozen" : "live";
}

// ---------- Contest ratings ----------

/** Everyone's contest rating starts here. */
export const CONTEST_START_RATING = 1200;
/** Ratings move faster for a student's first few rated contests. */
export const PROVISIONAL_CONTESTS = 5;

export interface RatedEntry {
  userId: string;
  rank: number;
  rating: number;
  /** Rated contests taken before this one. */
  contests: number;
}

/**
 * New ratings after a contest: each participant is compared with every other
 * as an Elo game (ahead = win, same rank = draw), and the change is the
 * average over those games, scaled by K (64 while provisional, then 32).
 */
export function contestRatingChanges(entries: RatedEntry[]): { userId: string; before: number; after: number; delta: number }[] {
  const n = entries.length;
  return entries.map((me) => {
    if (n < 2) return { userId: me.userId, before: me.rating, after: me.rating, delta: 0 };
    let sum = 0;
    for (const other of entries) {
      if (other === me) continue;
      const expected = 1 / (1 + 10 ** ((other.rating - me.rating) / 400));
      const actual = me.rank < other.rank ? 1 : me.rank === other.rank ? 0.5 : 0;
      sum += actual - expected;
    }
    const k = me.contests < PROVISIONAL_CONTESTS ? 64 : 32;
    const delta = Math.round((k * sum) / (n - 1));
    return { userId: me.userId, before: me.rating, after: me.rating + delta, delta };
  });
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
