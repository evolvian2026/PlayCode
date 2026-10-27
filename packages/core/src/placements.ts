// Campus placements: who may register for a company's drive, and how
// practice on PlayCode relates to placement results.

export type CompanyType = "service" | "product" | "other";

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  service: "Service company",
  product: "Product company",
  other: "Other",
};

/** A drive's eligibility rules. Absent or null fields are not checked. */
export interface PlacementCriteria {
  /** Departments, batches or sections whose students may register (empty: everyone). */
  unitIds: string[];
  minCgpa?: number | null;
  maxBacklogs?: number | null;
  min10th?: number | null;
  min12th?: number | null;
  graduationYears?: number[] | null;
  /** Minimum attendance in placement training sessions, in percent. */
  minAttendancePct?: number | null;
  /** Students who already hold an offer may register too (dream-company drives). */
  allowPlaced?: boolean;
}

/** A student's academic record as the placement cell keeps it. */
export interface AcademicRecord {
  cgpa: number | null;
  backlogs: number | null;
  tenthPct: number | null;
  twelfthPct: number | null;
  graduationYear: number | null;
}

export interface Eligibility {
  eligible: boolean;
  /** Why not, one line per failed rule, in words a student can act on. */
  reasons: string[];
}

/**
 * `attendancePct` is the student's training attendance, or null when no
 * session has been held for them yet; a student can't fall short of training
 * that never happened.
 */
export function checkEligibility(criteria: PlacementCriteria, record: AcademicRecord | null, ctx: { inUnits: boolean; placed: boolean; attendancePct?: number | null }): Eligibility {
  const reasons: string[] = [];
  const r: AcademicRecord = record ?? { cgpa: null, backlogs: null, tenthPct: null, twelfthPct: null, graduationYear: null };
  if (!ctx.inUnits) reasons.push("Your branch or batch is not invited");
  if (criteria.graduationYears?.length) {
    if (r.graduationYear === null) reasons.push("Your graduation year is not on record");
    else if (!criteria.graduationYears.includes(r.graduationYear)) reasons.push(`Open to the ${criteria.graduationYears.join(", ")} batch only`);
  }
  if (criteria.minCgpa != null) {
    if (r.cgpa === null) reasons.push("Your CGPA is not on record");
    else if (r.cgpa < criteria.minCgpa) reasons.push(`Needs a CGPA of ${criteria.minCgpa} or more (yours is ${r.cgpa})`);
  }
  if (criteria.maxBacklogs != null) {
    if (r.backlogs === null) reasons.push("Your backlogs are not on record");
    else if (r.backlogs > criteria.maxBacklogs) reasons.push(criteria.maxBacklogs === 0 ? "Needs no active backlogs" : `Allows at most ${criteria.maxBacklogs} active backlog${criteria.maxBacklogs === 1 ? "" : "s"}`);
  }
  if (criteria.min10th != null) {
    if (r.tenthPct === null) reasons.push("Your class 10 marks are not on record");
    else if (r.tenthPct < criteria.min10th) reasons.push(`Needs ${criteria.min10th}% or more in class 10`);
  }
  if (criteria.min12th != null) {
    if (r.twelfthPct === null) reasons.push("Your class 12 or diploma marks are not on record");
    else if (r.twelfthPct < criteria.min12th) reasons.push(`Needs ${criteria.min12th}% or more in class 12 or diploma`);
  }
  if (criteria.minAttendancePct != null && ctx.attendancePct != null && ctx.attendancePct < criteria.minAttendancePct) {
    reasons.push(`Needs ${criteria.minAttendancePct}% attendance in placement training (yours is ${ctx.attendancePct}%)`);
  }
  if (ctx.placed && !criteria.allowPlaced) reasons.push("You already hold an offer, and this drive is for students without one");
  return { eligible: reasons.length === 0, reasons };
}

/**
 * How regularly a student practised before applying, from the number of days
 * with at least one answer in the 60 days before their first registration.
 */
export type EngagementBand = "regular" | "occasional" | "rare";

export const ENGAGEMENT_BANDS: { id: EngagementBand; label: string; detail: string }[] = [
  { id: "regular", label: "Practised regularly", detail: "20 or more days in the 60 days before applying" },
  { id: "occasional", label: "Practised now and then", detail: "5 to 19 days" },
  { id: "rare", label: "Rarely practised", detail: "Fewer than 5 days" },
];

export function engagementBand(activeDays: number): EngagementBand {
  if (activeDays >= 20) return "regular";
  if (activeDays >= 5) return "occasional";
  return "rare";
}

/** "₹6.5 LPA": annual CTC in rupees, in lakhs per annum. */
export function formatLpa(rupees: number): string {
  const lakhs = rupees / 100_000;
  return `₹${lakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 })} LPA`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
