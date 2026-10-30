import { describe, expect, it } from "vitest";
import { APTITUDE_TEMPLATES, estimateAbility, generateQuestion, nextLevel, nextTemplate, scaledScore, seededRandom, suggestedDrillLevel } from "../src";

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

describe("the newer aptitude topics", () => {
  it("say \"1 hour\", not \"1 hours\", and keep probabilities between 0 and 1", () => {
    for (const t of APTITUDE_TEMPLATES)
      for (let level = 1; level <= 5; level++)
        for (let seed = 1; seed <= 100; seed++) {
          const q = generateQuestion(t.id, level, seed);
          expect([q.prompt, q.explanation, ...q.options].join(" | ")).not.toMatch(/(?<![\d.])1 (hours|years|days|litres|seconds)\b/);
          if (t.id === "probability")
            for (const o of q.options) {
              const [n, d] = o.split("/").map(Number);
              expect(n! / d!, `${q.prompt} ${o}`).toBeLessThan(1);
            }
        }
  });

  it("ask data interpretation about a table, and add it up right", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const q = generateQuestion("data-interpretation", 1, seed);
      expect(q.table!.columns).toEqual(["Store", "2023", "2024", "2025"]);
      const store = q.prompt.match(/the (\w+) store/)![1];
      const row = q.table!.rows.find((r) => r[0] === store)!;
      expect(Number(q.options[q.answer])).toBe(row.slice(1).reduce((s, x) => s + Number(x), 0));
    }
    expect(generateQuestion("percentages", 1, 1).table).toBeUndefined();
  });

  it("work out blood relations along the chain", () => {
    const seen = new Map<string, string>();
    for (let seed = 1; seed <= 400; seed++) {
      const q = generateQuestion("blood-relations", 1, seed);
      seen.set(q.prompt, q.options[q.answer]!);
    }
    expect(seen.get("A is the mother of B. B is the mother of C. How is A related to C?")).toBe("Grandmother");
    expect(seen.get("A is the sister of B. B is the father of C. How is A related to C?")).toBe("Aunt");
    expect(seen.get("A is the father of B. B is the brother of C. How is A related to C?")).toBe("Father");
  });

  it("judge syllogisms by every way the groups can overlap, with each answer coming up", () => {
    const answers = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const q = generateQuestion("syllogisms", 3, seed);
      answers.set(q.options[q.answer]!, (answers.get(q.options[q.answer]!) ?? 0) + 1);
      // A conclusion that repeats or reverses an "all" premise is judged as a person would.
      const m = q.prompt.match(/^Statements: All (\w+) are (\w+)\./);
      if (m && q.prompt.includes(`I. Some ${m[2]} are ${m[1]}.`)) expect(q.options[q.answer]).toMatch(/Only conclusion I|Both/);
      if (m && q.prompt.includes(`I. All ${m[2]} are ${m[1]}.`)) expect(q.options[q.answer]).toMatch(/Only conclusion II|Neither/);
    }
    expect(answers.size).toBe(4);
    for (const n of answers.values()) expect(n).toBeGreaterThan(20);
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

  it("suggests drilling a topic one level easier when most answers are wrong, and harder when most are right", () => {
    expect(suggestedDrillLevel(30, 3)).toBe(2);
    expect(suggestedDrillLevel(60, 2.6)).toBe(3);
    expect(suggestedDrillLevel(90, 4.4)).toBe(5);
    expect(suggestedDrillLevel(0, 1)).toBe(1);
    expect(suggestedDrillLevel(100, 5)).toBe(5);
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

describe("aptitude in drive eligibility", () => {
  it("needs an official score at or above the drive's minimum", async () => {
    const { checkEligibility } = await import("../src");
    const record = { cgpa: 8, backlogs: 0, tenthPct: 90, twelfthPct: 88, graduationYear: 2027 };
    const criteria = { unitIds: [], minAptitude: 550 };
    expect(checkEligibility(criteria, record, { inUnits: true, placed: false }).reasons).toEqual(["Needs a PlayCode aptitude score from an official sitting at your college"]);
    expect(checkEligibility(criteria, record, { inUnits: true, placed: false, aptitude: 520 }).reasons).toEqual(["Needs an aptitude score of 550 or more (yours is 520)"]);
    expect(checkEligibility(criteria, record, { inUnits: true, placed: false, aptitude: 600 }).eligible).toBe(true);
    expect(checkEligibility({ unitIds: [] }, record, { inUnits: true, placed: false }).eligible).toBe(true);
  });
});
