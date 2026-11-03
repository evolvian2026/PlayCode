"use client";

import type { ReactNode } from "react";
import { intlLocale, useLocale, useT } from "@/lib/i18n";

export function Bar({ value, tone, label = "Progress" }: { value: number; tone?: "good" | "warn" | "bad"; label?: string }) {
  const t = useT();
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar ${tone ?? ""}`} role="progressbar" aria-label={t(label)} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function masteryTone(v: number): "good" | "warn" | "bad" | undefined {
  if (v >= 70) return "good";
  if (v >= 40) return undefined;
  if (v >= 20) return "warn";
  return "bad";
}

export function Loading({ label = "Loading" }: { label?: string }) {
  const t = useT();
  return <p className="muted">{t(label)}...</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error spread" role="alert">
      {/* Messages from the API arrive in English; the common ones have translations. */}
      <span>{t(message)}</span>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          {t("Retry")}
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="muted small">{label}</div>
      <div className="kpi">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "5 minutes ago", "yesterday", in the reader's language. */
export function relativeTime(iso: string, intl: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: "auto" });
  const min = Math.round(ms / 60_000);
  if (Math.abs(min) < 60) return rtf.format(Math.min(-1, min), "minute");
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}

/**
 * Dates on student screens, in the student's language: "5 minutes ago",
 * "24 Oct, 2:30 pm", "24 Oct". (timeAgo and formatDate are for the console,
 * which is in English.)
 */
export function useDates() {
  const locale = useLocale();
  const t = useT();
  const intl = intlLocale(locale);
  return {
    ago: (iso: string | null) => (iso ? relativeTime(iso, intl) : t("never")),
    when: (iso: string) => new Date(iso).toLocaleString(intl, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
    day: (iso: string) => new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" }),
  };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
