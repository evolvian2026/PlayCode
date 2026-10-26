import { describe, expect, it } from "vitest";
import { contestState, scoreboard, type ContestSubmission } from "../src";

const min = (m: number) => m * 60_000;
const sub = (userId: string, questionId: string, verdict: ContestSubmission["verdict"], atMin: number): ContestSubmission => ({ userId, questionId, verdict, atMs: min(atMin) });

describe("contest scoreboard", () => {
  const subs = [
    sub("ana", "p1", "wrong_answer", 5),
    sub("ana", "p1", "compile_error", 8), // not a try
    sub("ana", "p1", "accepted", 12), // 12 + 20 = 32
    sub("ana", "p2", "accepted", 50), // 50
    sub("ana", "p2", "wrong_answer", 55), // after solving: ignored
    sub("ben", "p1", "accepted", 20),
    sub("ben", "p2", "accepted", 40), // 60, less than ana's 82
    sub("cai", "p2", "time_limit", 30),
    sub("cai", "p3", "accepted", 10), // not a contest problem
  ];

  it("ranks by solved, then penalty with 20 minutes per rejected try", () => {
    const board = scoreboard(subs, ["p1", "p2"]);
    expect(board.map((r) => [r.userId, r.rank, r.solved, r.penalty])).toEqual([
      ["ben", 1, 2, 60],
      ["ana", 2, 2, 82],
      ["cai", 3, 0, 0],
    ]);
    expect(board[1]!.problems.p1).toEqual({ tries: 2, solvedAtMin: 12, pending: 0 });
    expect(board[2]!.problems.p2).toEqual({ tries: 1, solvedAtMin: null, pending: 0 });
  });

  it("hides submissions after the freeze as pending", () => {
    const board = scoreboard(subs, ["p1", "p2"], { freezeAtMs: min(45) });
    const ana = board.find((r) => r.userId === "ana")!;
    expect(ana).toMatchObject({ solved: 1, penalty: 32 });
    expect(ana.problems.p2).toEqual({ tries: 0, solvedAtMin: null, pending: 2 });
    expect(board[0]!.userId).toBe("ben"); // ben's 40-minute solve was before the freeze
  });

  it("shares a rank on a full tie", () => {
    const board = scoreboard([sub("x", "p1", "accepted", 10), sub("y", "p1", "accepted", 10), sub("z", "p1", "accepted", 11)], ["p1"]);
    expect(board.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("knows when it is live, frozen and over", () => {
    const c = { startsAt: new Date("2026-10-26T10:00:00Z"), endsAt: new Date("2026-10-26T12:00:00Z"), freezeMinutes: 30 };
    expect(contestState(c, new Date("2026-10-26T09:59:00Z"))).toBe("upcoming");
    expect(contestState(c, new Date("2026-10-26T11:00:00Z"))).toBe("live");
    expect(contestState(c, new Date("2026-10-26T11:30:00Z"))).toBe("frozen");
    expect(contestState(c, new Date("2026-10-26T12:00:00Z"))).toBe("ended");
    expect(contestState({ ...c, freezeMinutes: 0 }, new Date("2026-10-26T11:59:00Z"))).toBe("live");
  });
});
