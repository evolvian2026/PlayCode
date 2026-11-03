import { HI } from "./hi";
import { TA } from "./ta";

// Interface language for students: the app, and the notifications the API
// sends them. English strings are the keys; a missing Hindi or Tamil entry
// falls back to English. Code, question text and technical terms stay in
// English, as they appear in placement tests.

export type Locale = "en" | "hi" | "ta";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "ta", label: "தமிழ்" },
];

export const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.id === v);

/** For dates and numbers: Indian English, Hindi or Tamil conventions. */
export function intlLocale(locale: string): string {
  return locale === "hi" ? "hi-IN" : locale === "ta" ? "ta-IN" : "en-IN";
}

export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  const dict = locale === "hi" ? HI : locale === "ta" ? TA : null;
  let out = dict?.[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}
