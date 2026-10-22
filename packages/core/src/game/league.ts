// Weekly leagues: groups of up to 30 students of the same division inside an
// institution. At week end the top share promotes and the bottom share demotes.

export const DIVISIONS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type Division = (typeof DIVISIONS)[number];

export const DIVISION_LABELS: Record<Division, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

export interface LeagueRules {
  groupSize: number;
  promoteShare: number; // 7 of 30
  demoteShare: number; // 5 of 30
}

export const DEFAULT_LEAGUE_RULES: LeagueRules = { groupSize: 30, promoteShare: 7 / 30, demoteShare: 5 / 30 };

export interface LeagueMember {
  userId: string;
  division: Division;
  weeklyXp: number;
}

export type WeekResult = "promoted" | "demoted" | "stayed";

export interface WeekOutcome {
  userId: string;
  rank: number;
  weeklyXp: number;
  result: WeekResult;
  nextDivision: Division;
}

export function rankMembers<T extends { userId: string; weeklyXp: number }>(members: T[]): (T & { rank: number })[] {
  const sorted = [...members].sort((a, b) => b.weeklyXp - a.weeklyXp || a.userId.localeCompare(b.userId));
  let rank = 0;
  let prevXp: number | null = null;
  return sorted.map((m, i) => {
    if (m.weeklyXp !== prevXp) rank = i + 1;
    prevXp = m.weeklyXp;
    return { ...m, rank };
  });
}

export function zoneSizes(groupCount: number, rules: LeagueRules = DEFAULT_LEAGUE_RULES): { promote: number; demote: number } {
  if (groupCount < 4) return { promote: groupCount >= 2 ? 1 : 0, demote: 0 };
  const promote = Math.max(1, Math.round(groupCount * rules.promoteShare));
  const demote = Math.min(groupCount - promote, Math.max(1, Math.round(groupCount * rules.demoteShare)));
  return { promote, demote };
}

/** Close a week for one group (all members share a division). */
export function closeWeek(members: LeagueMember[], rules: LeagueRules = DEFAULT_LEAGUE_RULES): WeekOutcome[] {
  const ranked = rankMembers(members);
  const { promote, demote } = zoneSizes(ranked.length, rules);
  return ranked.map((m, i) => {
    const idx = DIVISIONS.indexOf(m.division);
    let result: WeekResult = "stayed";
    // Only students who actually played can promote.
    if (i < promote && m.weeklyXp > 0 && idx < DIVISIONS.length - 1) result = "promoted";
    else if (i >= ranked.length - demote && idx > 0) result = "demoted";
    const nextDivision = DIVISIONS[result === "promoted" ? idx + 1 : result === "demoted" ? idx - 1 : idx]!;
    return { userId: m.userId, rank: m.rank, weeklyXp: m.weeklyXp, result, nextDivision };
  });
}

/** Which zone a rank sits in, for showing promotion/demotion lines live. */
export function zoneForRank(rank: number, groupCount: number, division: Division, rules: LeagueRules = DEFAULT_LEAGUE_RULES): WeekResult {
  const { promote, demote } = zoneSizes(groupCount, rules);
  const idx = DIVISIONS.indexOf(division);
  if (rank <= promote && idx < DIVISIONS.length - 1) return "promoted";
  if (rank > groupCount - demote && idx > 0) return "demoted";
  return "stayed";
}
