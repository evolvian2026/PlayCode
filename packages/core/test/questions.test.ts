import { describe, expect, it } from "vitest";
import { describeAnswer, grade, toStudentView, validateQuestion, type Answer, type Question } from "../src";

const mcq: Question = {
  id: "q1",
  type: "predict_output",
  skillId: "loops.nested",
  difficulty: 2,
  body: {
    stem: "What does this print?",
    code: "for i in range(3):\n    print(i, end='')",
    language: "python",
    options: [
      { id: "a", text: "012" },
      { id: "b", text: "123" },
      { id: "c", text: "0123" },
    ],
  },
  answer: { kind: "option", optionId: "a" },
  explanation: "range(3) is 0, 1, 2.",
  hints: ["range stops before 3"],
};

const parsons: Question = {
  id: "q2",
  type: "parsons",
  skillId: "functions.basics",
  difficulty: 1,
  body: {
    stem: "Build a function that returns the sum of a list.",
    language: "python",
    lines: [
      { id: "l1", text: "def total(xs):" },
      { id: "l2", text: "    s = 0" },
      { id: "l3", text: "    for x in xs: s += x" },
      { id: "l4", text: "    return s" },
      { id: "d1", text: "    return 0" },
    ],
  },
  answer: { kind: "order", orders: [["l1", "l2", "l3", "l4"]] },
  explanation: "Initialise, accumulate, return.",
  hints: [],
};

describe("grade", () => {
  it("grades options", () => {
    expect(grade(mcq.answer, { kind: "option", optionId: "a" })).toBe(true);
    expect(grade(mcq.answer, { kind: "option", optionId: "b" })).toBe(false);
    expect(grade(mcq.answer, { kind: "text", value: "a" })).toBe(false);
  });

  it("normalises text answers", () => {
    const answer: Answer & { kind: "text" } = { kind: "text", accepted: ["Hello World"] };
    expect(grade(answer, { kind: "text", value: "  hello   world " })).toBe(true);
    expect(grade({ ...answer, caseSensitive: true }, { kind: "text", value: "hello world" })).toBe(false);
  });

  it("grades bug lines as a set", () => {
    const answer: Answer = { kind: "lines", lines: [3, 5] };
    expect(grade(answer, { kind: "lines", lines: [5, 3] })).toBe(true);
    expect(grade(answer, { kind: "lines", lines: [3] })).toBe(false);
    expect(grade(answer, { kind: "lines", lines: [3, 5, 6] })).toBe(false);
  });

  it("accepts any valid parsons order", () => {
    const answer: Answer = { kind: "order", orders: [["a", "b", "c"], ["b", "a", "c"]] };
    expect(grade(answer, { kind: "order", ids: ["b", "a", "c"] })).toBe(true);
    expect(grade(answer, { kind: "order", ids: ["a", "b"] })).toBe(false);
    expect(grade(answer, { kind: "order", ids: ["c", "a", "b"] })).toBe(false);
  });
});

describe("toStudentView", () => {
  it("strips the answer and shuffles deterministically", () => {
    const v1 = toStudentView(mcq, "session-1");
    const v2 = toStudentView(mcq, "session-1");
    expect(v1).toEqual(v2);
    expect(JSON.stringify(v1)).not.toContain("explanation");
    expect(v1).not.toHaveProperty("answer");
    expect(v1.body.options?.map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
    expect(v1.responseKind).toBe("option");
  });

  it("never hands out a solved parsons puzzle", () => {
    for (let i = 0; i < 200; i++) {
      const v = toStudentView(parsons, `s${i}`);
      const ids = v.body.lines!.map((l) => l.id);
      expect(grade(parsons.answer, { kind: "order", ids: ids.filter((id) => id !== "d1") })).toBe(false);
      expect(ids.sort()).toEqual(["d1", "l1", "l2", "l3", "l4"]);
    }
  });
});

describe("validateQuestion", () => {
  it("accepts valid questions", () => {
    expect(validateQuestion(mcq)).toEqual([]);
    expect(validateQuestion(parsons)).toEqual([]);
  });

  it("catches broken questions", () => {
    expect(validateQuestion({ ...mcq, answer: { kind: "option", optionId: "z" } })).toContain("answer option z not in options");
    expect(validateQuestion({ ...mcq, answer: { kind: "lines", lines: [1] } })).toContain("answer kind lines not allowed for predict_output");
    expect(validateQuestion({ ...parsons, answer: { kind: "order", orders: [["l1", "zz"]] } })).toContain("order references unknown line");
  });
});

describe("describeAnswer", () => {
  it("renders the correct answer for display", () => {
    expect(describeAnswer(mcq)).toBe("012");
    expect(describeAnswer(parsons)).toBe("def total(xs):\n    s = 0\n    for x in xs: s += x\n    return s");
  });
});
