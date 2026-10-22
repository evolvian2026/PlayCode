// Skill mastery uses an Elo-style rating per student per skill, played
// against each question's own rating. The same update calibrates questions.

export const START_RATING = 1000;

export function expectedScore(playerRating: number, questionRating: number): number {
  return 1 / (1 + 10 ** ((questionRating - playerRating) / 400));
}

/** Larger steps while a student has few attempts on a skill, so early ratings settle fast. */
export function kFactor(attempts: number): number {
  if (attempts < 10) return 48;
  if (attempts < 30) return 32;
  return 20;
}

export function updateRatings(
  player: { rating: number; attempts: number },
  question: { rating: number; attempts: number },
  correct: boolean,
): { playerRating: number; questionRating: number } {
  const expected = expectedScore(player.rating, question.rating);
  const score = correct ? 1 : 0;
  const playerRating = player.rating + kFactor(player.attempts) * (score - expected);
  // Questions move slower so one student cannot swing an item.
  const questionRating = question.rating - Math.min(16, kFactor(question.attempts) / 3) * (score - expected);
  return { playerRating: Math.round(playerRating), questionRating: Math.round(questionRating) };
}

/** Map a rating to 0-100 mastery: 600 or less = 0, 1800 or more = 100. */
export function masteryFromRating(rating: number): number {
  return Math.max(0, Math.min(100, Math.round((rating - 600) / 12)));
}

/** Authored difficulty seeds a question's starting rating. */
export function initialQuestionRating(difficulty: 1 | 2 | 3): number {
  return { 1: 850, 2: 1050, 3: 1300 }[difficulty];
}
