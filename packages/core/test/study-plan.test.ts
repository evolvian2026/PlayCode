import { describe, expect, it } from "vitest";
import { buildStudyPlan, planDayStatus, type PlanSkill } from "../src";

const skills: PlanSkill[] = [
  { id: "loops.for", mastery: 20, practisable: true },
  { id: "pseudocode.basics", mastery: 10, practisable: true },
  { id: "arrays.basics", mastery: 65, practisable: true },
  { id: "recursion.basics", mastery: 0, practisable: true }, // weight 0 for service companies
  { id: "basics.io", mastery: 0, practisable: false }, // no questions
];

describe("study plans", () => {
  it("fills each day up to the target with the biggest weighted gaps, reviews weekly, and ends with a mock round", () => {
    const plan = buildStudyPlan({ skills, profileId: "service", today: "2026-10-26", targetDate: "2026-11-05", missionPackId: "mission-service-pseudocode" });
    expect(plan).toHaveLength(10);
    expect(plan[0]).toEqual({ date: "2026-10-26", kind: "skill", skillId: "pseudocode.basics" });
    expect(plan[1]).toEqual({ date: "2026-10-27", kind: "skill", skillId: "loops.for" }); // not the same skill two days running
    expect(plan[6]).toEqual({ date: "2026-11-01", kind: "review" });
    expect(plan[9]).toEqual({ date: "2026-11-04", kind: "mission", packId: "mission-service-pseudocode" });
    const used = new Set(plan.flatMap((d) => (d.kind === "skill" ? [d.skillId] : [])));
    expect(used.has("recursion.basics")).toBe(false);
    expect(used.has("basics.io")).toBe(false);
    // Ten days go to the two big gaps; with more time the small one gets days too.
    expect(used.has("arrays.basics")).toBe(false);
    const longer = buildStudyPlan({ skills, profileId: "service", today: "2026-10-26", targetDate: "2026-11-15", missionPackId: null });
    expect(longer.some((d) => d.kind === "skill" && d.skillId === "arrays.basics")).toBe(true);
  });

  it("reviews when everything that matters is mastered, and is empty for a past target", () => {
    const strong = skills.map((s) => ({ ...s, mastery: 90 }));
    const plan = buildStudyPlan({ skills: strong, profileId: "service", today: "2026-10-26", targetDate: "2026-10-28", missionPackId: null });
    expect(plan.map((d) => d.kind)).toEqual(["review", "review"]);
    expect(buildStudyPlan({ skills, profileId: "service", today: "2026-10-26", targetDate: "2026-10-26", missionPackId: null })).toEqual([]);
  });

  it("caps the length and labels days", () => {
    expect(buildStudyPlan({ skills, profileId: "product", today: "2026-01-01", targetDate: "2027-01-01", missionPackId: null })).toHaveLength(120);
    const day = { date: "2026-10-26", kind: "review" as const };
    expect(planDayStatus(day, false, "2026-10-27")).toBe("missed");
    expect(planDayStatus(day, false, "2026-10-26")).toBe("today");
    expect(planDayStatus(day, true, "2026-10-27")).toBe("done");
    expect(planDayStatus(day, false, "2026-10-25")).toBe("upcoming");
  });
});
