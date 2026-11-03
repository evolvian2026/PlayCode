import { describe, expect, it } from "vitest";
import { countFillers, deliverySummary, spokenAnswer, wordCount } from "../src";

describe("spoken answer delivery", () => {
  it("counts words and fillers as whole words and phrases", () => {
    expect(wordCount("  a binary   search halves the range ")).toBe(6);
    expect(countFillers("Um, so basically, you know, I would uh use a hash map. Umbrella actually.")).toBe(5);
    expect(countFillers("The user enters a number")).toBe(0); // "er" inside words doesn't count
  });

  it("measures pace", () => {
    expect(spokenAnswer("one two three four five six seven eight nine ten", 4000)).toMatchObject({ words: 10, wpm: 150, fillers: 0 });
  });

  it("summarises delivery with tips", () => {
    const words = (n: number, filler = "") => `${filler} ${Array.from({ length: n }, () => "word").join(" ")}`;
    const good = deliverySummary([spokenAnswer(words(70), 30_000), spokenAnswer(words(70), 30_000)]);
    expect(good).toMatchObject({ spokenAnswers: 2, wordsPerMinute: 140, pace: "good", tips: ["Clear delivery: steady pace and few fillers."] });
    const rushed = deliverySummary([spokenAnswer(words(20, "um uh basically"), 5_000)])!;
    expect(rushed.pace).toBe("fast");
    expect(rushed.fillersPer100Words).toBeGreaterThan(3);
    expect(rushed.tips).toHaveLength(3);
    expect(deliverySummary([])).toBeNull();
    expect(deliverySummary([{ words: 0, durationMs: 0, fillers: 0 }])).toBeNull();
  });
});
