import { describe, expect, it } from "vitest";
import { JAM_TOPICS, jamDelivery } from "../src";

describe("JAM delivery", () => {
  it("measures pace, fillers and how much of the minute was used", () => {
    const talk = Array.from({ length: 140 }, (_, i) => (i % 35 === 0 ? "um" : "word")).join(" ");
    const d = jamDelivery(talk, 60_000);
    expect(d).toMatchObject({ words: 140, wpm: 140, fillers: 4, pace: "good", usedPct: 100 });
    expect(d.fillersPer100Words).toBeCloseTo(2.9, 1);
    expect(d.tips).toEqual(["Good delivery: you used the minute at a steady pace with few fillers."]);
  });

  it("says when the student stopped early, spoke slowly or filled pauses", () => {
    const d = jamDelivery("so basically um I think basically it is um good", 30_000);
    expect(d.usedPct).toBe(50);
    expect(d.pace).toBe("slow");
    expect(d.tips.join(" ")).toMatch(/stopped early/);
    expect(d.tips.join(" ")).toMatch(/filler/);
  });

  it("has topics with unique ids", () => {
    expect(new Set(JAM_TOPICS.map((t) => t.id)).size).toBe(JAM_TOPICS.length);
  });
});
