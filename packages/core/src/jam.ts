// JAM (Just A Minute): speak for one minute on a topic you see for the first
// time, a staple of campus communication rounds and of the speaking section of
// English tests. The student gets a few seconds to think, then speaks; the
// browser turns speech into text, so PlayCode has the words and how long the
// student spoke, but no audio. Delivery (pace, fillers, how much of the minute
// was used) is measured here; content, structure and language are marked by AI.

import { countFillers, PACE_RANGE, wordCount } from "./speech";

export type JamCategory = "everyday" | "college" | "technology" | "opinion" | "abstract";

export const JAM_CATEGORIES: Record<JamCategory, string> = {
  everyday: "Everyday life",
  college: "College and career",
  technology: "Technology",
  opinion: "For or against",
  abstract: "Abstract",
};

export interface JamTopic {
  id: string;
  category: JamCategory;
  topic: string;
}

/** Topics as campus JAM rounds set them: plain, open, and answerable without preparation. */
export const JAM_TOPICS: JamTopic[] = [
  { id: "my-hometown", category: "everyday", topic: "My hometown" },
  { id: "a-festival", category: "everyday", topic: "A festival I look forward to" },
  { id: "street-food", category: "everyday", topic: "Street food" },
  { id: "morning-routine", category: "everyday", topic: "Why mornings matter" },
  { id: "public-transport", category: "everyday", topic: "Public transport in my city" },
  { id: "first-job", category: "college", topic: "What I want from my first job" },
  { id: "best-teacher", category: "college", topic: "The best teacher I have had" },
  { id: "group-projects", category: "college", topic: "What group projects teach you" },
  { id: "failure", category: "college", topic: "A failure I learnt from" },
  { id: "hostel-or-home", category: "college", topic: "Hostel life or living at home" },
  { id: "phones", category: "technology", topic: "Life without a smartphone" },
  { id: "ai-jobs", category: "technology", topic: "Will AI take our jobs?" },
  { id: "upi", category: "technology", topic: "How UPI changed the way we pay" },
  { id: "social-media", category: "technology", topic: "Social media: connecting or isolating?" },
  { id: "online-classes", category: "technology", topic: "Online classes versus the classroom" },
  { id: "attendance", category: "opinion", topic: "Attendance should be optional in college" },
  { id: "work-from-home", category: "opinion", topic: "Work from home is here to stay" },
  { id: "marks-vs-skills", category: "opinion", topic: "Skills matter more than marks" },
  { id: "startup-or-mnc", category: "opinion", topic: "A startup or a large company for your first job" },
  { id: "exams", category: "opinion", topic: "Exams test memory, not learning" },
  { id: "colour-blue", category: "abstract", topic: "The colour blue" },
  { id: "a-door", category: "abstract", topic: "A door" },
  { id: "silence", category: "abstract", topic: "Silence" },
  { id: "pencil", category: "abstract", topic: "If I were a pencil" },
  { id: "time", category: "abstract", topic: "Time" },
];

/** Seconds to think after the topic appears, and to speak. */
export const JAM_PREP_SECONDS = 15;
export const JAM_SECONDS = 60;
/** Talks marked per student per day (each mark is an AI call). */
export const JAM_PER_DAY = 5;
/** Fewer words than this can't be marked: half a minute of speech is about 60. */
export const MIN_JAM_WORDS = 30;

export const JAM_DIMENSIONS = [
  ["content", "Ideas and examples"],
  ["structure", "Structure"],
  ["language", "Grammar and vocabulary"],
] as const;

/** Coaching on delivery, in the order shown. */
export const JAM_TIPS = {
  early: "You stopped early. Keep going for the whole minute: add an example or a second point.",
  slow: "Your pace was slow, with long pauses. Plan two or three points while you think, then speak in full sentences.",
  fast: "You spoke fast. Slow down a little so each point lands.",
  fillers: "Cut filler words (um, basically, actually). A short pause sounds more confident.",
  good: "Good delivery: you used the minute at a steady pace with few fillers.",
} as const;

export interface JamDelivery {
  words: number;
  /** Words a minute while the microphone was on. */
  wpm: number;
  fillers: number;
  fillersPer100Words: number;
  pace: "slow" | "good" | "fast";
  /** How much of the minute the student used, 0-100. */
  usedPct: number;
  tips: string[];
}

/** Pace, fillers and use of the minute, from the transcript and the time spoken. */
export function jamDelivery(transcript: string, spokenMs: number): JamDelivery {
  const words = wordCount(transcript);
  const fillers = countFillers(transcript);
  const wpm = spokenMs > 0 ? Math.round(words / (spokenMs / 60_000)) : 0;
  const fillersPer100Words = words ? Math.round((fillers / words) * 1000) / 10 : 0;
  const pace = wpm < PACE_RANGE.min ? "slow" : wpm > PACE_RANGE.max ? "fast" : "good";
  const usedPct = Math.min(100, Math.round((spokenMs / (JAM_SECONDS * 1000)) * 100));
  const tips: string[] = [];
  if (usedPct < 75) tips.push(JAM_TIPS.early);
  if (pace === "slow") tips.push(JAM_TIPS.slow);
  if (pace === "fast") tips.push(JAM_TIPS.fast);
  if (fillersPer100Words >= 3) tips.push(JAM_TIPS.fillers);
  if (tips.length === 0) tips.push(JAM_TIPS.good);
  return { words, wpm, fillers, fillersPer100Words, pace, usedPct, tips };
}
