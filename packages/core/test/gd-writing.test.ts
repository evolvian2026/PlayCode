import { describe, expect, it } from "vitest";
import { GD_PERSONAS, GD_TOPICS, gdParticipation, WRITING_TASKS, wordLimitStatus } from "../src";

describe("group discussion participation", () => {
  it("counts the student's contributions and share of words, leaving out the moderator and the summary", () => {
    const p = gdParticipation([
      { speaker: "moderator", text: "Welcome everyone, the topic is work from home." },
      { speaker: "student", text: "I think it helps people save commuting time" }, // 8 words
      { speaker: "ananya", text: "Surveys say productivity rose too" }, // 5
      { speaker: "rohit", text: "But culture suffers badly" }, // 4
      { speaker: "student", text: "Hybrid could balance both" }, // 4
      { speaker: "student", text: "To sum up, we agreed hybrid works best", summary: true },
    ]);
    expect(p).toEqual({ contributions: 2, sharePct: 57, initiated: true, summarised: true }); // 12 of 21 words
  });

  it("knows when someone else opened", () => {
    expect(gdParticipation([{ speaker: "moderator", text: "Begin." }, { speaker: "meera", text: "Let me start." }])).toEqual({ contributions: 0, sharePct: 0, initiated: false, summarised: false });
  });

  it("has distinct topics and personas", () => {
    expect(new Set(GD_TOPICS.map((t) => t.id)).size).toBe(GD_TOPICS.length);
    expect(GD_PERSONAS.map((p) => p.id)).toEqual(["ananya", "rohit", "meera"]);
  });
});

describe("writing tasks", () => {
  it("checks word limits", () => {
    const task = WRITING_TASKS.find((t) => t.kind === "email")!;
    expect(wordLimitStatus(40, task)).toBe("short");
    expect(wordLimitStatus(100, task)).toBe("ok");
    expect(wordLimitStatus(200, task)).toBe("long");
  });

  it("gives every email the points to cover, and ids are unique", () => {
    expect(WRITING_TASKS.filter((t) => t.kind === "email").every((t) => t.points.length === 3)).toBe(true);
    expect(new Set(WRITING_TASKS.map((t) => t.id)).size).toBe(WRITING_TASKS.length);
  });
});
