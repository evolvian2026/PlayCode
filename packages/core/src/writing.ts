// Written English practice: the email and essay tasks that service-company
// tests include, with their word limits and time, and the rubric they are
// marked on.

export type WritingKind = "email" | "essay";

export interface WritingTask {
  id: string;
  kind: WritingKind;
  title: string;
  /** The situation and what to write. */
  prompt: string;
  /** Points the answer must cover (emails), as the tests list them. */
  points: string[];
  minWords: number;
  maxWords: number;
  minutes: number;
}

export const WRITING_KINDS: Record<WritingKind, string> = { email: "Email", essay: "Essay" };

const email = (id: string, title: string, prompt: string, points: string[]): WritingTask => ({ id, kind: "email", title, prompt, points, minWords: 80, maxWords: 150, minutes: 10 });
const essay = (id: string, title: string, prompt: string): WritingTask => ({ id, kind: "essay", title, prompt, points: [], minWords: 200, maxWords: 300, minutes: 20 });

export const WRITING_TASKS: WritingTask[] = [
  email("email-contest", "Permission for a coding contest", "You are the class representative of CSE third year. Write an email to your Head of Department asking permission to hold an inter-section coding contest.", [
    "the date and the lab you need",
    "why it will help students before placements",
    "what support you need from the department",
  ]),
  email("email-leave", "Leave during an internship", "You are an intern at a software company in Pune. Write an email to your manager asking for two days' leave to sit your college's semester exam.", [
    "the dates and the reason",
    "how your current task will be covered",
    "when you will be back and how to reach you",
  ]),
  email("email-delay", "A delayed delivery", "You work in customer support for an online electronics store. A customer's laptop, promised for Monday, will now arrive on Thursday. Write to the customer.", [
    "an apology and the reason for the delay",
    "the new delivery date",
    "what you are offering to make up for it",
  ]),
  email("email-interview", "Rescheduling an interview", "You have a final interview with a company on Friday, but your university has just moved an exam to the same day. Write to the recruiter.", [
    "thanks for the opportunity",
    "the clash and the proof you can share",
    "two other times that suit you",
  ]),
  email("email-team", "Welcome to a new team member", "You lead a project team of five students. A new member, Kiran, joins next week. Write to Kiran.", [
    "a welcome and what the project is",
    "Kiran's first task",
    "when and where the team meets",
  ]),
  email("email-feedback", "Feedback on a workshop", "Your college ran a two-day workshop on cloud computing. The organiser has asked students for feedback. Write to the organiser.", [
    "what you found most useful",
    "one thing that could be better",
    "a topic you would like next time",
  ]),
  email("email-offer", "Accepting a job offer", "You have received an offer letter for a graduate engineer role. Write to the HR manager.", [
    "your acceptance and thanks",
    "your joining date",
    "a question about the documents to bring",
  ]),
  email("email-complaint", "A faulty hostel Wi-Fi", "The Wi-Fi in your hostel block has been down for a week during exam preparation. Write to the hostel warden.", [
    "the problem and how long it has lasted",
    "how it affects students",
    "what you request, and by when",
  ]),
  essay("essay-ai", "AI in everyday life", "Write an essay on how artificial intelligence is changing everyday life in India. Give examples, and discuss one benefit and one risk."),
  essay("essay-remote", "Learning online", "Online learning grew quickly in recent years. Write an essay on whether it can give students in small towns the same chances as those in big cities."),
  essay("essay-failure", "What failure teaches", "Write an essay on what failure can teach a young professional, with an example from your own experience or someone you know."),
  essay("essay-environment", "Technology and the environment", "Write an essay on how engineers can help reduce pollution in Indian cities. Suggest two practical ideas."),
  essay("essay-teamwork", "Working in teams", "Most work is done in teams. Write an essay on what makes a team work well, and what a new graduate can do to be a good team member."),
  essay("essay-digital", "A digital India", "Write an essay on how digital services such as online payments and e-governance have changed life for ordinary people, and who may be left behind."),
];

export const WRITING_DIMENSIONS = [
  ["task", "Covers the task"],
  ["organisation", "Structure and format"],
  ["language", "Grammar and vocabulary"],
  ["tone", "Tone"],
] as const;

/** Attempts a student may have marked each day. */
export const WRITING_PER_DAY = 5;

export function wordLimitStatus(words: number, task: Pick<WritingTask, "minWords" | "maxWords">): "short" | "ok" | "long" {
  return words < task.minWords ? "short" : words > task.maxWords ? "long" : "ok";
}
