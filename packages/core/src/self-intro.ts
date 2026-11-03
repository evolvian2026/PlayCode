// "Tell me about yourself": the question nearly every campus interview opens
// with. The student keeps a script (written by them, or drafted by AI from
// their PlayCode profile and then edited), and practises saying it. Practice is
// scored without AI: how much of the script came through, in order, and the
// delivery (pace, fillers, length against the minute or so interviewers expect).

import { matchDrill } from "./speaking-drills";
import { countFillers, PACE_RANGE, wordCount } from "./speech";

/** A spoken introduction should run about a minute: 60 to 90 seconds is the usual advice. */
export const INTRO_SECONDS = { min: 60, max: 90 } as const;
/** About 120 to 220 words at a comfortable pace. */
export const INTRO_WORDS = { min: 120, max: 220 } as const;
/** AI drafts per student per day. */
export const INTRO_DRAFTS_PER_DAY = 3;

/** The usual shape: present, past, future. */
export const INTRO_PARTS = [
  ["now", "Who you are now", "Your name, course and college, and what you're good at."],
  ["done", "What you've done", "One or two projects, internships or results, with what you did."],
  ["next", "What you want next", "The role you're after and why it fits you."],
] as const;

export const INTRO_TIPS = {
  missed: "You left out parts of your script. Learn it as three parts, not word for word, so one slip doesn't lose the rest.",
  short: "That was under a minute. Add a line on what you did in a project and why the role suits you.",
  long: "That ran past a minute and a half. Cut detail from the middle; interviewers ask follow-ups.",
  slow: "Your pace was slow. Know your three parts well enough to speak without stopping to recall them.",
  fast: "You spoke fast. Slow down: this is the first impression the interviewer gets.",
  fillers: "Cut filler words (um, basically, actually). A short pause sounds more confident.",
  good: "Well delivered: you covered your script at a steady pace in about a minute.",
} as const;

export interface IntroPractice {
  /** Share of the script's words that came through, in order, 0-100. */
  coverage: number;
  words: number;
  seconds: number;
  wpm: number;
  fillersPer100Words: number;
  length: "short" | "good" | "long";
  tips: string[];
}

/** Score one spoken run-through of the script. */
export function introPractice(script: string, heard: string, spokenMs: number): IntroPractice {
  const coverage = matchDrill(script, heard).accuracy;
  const words = wordCount(heard);
  const seconds = Math.round(spokenMs / 1000);
  const wpm = spokenMs > 0 ? Math.round(words / (spokenMs / 60_000)) : 0;
  const fillersPer100Words = words ? Math.round((countFillers(heard) / words) * 1000) / 10 : 0;
  const length = seconds < INTRO_SECONDS.min - 10 ? "short" : seconds > INTRO_SECONDS.max + 10 ? "long" : "good";
  const tips: string[] = [];
  if (coverage < 70) tips.push(INTRO_TIPS.missed);
  if (length === "short") tips.push(INTRO_TIPS.short);
  if (length === "long") tips.push(INTRO_TIPS.long);
  if (wpm && wpm < PACE_RANGE.min) tips.push(INTRO_TIPS.slow);
  if (wpm > PACE_RANGE.max) tips.push(INTRO_TIPS.fast);
  if (fillersPer100Words >= 3) tips.push(INTRO_TIPS.fillers);
  if (tips.length === 0) tips.push(INTRO_TIPS.good);
  return { coverage, words, seconds, wpm, fillersPer100Words, length, tips };
}

/** Roughly how long a script takes to say, at 140 words a minute. */
export const introSeconds = (script: string) => Math.round((wordCount(script) / 140) * 60);
