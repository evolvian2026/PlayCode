import { describe, expect, it } from "vitest";
import { foldIcsLine, toIcs, utf8Length, type CalendarEvent } from "../src";

const base: CalendarEvent = { uid: "training-1@playcode", kind: "training", title: "Quant; time, work", start: "2026-11-02T04:30:00.000Z", end: "2026-11-02T06:00:00.000Z", allDay: false, location: "Hall 1", detail: "With Mr. Iyer", url: "https://app.example/play/training" };

describe("iCalendar feed", () => {
  it("writes timed and all-day events, escaping text", () => {
    const ics = toIcs([base, { ...base, uid: "drive-1@playcode", kind: "drive", title: "TCS drive", start: "2026-11-12", end: null, allDay: true, location: null, detail: null }], { name: "PlayCode: Riya", now: new Date("2026-10-27T00:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261102T043000Z\r\nDTEND:20261102T060000Z");
    expect(ics).toContain("SUMMARY:Quant\\; time\\, work");
    expect(ics).toContain("DESCRIPTION:With Mr. Iyer\\nhttps://app.example/play/training");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113");
    expect(ics).toContain("CATEGORIES:Placement drive");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("gives a deadline a short slot", () => {
    expect(toIcs([{ ...base, end: null }], { name: "x", now: new Date() })).toContain("DTSTART:20261102T043000Z\r\nDTEND:20261102T044500Z");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const folded = foldIcsLine(`SUMMARY:${"₹".repeat(40)}`);
    const parts = folded.split("\r\n ");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p, i) => utf8Length(p) <= (i ? 74 : 75))).toBe(true);
    expect(utf8Length("a₹😀")).toBe(1 + 3 + 4);
    expect(parts.join("")).toBe(`SUMMARY:${"₹".repeat(40)}`);
    expect(foldIcsLine("SHORT:line")).toBe("SHORT:line");
  });
});
