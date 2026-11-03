import { describe, expect, it } from "vitest";
import { assessHealth, type HealthMetrics } from "../src";

const base: HealthMetrics = { students: 100, seats: 120, weeklyActive: 55, staffActive7: 2, staffActive14: 3, licenceDaysLeft: 200, overdueDays: 0 };

describe("customer health", () => {
  it("is healthy when students and staff use PlayCode and the account is in order", () => {
    expect(assessHealth(base)).toEqual({ status: "healthy", reasons: [] });
  });

  it("flags low use, quiet staff, renewals and unpaid invoices", () => {
    expect(assessHealth({ ...base, weeklyActive: 30 })).toEqual({ status: "watch", reasons: ["30% of students active this week (goal 40%)"] });
    expect(assessHealth({ ...base, weeklyActive: 10, staffActive7: 0, staffActive14: 0 }).reasons).toEqual(["Only 10% of students active this week", "No staff have used the console in 2 weeks"]);
    expect(assessHealth({ ...base, licenceDaysLeft: 45 }).reasons).toEqual(["Licence ends in 45 days"]);
    expect(assessHealth({ ...base, licenceDaysLeft: -1 }).status).toBe("at_risk");
    expect(assessHealth({ ...base, overdueDays: 40 }).status).toBe("at_risk");
    expect(assessHealth({ ...base, students: 0, weeklyActive: 0 })).toEqual({ status: "watch", reasons: ["No students yet"] });
  });
});
