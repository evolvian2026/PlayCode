import { describe, expect, it } from "vitest";
import { liveJoinCode, livePoints, liveRanking, liveStatus } from "../src";

describe("live quizzes", () => {
  it("scores right answers by speed", () => {
    expect(livePoints(true, 0, 20_000)).toBe(1000);
    expect(livePoints(true, 10_000, 20_000)).toBe(750);
    expect(livePoints(true, 20_000, 20_000)).toBe(500);
    expect(livePoints(true, 20_001, 20_000)).toBe(0); // too late
    expect(livePoints(false, 1_000, 20_000)).toBe(0);
  });

  it("closes a question when its time is up", () => {
    const q = { status: "question" as const, questionStartedAt: new Date("2026-10-26T10:00:00Z"), secondsPerQuestion: 20 };
    expect(liveStatus(q, new Date("2026-10-26T10:00:19Z"))).toBe("question");
    expect(liveStatus(q, new Date("2026-10-26T10:00:20Z"))).toBe("reveal");
    expect(liveStatus({ ...q, status: "lobby" }, new Date("2026-10-26T11:00:00Z"))).toBe("lobby");
  });

  it("ranks by score, then whoever scored first", () => {
    const ranked = liveRanking([
      { userId: "a", score: 1500, lastScoredAt: 30 },
      { userId: "b", score: 1500, lastScoredAt: 20 },
      { userId: "c", score: 900, lastScoredAt: 10 },
      { userId: "d", score: 900, lastScoredAt: 10 },
    ]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([["b", 1], ["a", 2], ["c", 3], ["d", 3]]);
    expect(liveJoinCode(() => 0)).toBe("100000");
    expect(liveJoinCode(() => 0.999999)).toMatch(/^\d{6}$/);
  });
});
