import { describe, expect, it } from "vitest";
import { menteeFlags, splitIntoBlocks } from "../src";

describe("mentoring", () => {
  const ok = { today: "2026-10-27", lastMeeting: "2026-10-01", nextFollowUp: null, lastActive: "2026-10-26", attendancePct: 90, readiness: 60 };

  it("flags what a mentor should look at, most pressing first", () => {
    expect(menteeFlags(ok)).toEqual([]);
    expect(menteeFlags({ ...ok, lastMeeting: null, readiness: 20, attendancePct: 50, lastActive: "2026-10-01", nextFollowUp: "2026-10-27" })).toEqual(["follow_up_due", "no_meeting", "at_risk", "low_attendance", "inactive"]);
    expect(menteeFlags({ ...ok, lastMeeting: "2026-08-28" })).toEqual([]); // 60 days ago: still fine
    expect(menteeFlags({ ...ok, lastMeeting: "2026-08-27" })).toEqual(["no_meeting"]); // 61 days
    expect(menteeFlags({ ...ok, attendancePct: null, lastActive: null })).toEqual(["inactive"]);
  });

  it("splits students into near-equal contiguous blocks", () => {
    expect(splitIntoBlocks([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5], [6, 7]]);
    expect(splitIntoBlocks([1, 2], 3)).toEqual([[1], [2], []]);
    expect(splitIntoBlocks([1, 2], 0)).toEqual([]);
  });
});
