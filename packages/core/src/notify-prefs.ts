// What reaches a student's phone. Every notification lands in the in-app
// inbox; push and WhatsApp follow the student's choices: which kinds of
// message, and quiet hours when nothing buzzes (held until they end). The
// placement cell's messages can't be muted: missing a drive or an offer
// deadline costs too much.

export type NotifyCategory = "placements" | "tests" | "practice" | "classmates" | "answers";

export const NOTIFY_CATEGORIES: Record<NotifyCategory, { label: string; detail: string; locked?: true }> = {
  placements: { label: "Placements and your college", detail: "Drives, offers, documents, circulars and messages from staff. Always on.", locked: true },
  tests: { label: "Tests, assignments and training", detail: "Something opening, something due, a result in, a mock interview booked." },
  practice: { label: "Practice reminders", detail: "Your streak, skills to review, and your week on Sundays." },
  classmates: { label: "Classmates and contests", detail: "Duels, your squad and coding contests." },
  answers: { label: "Answers to your doubts", detail: "When a teacher answers a question you asked." },
};

export const NOTIFY_ORDER: NotifyCategory[] = ["placements", "tests", "practice", "classmates", "answers"];

/** Which category each kind of notification belongs to; anything unlisted counts as the placement cell's. */
const CATEGORY_OF: Record<string, NotifyCategory> = {
  placement: "placements",
  talent_invite: "placements",
  circular: "placements",
  announcement: "placements",
  test_open: "tests",
  assignment_due: "tests",
  class_test: "tests",
  training: "tests",
  interview_slot: "tests",
  practice_task: "tests",
  streak_at_risk: "practice",
  review_due: "practice",
  weekly_summary: "practice",
  duel_invite: "classmates",
  squad: "classmates",
  contest: "classmates",
  doubt: "answers",
};

export const notifyCategory = (template: string): NotifyCategory => CATEGORY_OF[template] ?? "placements";

export interface QuietHours {
  /** Local times, "22:00" to "07:00"; the range may cross midnight. */
  from: string;
  to: string;
}

/** Quiet unless the student says otherwise: a phone shouldn't buzz at midnight about a streak. */
export const DEFAULT_QUIET_HOURS: QuietHours = { from: "22:00", to: "07:00" };

export interface NotifyPrefs {
  whatsapp?: boolean;
  push?: boolean;
  muted?: NotifyCategory[];
  /** Absent means the default quiet hours; null means none. */
  quiet?: QuietHours | null;
}

export const quietHoursOf = (prefs: NotifyPrefs): QuietHours | null => (prefs.quiet === undefined ? DEFAULT_QUIET_HOURS : prefs.quiet);

/** Whether a kind of notification should reach the phone at all. */
export function reachesPhone(prefs: NotifyPrefs, template: string): boolean {
  const c = notifyCategory(template);
  return Boolean(NOTIFY_CATEGORIES[c].locked) || !(prefs.muted ?? []).includes(c);
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** When quiet hours end, if it's quiet now in that time zone; otherwise null. */
export function quietUntil(now: Date, timeZone: string, quiet: QuietHours | null): Date | null {
  if (!quiet || quiet.from === quiet.to) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const local = Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
  const [from, to] = [minutes(quiet.from), minutes(quiet.to)];
  const inside = from < to ? local >= from && local < to : local >= from || local < to;
  if (!inside) return null;
  const wait = (to - local + 1440) % 1440;
  const at = new Date(now.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}
