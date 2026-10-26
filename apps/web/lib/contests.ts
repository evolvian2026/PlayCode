import type { ContestState } from "@playcode/core";

export const STATE_LABEL: Record<ContestState, string> = { upcoming: "Starts soon", live: "Live", frozen: "Live (scoreboard frozen)", ended: "Ended" };

export interface BoardRow {
  rank: number;
  solved: number;
  penalty: number;
  problems: Record<string, { tries: number; solvedAtMin: number | null; pending: number }>;
  name: string;
  college: string | null;
  rollNo: string | null;
  me?: boolean;
}
