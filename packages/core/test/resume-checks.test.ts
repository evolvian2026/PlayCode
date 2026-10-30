import { describe, expect, it } from "vitest";
import { resumeChecks, resumeScore, type ResumeForCheck } from "../src/resume-checks";

const good: ResumeForCheck = {
  headline: "Final-year CSE student building backend APIs in Java",
  about: "I like making slow things fast. My final-year project indexes 2 lakh court judgments for search in under a second, and I interned on a payments team. I'm looking for a backend role where I can learn from strong engineers.",
  links: { github: "https://github.com/x", linkedin: "https://linkedin.com/in/x" },
  academic: { cgpa: 8.1 },
  projects: [{ title: "Judgment search", description: "Full-text search over 200,000 judgments with Postgres and a small Go service; answers in 300 ms.", link: "https://github.com/x/js" }],
  internships: [{ title: "Intern", description: "Payments", verified: true }],
  skills: 5,
};

describe("resume checks", () => {
  it("passes a strong resume", () => {
    expect(resumeChecks(good)).toEqual([]);
    expect(resumeScore([])).toBe(100);
  });
  it("flags what recruiters will notice", () => {
    const c = resumeChecks({ ...good, headline: "", about: "", academic: null, projects: [], links: {}, internships: [{ title: "Intern", description: "", verified: false }], skills: 0 });
    expect(c.filter((x) => x.level === "fix").map((x) => x.section)).toEqual(["headline", "about", "education", "projects"]);
    expect(c.filter((x) => x.level === "tip").map((x) => x.section)).toEqual(["internships", "links", "skills"]);
    expect(resumeScore(c)).toBe(100 - 4 * 15 - 3 * 5);
  });
  it("asks for detail and numbers in projects", () => {
    const c = resumeChecks({ ...good, projects: [{ title: "Chat app", description: "A chat app.", link: null }], links: { linkedin: "https://linkedin.com/in/x" } });
    expect(c.map((x) => x.message)).toEqual([
      "Describe each project in a sentence or two: the problem, your part, the tools.",
      "Add a number to a project: users, records, speed-up, accuracy.",
      "Link the code: a GitHub link on a project or your profile.",
    ]);
  });
});
