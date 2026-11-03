import { describe, expect, it } from "vitest";
import {
  codeSimilarity,
  duelOutcome,
  duelRatings,
  duelXp,
  outputsMatch,
  resultSetsMatch,
  riskScore,
  scoreAttempt,
  toStudentView,
  validateQuestion,
  type Question,
} from "../src";

describe("code grading helpers", () => {
  it("ignores trailing whitespace only", () => {
    expect(outputsMatch("1 2 3\n", "1 2 3   \n\n")).toBe(true);
    expect(outputsMatch("1 2 3", "1  2 3")).toBe(false);
  });
  it("compares SQL results as multisets unless ordered", () => {
    expect(resultSetsMatch([["a", 1], ["b", 2]], [["b", 2], ["a", 1]])).toBe(true);
    expect(resultSetsMatch([["a", 1], ["b", 2]], [["b", 2], ["a", 1]], true)).toBe(false);
    expect(resultSetsMatch([[1.0000001]], [[1]])).toBe(true);
    expect(resultSetsMatch([["a"]], [["a"], ["a"]])).toBe(false);
  });
  it("sees through renamed variables but not different programs", () => {
    const a = "def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n    return s\nprint(total([1, 2, 3]))";
    const renamed = "def add_all(values):\n    acc = 0  # running sum\n    for v in values:\n        acc += v\n    return acc\nprint(add_all([1, 2, 3]))";
    const different = "n = int(input())\nprint(sorted(set(map(int, input().split())))[-2] if n > 1 else -1)";
    expect(codeSimilarity(a, renamed)).toBeGreaterThan(0.9);
    expect(codeSimilarity(a, different)).toBeLessThan(0.3);
  });
});

describe("write-code questions", () => {
  const q: Question = {
    id: "c1",
    type: "write_code",
    skillId: "coding.basics",
    difficulty: 2,
    body: { stem: "Sum two numbers", language: "python", languages: ["python", "c"], starterCode: { python: "" } },
    answer: {
      kind: "tests",
      tests: [
        { input: "1 2", output: "3", hidden: false },
        { input: "5 7", output: "12", hidden: true },
      ],
    },
    explanation: "Read, add, print.",
    hints: [],
  };
  it("shows sample tests only", () => {
    const v = toStudentView(q, "s");
    expect(v.body.sampleTests).toEqual([{ input: "1 2", output: "3" }]);
    expect(JSON.stringify(v)).not.toContain("12");
    expect(v.responseKind).toBe("code");
    expect(validateQuestion(q)).toEqual([]);
  });
  it("requires hidden and sample tests", () => {
    expect(validateQuestion({ ...q, answer: { kind: "tests", tests: [{ input: "", output: "", hidden: true }] } })).toContain("needs at least one sample test");
  });
});

describe("duels", () => {
  it("decides by correct answers, then time", () => {
    expect(duelOutcome({ userId: "a", correct: 4, timeMs: 90_000 }, { userId: "b", correct: 3, timeMs: 10_000 })).toEqual({ a: "win", b: "loss" });
    expect(duelOutcome({ userId: "a", correct: 3, timeMs: 90_000 }, { userId: "b", correct: 3, timeMs: 60_000 })).toEqual({ a: "loss", b: "win" });
    expect(duelOutcome({ userId: "a", correct: 0, timeMs: 1 }, { userId: "b", correct: 0, timeMs: 2 })).toEqual({ a: "draw", b: "draw" });
  });
  it("moves Elo symmetrically and pays XP", () => {
    const r = duelRatings(1000, 1000, "win");
    expect(r).toEqual({ a: 1016, b: 984 });
    expect(duelXp("win", 4)).toBe(46);
  });
});

describe("assessments", () => {
  it("applies marks, partial credit and negative marking", () => {
    const out = scoreAttempt(
      [
        { title: "MCQ", marks: 1, negative: 0.25 },
        { title: "Coding", marks: 10, negative: 0 },
      ],
      [
        { section: 0, answered: true, score: 1 },
        { section: 0, answered: true, score: 0 },
        { section: 0, answered: false, score: 0 },
        { section: 1, answered: true, score: 0.5 },
      ],
    );
    expect(out.sections[0]).toMatchObject({ score: 0.75, max: 3, correct: 1, wrong: 1, skipped: 1 });
    expect(out.sections[1]).toMatchObject({ score: 5, max: 10 });
    expect(out).toMatchObject({ score: 5.75, max: 13 });
  });
  it("scores integrity risk with evidence weights", () => {
    expect(riskScore({})).toBe(0);
    expect(riskScore({ tab_hidden: 1 })).toBe(4);
    expect(riskScore({ tab_hidden: 3, paste: 2 })).toBe(29);
    expect(riskScore({}, 0.9)).toBe(40);
    expect(riskScore({ device_changed: 10 })).toBe(100);
  });
});
