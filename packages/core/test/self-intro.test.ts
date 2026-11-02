import { describe, expect, it } from "vitest";
import { INTRO_TIPS, introPractice, introSeconds } from "../src";

const SCRIPT =
  "Good morning. I am Riya Kapoor, a final year computer science student at Demo Institute of Technology. I enjoy solving problems in Python and SQL. In my third year I built a water quality dashboard with two classmates, and I wrote the data pipeline that cleaned sensor readings every hour. I also did a six week internship at a logistics startup where I tested their delivery app. I am looking for a software engineer role where I can keep building data heavy products, and I think my project work has prepared me well for it. Thank you.";

describe("self-introduction practice", () => {
  it("measures how much of the script came through and the delivery", () => {
    const heard = SCRIPT.toLowerCase().replace(/[.,]/g, "");
    const p = introPractice(SCRIPT, heard, 45_000);
    expect(p.coverage).toBe(100);
    expect(p.words).toBe(97);
    expect(p).toMatchObject({ seconds: 45, wpm: 129, length: "short" });
    expect(p.tips).toEqual([INTRO_TIPS.short]);
  });

  it("notices a run-through that loses half the script and fills pauses", () => {
    const heard = "good morning um I am Riya Kapoor um a final year computer science student basically I built a water quality dashboard um thank you";
    const p = introPractice(SCRIPT, heard, 70_000);
    expect(p.coverage).toBeLessThan(30);
    expect(p.length).toBe("good");
    expect(p.tips).toEqual([INTRO_TIPS.missed, INTRO_TIPS.slow, INTRO_TIPS.fillers]);
  });

  it("estimates how long a script takes to say", () => {
    expect(introSeconds(SCRIPT)).toBe(42);
  });
});
