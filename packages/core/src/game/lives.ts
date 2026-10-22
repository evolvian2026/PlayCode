// Hearts limit careless guessing in map stages. A wrong answer costs one;
// hearts refill over time or by correctly reviewing a past mistake.

export const MAX_HEARTS = 5;
export const HEART_REFILL_MS = 30 * 60 * 1000;

export interface HeartsState {
  hearts: number;
  /** When the hearts value was last written; refill time counts from here. */
  updatedAt: Date;
}

/** Hearts available at `now`, including time-based refill. */
export function heartsAt(state: HeartsState, now: Date): HeartsState {
  if (state.hearts >= MAX_HEARTS) return { hearts: MAX_HEARTS, updatedAt: now };
  const elapsed = now.getTime() - state.updatedAt.getTime();
  const gained = Math.max(0, Math.floor(elapsed / HEART_REFILL_MS));
  if (gained === 0) return state;
  const hearts = Math.min(MAX_HEARTS, state.hearts + gained);
  // Keep the partial progress towards the next heart.
  const updatedAt = hearts >= MAX_HEARTS ? now : new Date(state.updatedAt.getTime() + gained * HEART_REFILL_MS);
  return { hearts, updatedAt };
}

export function loseHeart(state: HeartsState, now: Date): HeartsState {
  const current = heartsAt(state, now);
  if (current.hearts <= 0) return current;
  // Losing the first heart from full starts the refill clock now.
  const updatedAt = current.hearts >= MAX_HEARTS ? now : current.updatedAt;
  return { hearts: current.hearts - 1, updatedAt };
}

export function gainHeart(state: HeartsState, now: Date): HeartsState {
  const current = heartsAt(state, now);
  return { hearts: Math.min(MAX_HEARTS, current.hearts + 1), updatedAt: current.updatedAt };
}

/** Milliseconds until the next heart, or null when full. */
export function nextHeartInMs(state: HeartsState, now: Date): number | null {
  const current = heartsAt(state, now);
  if (current.hearts >= MAX_HEARTS) return null;
  return HEART_REFILL_MS - (now.getTime() - current.updatedAt.getTime());
}
