import { addDays, daysBetween, isWeekend, monthKey } from "../dates";

// One qualifying activity a day keeps the streak. Students get free streak
// freezes each month; tenants can make weekends optional.

export interface StreakState {
  current: number;
  longest: number;
  lastActiveDate: string | null;
  freezesLeft: number;
  freezesMonth: string | null;
}

export interface StreakRules {
  freezesPerMonth: number;
  weekendsOptional: boolean;
}

export const DEFAULT_STREAK_RULES: StreakRules = { freezesPerMonth: 2, weekendsOptional: false };

export const EMPTY_STREAK: StreakState = {
  current: 0,
  longest: 0,
  lastActiveDate: null,
  freezesLeft: DEFAULT_STREAK_RULES.freezesPerMonth,
  freezesMonth: null,
};

/** Days between the last activity and today that the student had to be active on. */
function missedRequiredDays(last: string, today: string, rules: StreakRules): number {
  let missed = 0;
  for (let d = addDays(last, 1); d < today; d = addDays(d, 1)) {
    if (rules.weekendsOptional && isWeekend(d)) continue;
    missed++;
  }
  return missed;
}

function refreshFreezes(state: StreakState, today: string, rules: StreakRules): StreakState {
  const month = monthKey(today);
  if (state.freezesMonth === month) return state;
  return { ...state, freezesLeft: rules.freezesPerMonth, freezesMonth: month };
}

export interface StreakUpdate {
  state: StreakState;
  extended: boolean;
  freezesUsed: number;
  broken: boolean;
}

/** Record a qualifying activity on `today`. */
export function recordActivity(prev: StreakState, today: string, rules: StreakRules = DEFAULT_STREAK_RULES): StreakUpdate {
  const state = refreshFreezes(prev, today, rules);
  if (state.lastActiveDate === today) return { state, extended: false, freezesUsed: 0, broken: false };
  if (state.lastActiveDate === null || daysBetween(state.lastActiveDate, today) < 0) {
    const next = { ...state, current: 1, longest: Math.max(state.longest, 1), lastActiveDate: today };
    return { state: next, extended: true, freezesUsed: 0, broken: false };
  }
  const missed = missedRequiredDays(state.lastActiveDate, today, rules);
  if (missed === 0 || missed <= state.freezesLeft) {
    const current = state.current + 1;
    const next = {
      ...state,
      current,
      longest: Math.max(state.longest, current),
      lastActiveDate: today,
      freezesLeft: state.freezesLeft - missed,
    };
    return { state: next, extended: true, freezesUsed: missed, broken: false };
  }
  const next = { ...state, current: 1, longest: Math.max(state.longest, 1), lastActiveDate: today };
  return { state: next, extended: true, freezesUsed: 0, broken: true };
}

/** The streak as it stands today, without recording activity (for display). */
export function currentStreak(state: StreakState, today: string, rules: StreakRules = DEFAULT_STREAK_RULES): {
  days: number;
  activeToday: boolean;
  atRisk: boolean;
} {
  if (!state.lastActiveDate) return { days: 0, activeToday: false, atRisk: false };
  if (state.lastActiveDate === today) return { days: state.current, activeToday: true, atRisk: false };
  const refreshed = refreshFreezes(state, today, rules);
  const missed = missedRequiredDays(state.lastActiveDate, today, rules);
  if (missed > refreshed.freezesLeft) return { days: 0, activeToday: false, atRisk: false };
  return { days: state.current, activeToday: false, atRisk: state.current > 0 };
}
