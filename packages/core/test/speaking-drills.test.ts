import { describe, expect, it } from "vitest";
import { DRILL_LENGTH, DRILL_SENTENCES, drillBand, drillScore, matchDrill, pickDrillSentences } from "../src";

describe("speaking drills", () => {
  it("count the sentence's words heard in order, ignoring case and punctuation", () => {
    expect(matchDrill("Can you share the file with me?", "can you share the file with me").accuracy).toBe(100);
    const m = matchDrill("The client asked for a demo of the new features next week.", "the client asked for demo of new features next weak");
    expect(m.accuracy).toBe(75); // "a", "the" and "week" missed out of 12
    expect(m.words.filter((w) => !w.heard).map((w) => w.word)).toEqual(["a", "the", "week."]);
    expect(m.extra).toBe(1); // "weak"
    // Words out of order only count once in order.
    expect(matchDrill("Lunch will be served in the hall.", "in the hall lunch will be served").accuracy).toBe(57);
    expect(matchDrill("Call me back when you are free.", "").accuracy).toBe(0);
  });

  it("score a sitting and band it", () => {
    const items = [
      { heard: "one two three four five six seven eight nine ten", spokenMs: 5000, accuracy: 100 },
      { heard: "one two three four five", spokenMs: 2500, accuracy: 70 },
    ];
    expect(drillScore("read", items)).toEqual({ accuracy: 85, wpm: 120 });
    expect(drillScore("repeat", items).wpm).toBeNull();
    expect([drillBand(90), drillBand(70), drillBand(40)]).toEqual(["clear", "mostly", "unclear"]);
  });

  it("pick a sitting from the kind's levels, easier first", () => {
    const read = pickDrillSentences("read");
    expect(read).toHaveLength(DRILL_LENGTH);
    expect(read.every((s) => s.level >= 2)).toBe(true);
    expect(read.map((s) => s.level)).toEqual([...read.map((s) => s.level)].sort());
    expect(pickDrillSentences("repeat").every((s) => s.level <= 2)).toBe(true);
    expect(new Set(DRILL_SENTENCES.map((s) => s.id)).size).toBe(DRILL_SENTENCES.length);
    // No digits or contractions, which recognisers write in more than one way.
    expect(DRILL_SENTENCES.filter((s) => /\d|'/.test(s.text))).toEqual([]);
  });
});
