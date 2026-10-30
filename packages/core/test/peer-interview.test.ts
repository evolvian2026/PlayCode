import { describe, expect, it } from "vitest";
import { zonedTime } from "../src/dates";
import { agreeMode, firstCommonWindow, peerQuestions } from "../src/peer-interview";

describe("peer interviews", () => {
  it("gives each side different questions, the same for the same seed", () => {
    const [a, b] = peerQuestions("hr", 42);
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    expect(a.some((q) => b.includes(q))).toBe(false);
    expect(peerQuestions("hr", 42)).toEqual([a, b]);
    expect(peerQuestions("hr", 43)).not.toEqual([a, b]);
  });
  it("agrees on online or in person", () => {
    expect(agreeMode("either", "either")).toBe("online");
    expect(agreeMode("either", "in_person")).toBe("in_person");
    expect(agreeMode("online", "either")).toBe("online");
    expect(agreeMode("online", "in_person")).toBeNull();
  });
  it("finds the earliest shared window still ahead", () => {
    const a = [{ date: "2026-11-03", slot: "evening" as const }, { date: "2026-11-02", slot: "evening" as const }, { date: "2026-11-02", slot: "morning" as const }];
    const b = [{ date: "2026-11-02", slot: "morning" as const }, { date: "2026-11-03", slot: "evening" as const }, { date: "2026-11-02", slot: "evening" as const }];
    expect(firstCommonWindow(a, b, { date: "2026-11-01", slot: "evening" })).toEqual({ date: "2026-11-02", slot: "morning" });
    expect(firstCommonWindow(a, b, { date: "2026-11-02", slot: "afternoon" })).toEqual({ date: "2026-11-02", slot: "evening" });
    expect(firstCommonWindow(a, [{ date: "2026-11-04", slot: "morning" }], { date: "2026-11-01", slot: "morning" })).toBeNull();
  });
});

describe("zoned time", () => {
  it("turns a local time into the moment it happens", () => {
    expect(zonedTime("2026-11-02", "18:00", "Asia/Kolkata").toISOString()).toBe("2026-11-02T12:30:00.000Z");
    expect(zonedTime("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
});
