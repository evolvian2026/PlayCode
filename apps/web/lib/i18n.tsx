"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { HI } from "./i18n-hi";
import { TA } from "./i18n-ta";

// Interface language for the student app. English strings are the keys;
// a missing Hindi or Tamil entry falls back to English, so screens can be
// translated one at a time. Code, question text and technical terms stay in
// English, as they appear in placement tests.

export type Locale = "en" | "hi" | "ta";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "ta", label: "தமிழ்" },
];

/** For dates and numbers: Indian English, Hindi or Tamil conventions. */
export function intlLocale(locale: string): string {
  return locale === "hi" ? "hi-IN" : locale === "ta" ? "ta-IN" : "en-IN";
}

const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.id === v);

const STORAGE_KEY = "playcode.locale";

export function storedLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : "en";
  } catch {
    return "en";
  }
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage blocked: the account setting still applies after sign-in.
  }
}

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  const dict = locale === "hi" ? HI : locale === "ta" ? TA : null;
  let out = dict?.[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    storeLocale(locale);
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useContext(LocaleContext);
  return (text, vars) => translate(locale, text, vars);
}
