// The mentor–mentee system most colleges run (and NAAC asks about): each
// student has a faculty mentor who meets them through the year. These rules
// decide who can mentor and which mentees need a mentor's attention.

import { ATTENDANCE_TARGET_PCT } from "./training";
import { daysBetween } from "./dates";
import type { Role } from "./permissions";

export const MENTOR_ROLES: readonly Role[] = ["faculty", "hod", "tpo", "inst_admin"];

export type MeetingMode = "in_person" | "call" | "online";
export const MEETING_MODES: Record<MeetingMode, string> = { in_person: "In person", call: "Phone call", online: "Video call" };

/** A mentee needs a meeting if the last one was longer ago than this. */
export const MEET_EVERY_DAYS = 60;
/** No practice for this long is worth a word. */
export const INACTIVE_DAYS = 14;

export type MenteeFlag = "no_meeting" | "follow_up_due" | "inactive" | "low_attendance" | "at_risk";

export const MENTEE_FLAGS: Record<MenteeFlag, string> = {
  no_meeting: `No meeting in ${MEET_EVERY_DAYS} days`,
  follow_up_due: "Follow-up due",
  inactive: `No practice in ${INACTIVE_DAYS} days`,
  low_attendance: `Training attendance below ${ATTENDANCE_TARGET_PCT}%`,
  at_risk: "Placement readiness at risk",
};

export interface MenteeSignals {
  today: string;
  lastMeeting: string | null;
  nextFollowUp: string | null;
  lastActive: string | null;
  attendancePct: number | null;
  /** Service-company readiness, 0-100. */
  readiness: number;
}

/** What a mentor should look at for one mentee, most pressing first. */
export function menteeFlags(s: MenteeSignals): MenteeFlag[] {
  const flags: MenteeFlag[] = [];
  if (s.nextFollowUp && s.nextFollowUp <= s.today) flags.push("follow_up_due");
  if (!s.lastMeeting || daysBetween(s.lastMeeting, s.today) > MEET_EVERY_DAYS) flags.push("no_meeting");
  if (s.readiness < 30) flags.push("at_risk");
  if (s.attendancePct !== null && s.attendancePct < ATTENDANCE_TARGET_PCT) flags.push("low_attendance");
  if (!s.lastActive || daysBetween(s.lastActive, s.today) > INACTIVE_DAYS) flags.push("inactive");
  return flags;
}

/** Split students (in roll-number order) into contiguous, near-equal blocks, one per mentor. */
export function splitIntoBlocks<T>(students: T[], mentors: number): T[][] {
  const blocks: T[][] = Array.from({ length: mentors }, () => []);
  if (mentors <= 0) return [];
  const size = Math.floor(students.length / mentors);
  let extra = students.length % mentors;
  let i = 0;
  for (const block of blocks) {
    const take = size + (extra-- > 0 ? 1 : 0);
    block.push(...students.slice(i, i + take));
    i += take;
  }
  return blocks;
}
