"use client";

import type { ReactNode } from "react";

export function Bar({ value, tone, label = "Progress" }: { value: number; tone?: "good" | "warn" | "bad"; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar ${tone ?? ""}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
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
  return <p className="muted">{label}...</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error spread" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          Retry
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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
