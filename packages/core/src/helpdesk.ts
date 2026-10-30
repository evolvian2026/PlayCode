// The placement helpdesk: what students ask the placement cell, and the
// corrections to their academic record they can ask for.

import type { AcademicRecord } from "./placements";

export type HelpCategory = "record" | "eligibility" | "drive" | "documents" | "other";

export const HELP_CATEGORIES: Record<HelpCategory, string> = {
  record: "My academic record is wrong",
  eligibility: "Drive eligibility",
  drive: "A drive or interview",
  documents: "Documents",
  other: "Something else",
};

export type RecordField = keyof AcademicRecord;

export const RECORD_FIELDS: Record<RecordField, { label: string; min: number; max: number; integer: boolean }> = {
  cgpa: { label: "CGPA", min: 0, max: 10, integer: false },
  backlogs: { label: "Active backlogs", min: 0, max: 60, integer: true },
  tenthPct: { label: "Class 10 %", min: 0, max: 100, integer: false },
  twelfthPct: { label: "Class 12 or diploma %", min: 0, max: 100, integer: false },
  graduationYear: { label: "Graduation year", min: 2000, max: 2100, integer: true },
};

/** Why a proposed value can't be right, or null if it could be. */
export function correctionError(field: RecordField, value: number): string | null {
  const f = RECORD_FIELDS[field];
  if (!Number.isFinite(value) || value < f.min || value > f.max) return `${f.label} must be between ${f.min} and ${f.max}`;
  if (f.integer && !Number.isInteger(value)) return `${f.label} must be a whole number`;
  return null;
}

// ---------- Projects and internships ----------

export type ResumeEntryKind = "project" | "internship" | "certification";

/** Kinds the college can verify: an internship against its letter, a certification against its credential. */
export const VERIFIABLE_KINDS: ResumeEntryKind[] = ["internship", "certification"];

/** "2026-05" style months; an entry ends after it starts, and not in the future. */
export function entryDatesError(start: string, end: string | null, thisMonth: string): string | null {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!month.test(start) || (end !== null && !month.test(end))) return "Use months like 2026-05";
  if (start > thisMonth) return "It can't start in the future";
  if (end !== null && end < start) return "It can't end before it starts";
  return null;
}

/** "May 2026 to Jul 2026", or "since May 2026" while ongoing. */
export function entryPeriod(start: string, end: string | null): string {
  const fmt = (m: string) => {
    const [y, mo] = m.split("-").map(Number) as [number, number];
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${y}`;
  };
  if (end === null) return `since ${fmt(start)}`;
  return start === end ? fmt(start) : `${fmt(start)} to ${fmt(end)}`;
}

/** A certification: "May 2026", or "May 2026, valid until Jul 2029" when it lapses. */
export function certificationPeriod(earned: string, validUntil: string | null): string {
  const one = entryPeriod(earned, earned);
  return validUntil ? `${one}, valid until ${entryPeriod(validUntil, validUntil)}` : one;
}
