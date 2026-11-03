import type { StudentResponse } from "@playcode/core";
import type { Locale } from "./i18n";
import type { QuestionView } from "./types";

// The downloaded offline pack and the answers given to it, kept in this
// browser until they sync. The pack holds questions only, never answers.

export interface OfflinePack {
  id: string;
  issuedAt: string;
  expiresAt: string;
  questions: Omit<QuestionView, "hintsUsed" | "coachUsed">[];
}

export interface OfflineAnswer {
  questionId: string;
  response: StudentResponse;
  answeredAt: string;
  timeMs: number;
}

export interface StoredPack {
  pack: OfflinePack;
  answers: Record<string, OfflineAnswer>;
  locale: Locale;
}

const KEY = "playcode.offline";

export function loadStoredPack(): StoredPack | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredPack) : null;
  } catch {
    return null;
  }
}

export function saveStoredPack(p: StoredPack | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full or blocked: the pack lives only in memory this time.
  }
}

/** Answers waiting to sync, for a reminder elsewhere in the app. */
export function unsyncedAnswers(): number {
  const p = loadStoredPack();
  return p ? Object.keys(p.answers).length : 0;
}
