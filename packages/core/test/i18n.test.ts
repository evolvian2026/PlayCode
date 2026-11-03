import { describe, expect, it } from "vitest";
import { at, msg, render, verbatim } from "../src";

describe("messages to students", () => {
  it("are written in the reader's language, values and all", () => {
    const m = msg("Register by {date}. Rounds: {rounds}.", { date: "1 Dec", rounds: "Interview" });
    expect(render(m, "en")).toBe("Register by 1 Dec. Rounds: Interview.");
    expect(render(m, "hi")).toContain("1 Dec");
    expect(render(m, "hi")).not.toContain("Register by");
    // A value that is itself a message is translated too, and lists are joined.
    const steps = msg("{done} of {total} done", { done: 1, total: 2 });
    expect(render(msg("{label}: {pct}% right", { label: msg("Probability"), pct: 40 }), "ta")).toBe("நிகழ்தகவு: 40% சரி");
    expect(render(msg("To do: {list}", { list: [msg("Probability"), msg("Syllogisms")] }), "en")).toBe("To do: Probability, Syllogisms");
    expect(render(steps, "en")).toBe("1 of 2 done");
  });

  it("send someone's own words as they wrote them, and fall back to English", () => {
    expect(render(verbatim("Bring two copies of your resume."), "ta")).toBe("Bring two copies of your resume.");
    expect(render(msg("A sentence nobody has translated yet"), "hi")).toBe("A sentence nobody has translated yet");
  });

  it("write dates the reader's way, in the college's time zone", () => {
    const d = at(new Date("2026-11-16T04:30:00Z"), "Asia/Kolkata", { time: true, weekday: true });
    expect(render(msg("{n} days", { n: d }), "en")).toMatch(/Mon.*16 Nov.*10:00/);
    expect(render(msg("{n} days", { n: d }), "hi")).toMatch(/16/);
    expect(render(msg("{n} days", { n: d }), "hi")).not.toMatch(/Nov/);
    expect(render(msg("{n}", { n: at(new Date("2026-11-16T04:30:00Z"), "Asia/Kolkata") }), "en")).toBe("16 Nov");
    // A calendar day stays that day wherever the server is.
    expect(render(msg("{n} days", { n: at("2026-11-16", "Asia/Kolkata", { weekday: true }) }), "en")).toMatch(/Mon.*16 Nov/);
  });
});

describe("labels that notifications pass in as values", () => {
  it("are translated in Hindi and Tamil, so a translated sentence doesn't carry an English label", async () => {
    const core = await import("../src");
    const { HI } = await import("../src/i18n/hi");
    const { TA } = await import("../src/i18n/ta");
    const labels = [
      ...Object.values(core.PANEL_KINDS),
      // Inside a sentence: "your technical mock interview".
      ...Object.values(core.PANEL_KINDS).filter((k) => k !== "HR").map((k) => k.toLowerCase()),
      ...Object.values(core.PANEL_RECOMMENDATIONS),
      ...Object.values(core.PEER_TRACKS),
      ...Object.values(core.CHECKLIST_ITEMS).map((i) => i.label),
      ...Object.values(core.DRIVE_PREP_STEPS).map((s) => s.label),
      ...core.APTITUDE_TEMPLATES.map((t) => t.label),
      ...Object.values(core.RECORD_FIELDS).map((f) => f.label),
      ...Object.values(core.OPENING_KINDS),
    ];
    const missing = labels.filter((l) => !(l in HI) || !(l in TA));
    expect(missing).toEqual([]);
  });
});

describe("labels the student app shows", () => {
  it("are translated in Hindi and Tamil", async () => {
    const core = await import("../src");
    const { HI } = await import("../src/i18n/hi");
    const { TA } = await import("../src/i18n/ta");
    const labels = [
      ...Object.values(core.DIVISION_LABELS),
      ...Object.values(core.QUESTION_TYPE_LABELS),
      ...Object.values(core.INTERVIEW_TRACK_LABELS),
      ...Object.values(core.NOTIFY_CATEGORIES).flatMap((c) => [c.label, c.detail]),
      ...Object.values(core.JAM_CATEGORIES),
      ...core.JAM_DIMENSIONS.map(([, label]) => label),
      ...Object.values(core.JAM_TIPS),
      ...Object.values(core.DRILL_KINDS).flatMap((k) => [k.label, k.detail]),
      ...Object.values(core.DRILL_BANDS),
      ...Object.values(core.PRACTICE_TASK_KINDS),
      ...core.INTRO_PARTS.flatMap(([, title, detail]) => [title, detail]),
      ...Object.values(core.INTRO_TIPS),
    ];
    const missing = labels.filter((l) => !(l in HI) || !(l in TA));
    expect(missing).toEqual([]);
  });
});
