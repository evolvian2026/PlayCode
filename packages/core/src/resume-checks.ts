// What makes a campus resume work, checked automatically, and the sections
// a reviewer comments on.

export type ResumeSection = "headline" | "about" | "education" | "projects" | "internships" | "skills" | "links" | "overall";

export const RESUME_SECTIONS: Record<ResumeSection, string> = {
  headline: "Headline",
  about: "About you",
  education: "Education",
  projects: "Projects",
  internships: "Internships",
  skills: "Skills and practice",
  links: "Links",
  overall: "Overall",
};

export interface ResumeForCheck {
  headline: string;
  about: string;
  links: { github?: string; linkedin?: string; portfolio?: string };
  academic: { cgpa: number | null } | null;
  projects: { title: string; description: string; link: string | null }[];
  internships: { title: string; description: string; verified: boolean }[];
  skills: number;
}

export interface ResumeCheck {
  section: ResumeSection;
  /** "fix": recruiters will notice; "tip": would make it stronger. */
  level: "fix" | "tip";
  message: string;
}

export function resumeChecks(r: ResumeForCheck): ResumeCheck[] {
  const out: ResumeCheck[] = [];
  const add = (section: ResumeSection, level: ResumeCheck["level"], message: string) => out.push({ section, level, message });
  const headline = r.headline.trim();
  if (!headline) add("headline", "fix", "Add a one-line headline: what you build and what you're looking for.");
  else if (headline.length < 25) add("headline", "tip", "Make the headline specific, like \"Final-year CSE student building backend APIs in Java\".");
  const about = r.about.trim();
  if (!about) add("about", "fix", "Write two to four sentences about what you've built and what you want to do next.");
  else if (about.length < 150) add("about", "tip", "Say a little more: a project you're proud of and the role you want.");
  else if (about.length > 600) add("about", "tip", "Keep it to four sentences; recruiters skim.");
  if (!r.academic || r.academic.cgpa === null) add("education", "fix", "Your academic record isn't on file. Ask your placement cell to add it.");
  if (!r.projects.length) add("projects", "fix", "Add at least one project, with what it does and what you used.");
  else {
    if (r.projects.some((p) => p.description.trim().length < 80)) add("projects", "tip", "Describe each project in a sentence or two: the problem, your part, the tools.");
    if (!r.projects.some((p) => /\d/.test(p.description))) add("projects", "tip", "Add a number to a project: users, records, speed-up, accuracy.");
    if (!r.projects.some((p) => p.link) && !r.links.github) add("links", "tip", "Link the code: a GitHub link on a project or your profile.");
  }
  if (r.internships.some((i) => !i.verified)) add("internships", "tip", "Ask your placement cell to verify your internship; verified ones say so on the resume.");
  if (!r.links.linkedin) add("links", "tip", "Add your LinkedIn profile.");
  if (r.skills === 0) add("skills", "tip", "Practise until some skills show as mastered; they appear on the resume by themselves.");
  return out;
}

/** 100 less 15 for each fix and 5 for each tip. */
export function resumeScore(checks: ResumeCheck[]): number {
  return Math.max(0, 100 - checks.reduce((n, c) => n + (c.level === "fix" ? 15 : 5), 0));
}

export type ReviewVerdict = "ready" | "changes";
export const REVIEW_VERDICTS: Record<ReviewVerdict, string> = { ready: "Ready to send", changes: "Needs changes" };

// ---------- Alumni ----------

export type IntroPurpose = "referral" | "advice";
export const INTRO_PURPOSES: Record<IntroPurpose, string> = { referral: "A referral", advice: "Advice" };
/** The most introductions a student can have waiting at once. */
export const MAX_PENDING_INTROS = 3;
