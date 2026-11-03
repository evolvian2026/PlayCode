import { describe, expect, it } from "vitest";
import { drivePrepProgress, isWeekday } from "../src";

describe("drive prep", () => {
  it("counts only the steps that apply to the drive", () => {
    expect(drivePrepProgress({ mission: true, interview: false, aptitude: null, profile: true, documents: null, on_duty: false })).toEqual({ done: 2, total: 4, missing: ["interview", "on_duty"] });
    expect(drivePrepProgress({ mission: null, interview: true, aptitude: null, profile: true, documents: null, on_duty: null })).toEqual({ done: 2, total: 2, missing: [] });
  });

  it("asks for on duty only on weekdays", () => {
    expect(isWeekday("2026-11-20")).toBe(true); // Friday
    expect(isWeekday("2026-11-21")).toBe(false); // Saturday
    expect(isWeekday("2026-11-22")).toBe(false); // Sunday
    expect(isWeekday("2026-11-23")).toBe(true); // Monday
  });
});
