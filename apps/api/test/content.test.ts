import { describe, expect, it } from "vitest";
import { PACKS } from "../src/content/packs";
import { QUESTIONS } from "../src/content/questions";
import { SKILLS } from "../src/content/skills";
import { verifyQuestions } from "../src/content/verify";

describe("starter content", () => {
  it("has unique ids, known skills and valid packs", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const skillIds = new Set(SKILLS.map((s) => s.id));
    expect(QUESTIONS.filter((q) => !skillIds.has(q.skillId))).toEqual([]);
    for (const p of PACKS) expect(p.questionIds.filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("every stated answer matches what the code prints", { timeout: 180_000 }, async () => {
    const failures = (await verifyQuestions(QUESTIONS)).filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });
});
