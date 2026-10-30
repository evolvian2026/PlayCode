import { describe, expect, it } from "vitest";
import { APTITUDE_TEMPLATES, estimateAbility, generateQuestion, nextLevel, nextTemplate, scaledScore, seededRandom } from "../src";

describe("generated aptitude questions", () => {
  it("always have four distinct options, one of them right, at every level", () => {
    for (const t of APTITUDE_TEMPLATES)
      for (let level = 1; level <= 5; level++)
        for (let seed = 1; seed <= 300; seed++) {
          const q = generateQuestion(t.id, level, seed);
          expect(q.options, `${t.id} L${level} #${seed}`).toHaveLength(4);
          expect(new Set(q.options).size, `${t.id} L${level} #${seed}: ${q.options}`).toBe(4);
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(q.options.join(" ")).not.toMatch(/NaN|Infinity|undefined/);
          expect(q.prompt + q.explanation).not.toMatch(/NaN|Infinity|undefined/);
        }
  });

  it("rebuild the same from the same seed, and differ across seeds", () => {
    expect(generateQuestion("trains", 3, 42)).toEqual(generateQuestion("trains", 3, 42));
    const prompts = new Set(Array.from({ length: 30 }, (_, i) => generateQuestion("percentages", 1, i).prompt));
    expect(prompts.size).toBeGreaterThan(15);
  });

  it("work out the right answer", () => {
    const q = generateQuestion("time-work", 1, 7);
    const [, a, b] = q.prompt.match(/in (\d+) days and B in (\d+) days/)!.map(Number);
    expect(q.options[q.answer]).toBe(`${(a! * b!) / (a! + b!)} days`);
    const s = generateQuestion("number-series", 1, 3);
    const xs = s.prompt.match(/-?\d+/g)!.map(Number);
    expect(Number(s.options[s.answer])).toBe(xs[4]! + (xs[4]! - xs[3]!));
  });
});

describe("adaptive scoring", () => {
  it("raises the estimate with right answers on harder questions, and lowers it with wrong ones", () => {
    expect(estimateAbility([]).theta).toBe(0);
    const strong = estimateAbility([3, 4, 5, 5, 5, 5].map((level) => ({ level, correct: true })));
    const weak = estimateAbility([3, 2, 1, 1, 1, 1].map((level) => ({ level, correct: false })));
    expect(strong.theta).toBeGreaterThan(1.5);
    expect(weak.theta).toBeLessThan(-1.5);
    expect(estimateAbility([{ level: 3, correct: true }]).se).toBeGreaterThan(strong.se);
    expect(nextLevel(strong.theta)).toBe(5);
    expect(nextLevel(weak.theta)).toBe(1);
    expect(nextLevel(0)).toBe(3);
  });

  it("scores 100 to 900, and spreads questions across the section's templates", () => {
    expect(scaledScore(0)).toBe(500);
    expect(scaledScore(9)).toBe(900);
    expect(scaledScore(-9)).toBe(100);
    const r = seededRandom(1);
    const asked: string[] = [];
    for (let i = 0; i < 8; i++) asked.push(nextTemplate("quant", asked, r));
    expect(new Set(asked).size).toBe(8);
  });
});
