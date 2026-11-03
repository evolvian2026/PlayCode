// The placement cell's relations with recruiters: where each company stands,
// what was said, and when to follow up; and the season's targets.

export type CompanyStage = "prospect" | "in_talks" | "confirmed" | "visited" | "not_interested";

export const COMPANY_STAGES: Record<CompanyStage, string> = {
  prospect: "To contact",
  in_talks: "In talks",
  confirmed: "Drive confirmed",
  visited: "Visited",
  not_interested: "Not this year",
};

export type InteractionKind = "call" | "email" | "meeting" | "visit" | "other";

export const INTERACTION_KINDS: Record<InteractionKind, string> = { call: "Call", email: "Email", meeting: "Meeting", visit: "Campus visit", other: "Other" };

/** "overdue", "today" or "upcoming" for a follow-up date against today (both "2026-10-29"). */
export function followUpState(on: string, today: string): "overdue" | "today" | "upcoming" {
  return on < today ? "overdue" : on === today ? "today" : "upcoming";
}

/** Where a department stands against its target: placed share of the batch, and the gap in students. */
export function targetProgress(placed: number, graduating: number, targetPct: number) {
  const placedPct = graduating ? Math.round((placed / graduating) * 1000) / 10 : 0;
  const needed = Math.max(0, Math.ceil((targetPct / 100) * graduating) - placed);
  return { placedPct, needed, met: needed === 0 && graduating > 0 };
}
