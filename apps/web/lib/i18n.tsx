"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { isLocale, translate, type Locale } from "@playcode/core";

// Interface language for the student app. The dictionaries and translate()
// live in @playcode/core, so the API writes notifications in the same words.
// Code, question text and technical terms stay in English, as they appear in
// placement tests.

export { intlLocale, LOCALES, translate, type Locale } from "@playcode/core";

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
