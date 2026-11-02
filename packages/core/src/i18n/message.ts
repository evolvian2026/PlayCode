import { intlLocale, translate, type Locale } from "./translate";

// A message to a student, written once in English with its values apart, so
// it can be put into the student's own language when it's sent. Values can
// be plain text and numbers, other messages (a step's label, translated
// too), lists of messages (joined with commas), or dates (written the
// student's way, in the college's time zone). What a person typed (a
// teacher's note, a circular) is sent as it is.

export interface DateVar {
  at: string;
  timeZone: string;
  /** Include the time of day, not only the date. */
  time?: boolean;
  /** Include the day of the week ("Mon"). */
  weekday?: boolean;
}

export type MsgVar = string | number | Msg | Msg[] | DateVar;

export interface Msg {
  text: string;
  vars?: Record<string, MsgVar>;
  /** Someone's own words: never translated. */
  verbatim?: boolean;
}

/** An English template with {placeholders}; the template is what gets translated. */
export const msg = (text: string, vars?: Record<string, MsgVar>): Msg => (vars ? { text, vars } : { text });

/** Someone's own words, sent as they wrote them. */
export const verbatim = (text: string): Msg => ({ text, verbatim: true });

/** A date (and time) to be written in the reader's language. */
export const at = (date: Date | string, timeZone: string, opts: { time?: boolean; weekday?: boolean } = {}): DateVar => ({
  at: typeof date === "string" ? date : date.toISOString(),
  timeZone,
  ...(opts.time ? { time: true } : {}),
  ...(opts.weekday ? { weekday: true } : {}),
});

const isDate = (v: MsgVar): v is DateVar => typeof v === "object" && v !== null && "at" in v && "timeZone" in v;

function renderVar(v: MsgVar, locale: Locale): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((m) => render(m, locale)).join(", ");
  if (isDate(v)) {
    // A plain day ("2026-11-16") is a calendar date, not an instant: no time zone shift.
    const plainDay = /^\d{4}-\d{2}-\d{2}$/.test(v.at);
    const when = plainDay ? new Date(`${v.at}T12:00:00Z`) : new Date(v.at);
    return when.toLocaleString(intlLocale(locale), {
      ...(v.weekday ? { weekday: "short" as const } : {}),
      day: "numeric",
      month: "short",
      ...(v.time && !plainDay ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone: plainDay ? "UTC" : v.timeZone,
    });
  }
  return render(v, locale);
}

/** The message in the reader's language; anything without a translation stays in English. */
export function render(m: Msg, locale: Locale): string {
  if (m.verbatim) return m.text;
  const vars = m.vars ? Object.fromEntries(Object.entries(m.vars).map(([k, v]) => [k, renderVar(v, locale)])) : undefined;
  return translate(locale, m.text, vars);
}
