import { describe, expect, it } from "vitest";
import { checklistProgress, trainingPriorities } from "../src/checklist";

describe("readiness checklist", () => {
  it("counts only the items that apply", () => {
    expect(checklistProgress({ record: true, profile: false, documents: null, mock_interview: true, practice: false, training: null })).toEqual({ done: 2, total: 4, missing: ["profile", "practice"] });
  });
});

describe("training priorities", () => {
  it("puts the weakest first and flags what's below 3.5", () => {
    const p = trainingPriorities({ aptitude: 3.9, technical: 3.1, communication: 2.6, preparedness: null });
    expect(p.map((x) => [x.dimension, x.priority, x.training])).toEqual([
      ["communication", true, "soft_skills"],
      ["technical", true, "technical"],
      ["aptitude", false, "aptitude"],
    ]);
  });
});
