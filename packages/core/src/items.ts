// Item analysis for the question bank: how hard each question really is,
// whether stronger students do better on it than weaker ones (discrimination),
// and signs that its answer key may be wrong. Uses each student's first
// attempt, and their accuracy elsewhere in the bank as their ability.

/** Fewer first attempts than this and the numbers say nothing. */
export const MIN_ITEM_ATTEMPTS = 30;
/** Share of students in the upper and lower groups (the classical 27%). */
const GROUP = 0.27;

export interface ItemAttempt {
  userId: string;
  correct: boolean;
  /** For multiple-choice questions, the option chosen. */
  optionId?: string | null;
}

export interface ItemStats {
  attempts: number;
  /** Share answering correctly, 0-1 (the item's "p-value"). */
  pValue: number;
  /** Upper-group minus lower-group accuracy, -1 to 1; null below the minimum attempts. */
  discrimination: number | null;
  /** The option most chosen by the upper group, when it isn't the keyed one. */
  upperGroupFavourite: string | null;
}

export function itemStats(attempts: ItemAttempt[], ability: Map<string, number>, correctOptionId?: string | null): ItemStats {
  const n = attempts.length;
  const pValue = n ? attempts.filter((a) => a.correct).length / n : 0;
  if (n < MIN_ITEM_ATTEMPTS) return { attempts: n, pValue, discrimination: null, upperGroupFavourite: null };
  const ranked = [...attempts].sort((a, b) => (ability.get(b.userId) ?? 0) - (ability.get(a.userId) ?? 0));
  const k = Math.max(1, Math.round(n * GROUP));
  const upper = ranked.slice(0, k);
  const lower = ranked.slice(-k);
  const share = (g: ItemAttempt[]) => g.filter((a) => a.correct).length / g.length;
  let favourite: string | null = null;
  if (correctOptionId) {
    const counts = new Map<string, number>();
    for (const a of upper) if (a.optionId) counts.set(a.optionId, (counts.get(a.optionId) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] !== correctOptionId && top[1] > (counts.get(correctOptionId) ?? 0)) favourite = top[0];
  }
  return { attempts: n, pValue, discrimination: Math.round((share(upper) - share(lower)) * 100) / 100, upperGroupFavourite: favourite };
}

export type ItemFlag = "key_suspect" | "negative_discrimination" | "low_discrimination" | "too_hard" | "too_easy" | "reported";

export const ITEM_FLAG_LABELS: Record<ItemFlag, string> = {
  key_suspect: "Strong students mostly pick another option: check the answer key",
  negative_discrimination: "Weaker students do better than stronger ones: likely a flaw",
  low_discrimination: "Doesn't separate strong from weak students",
  too_hard: "Fewer than 20% get it right",
  too_easy: "Marked medium or hard, but over 95% get it right",
  reported: "Reported by students",
};

/** Most serious first. */
export function itemFlags(s: ItemStats, meta: { difficulty: 1 | 2 | 3; openReports: number }): ItemFlag[] {
  const flags: ItemFlag[] = [];
  if (s.upperGroupFavourite) flags.push("key_suspect");
  if (s.discrimination !== null) {
    if (s.discrimination < 0) flags.push("negative_discrimination");
    else if (s.discrimination < 0.1) flags.push("low_discrimination");
  }
  if (s.attempts >= MIN_ITEM_ATTEMPTS) {
    if (s.pValue < 0.2) flags.push("too_hard");
    if (s.pValue > 0.95 && meta.difficulty >= 2) flags.push("too_easy");
  }
  if (meta.openReports > 0) flags.push("reported");
  return flags;
}
