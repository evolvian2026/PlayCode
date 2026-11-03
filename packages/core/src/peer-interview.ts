// Peer mock interviews: two students practise on each other. Each takes a
// turn as the interviewer with a few questions and what a good answer covers,
// then they swap and rate each other.

export type PeerTrack = "technical" | "hr";
export const PEER_TRACKS: Record<PeerTrack, string> = { technical: "Technical", hr: "HR" };

export type PeerMode = "online" | "in_person" | "either";
export const PEER_MODES: Record<PeerMode, string> = { online: "Online", in_person: "In person", either: "Either" };

export type PeerSlot = "morning" | "afternoon" | "evening";
/** Each slot starts at this local time ("10:00"), and lasts an hour: half each way. */
export const PEER_SLOTS: Record<PeerSlot, { label: string; start: string }> = {
  morning: { label: "Morning, 10:00", start: "10:00" },
  afternoon: { label: "Afternoon, 14:00", start: "14:00" },
  evening: { label: "Evening, 18:00", start: "18:00" },
};

export interface PeerWindow {
  date: string;
  slot: PeerSlot;
}

export interface PeerQuestion {
  q: string;
  /** What a good answer covers, for the student asking. */
  covers: string;
}

export const PEER_QUESTIONS: Record<PeerTrack, PeerQuestion[]> = {
  hr: [
    { q: "Tell me about yourself.", covers: "Two minutes: studies, one or two things built or done, what they want next. Not a recital of the resume." },
    { q: "Why do you want to work with us?", covers: "Something specific about the company or role, linked to their own interests." },
    { q: "Tell me about a time you worked in a team and something went wrong.", covers: "The situation, what they did themselves, what happened, what they learnt (STAR)." },
    { q: "What is your biggest weakness?", covers: "A real one, and what they are doing about it. Not a disguised strength." },
    { q: "Where do you see yourself in three years?", covers: "Growth in skills and responsibility, consistent with the role." },
    { q: "Tell me about a project you're proud of.", covers: "The problem, their own part, a decision they made, the result with a number if possible." },
    { q: "Are you willing to relocate or work in shifts?", covers: "An honest answer; any constraint stated clearly and politely." },
    { q: "How do you handle pressure or a tight deadline?", covers: "A concrete example: how they prioritised and what they delivered." },
    { q: "Why should we hire you?", covers: "Two or three strengths backed by evidence, tied to what the role needs." },
    { q: "Do you have any questions for us?", covers: "One or two thoughtful questions about the work, the team or training." },
  ],
  technical: [
    { q: "What is the difference between a process and a thread?", covers: "Separate memory vs shared memory; threads are lighter to create and switch; an example of when to use each." },
    { q: "Explain the four pillars of object-oriented programming.", covers: "Encapsulation, inheritance, polymorphism, abstraction, each with a short example." },
    { q: "What is normalisation? Why would you denormalise?", covers: "Removing redundancy (1NF to 3NF); denormalising to speed up reads at the cost of duplication." },
    { q: "What is the difference between an array and a linked list?", covers: "Contiguous memory and O(1) indexing vs O(1) insertion at a known node; cache behaviour." },
    { q: "How does a hash map work?", covers: "Hashing keys to buckets, collisions (chaining or probing), resizing, average O(1)." },
    { q: "What happens when you type a URL in a browser and press Enter?", covers: "DNS lookup, TCP (and TLS) connection, HTTP request, response, rendering." },
    { q: "Explain the difference between SQL JOIN types.", covers: "Inner, left, right, full outer; what happens to rows without a match." },
    { q: "What is a deadlock, and how can it be avoided?", covers: "The four conditions; lock ordering, timeouts, or avoiding hold-and-wait." },
    { q: "Find the second largest number in an array. Talk me through it.", covers: "One pass keeping the largest and second largest; duplicates; O(n) time, O(1) space." },
    { q: "What is the difference between a stack and a queue? Where is each used?", covers: "LIFO vs FIFO; call stack and undo vs scheduling and BFS." },
    { q: "What is an index in a database? When does it not help?", covers: "A lookup structure (often a B-tree); slows writes; doesn't help on small tables or low-selectivity columns." },
    { q: "Explain recursion with an example. What can go wrong?", covers: "A base case and a smaller subproblem; stack overflow without a base case; memoising repeated work." },
  ],
};

/** The questions each partner asks, picked from the set by the session's seed, without repeats. */
export function peerQuestions(track: PeerTrack, seed: number, perSide = 4): [PeerQuestion[], PeerQuestion[]] {
  const pool = [...PEER_QUESTIONS[track]];
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return [pool.slice(0, perSide), pool.slice(perSide, perSide * 2)];
}

/** The mode two requests agree on, or null if they don't. */
export function agreeMode(a: PeerMode, b: PeerMode): "online" | "in_person" | null {
  if (a === "either") return b === "either" ? "online" : b;
  if (b === "either" || a === b) return a;
  return null;
}

/** The earliest window two requests share that is still ahead (by date and slot order). */
export function firstCommonWindow(a: PeerWindow[], b: PeerWindow[], notBefore: PeerWindow): PeerWindow | null {
  const order = (w: PeerWindow) => `${w.date}-${Object.keys(PEER_SLOTS).indexOf(w.slot)}`;
  const shared = a.filter((x) => b.some((y) => y.date === x.date && y.slot === x.slot) && order(x) >= order(notBefore));
  return shared.sort((x, y) => order(x).localeCompare(order(y)))[0] ?? null;
}

export type PeerRating = "clarity" | "content" | "confidence";
export const PEER_RATINGS: Record<PeerRating, string> = { clarity: "Clear answers", content: "Substance", confidence: "Confidence" };

/** Missing this many sessions in 30 days pauses requests for two weeks. */
export const PEER_NO_SHOW_LIMIT = 2;
