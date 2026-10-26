// Group discussion (GD) practice: a moderated discussion on a topic between
// the student and three AI participants with different styles, scored on the
// rubric campus recruiters use. The rules here are shared by the API (limits,
// participation figures) and the web app (labels).

export type GdTopicKind = "business" | "technology" | "education" | "social" | "abstract";

export interface GdTopic {
  id: string;
  title: string;
  kind: GdTopicKind;
}

export const GD_TOPIC_KINDS: Record<GdTopicKind, string> = {
  business: "Business and work",
  technology: "Technology",
  education: "Education",
  social: "Society",
  abstract: "Abstract",
};

/** Topics of the kind used in campus GDs, kept clear of party politics and religion. */
export const GD_TOPICS: GdTopic[] = [
  { id: "wfh", title: "Work from home is here to stay", kind: "business" },
  { id: "startup-vs-mnc", title: "A startup is a better first job than an MNC", kind: "business" },
  { id: "four-day-week", title: "India should try a four-day work week", kind: "business" },
  { id: "upi", title: "Digital payments have done more good than harm", kind: "business" },
  { id: "ai-jobs", title: "AI will create more jobs than it takes away", kind: "technology" },
  { id: "privacy", title: "Privacy matters more than convenience", kind: "technology" },
  { id: "space", title: "Space missions are worth the money for a developing country", kind: "technology" },
  { id: "ev-cities", title: "Electric vehicles are the answer to pollution in our cities", kind: "technology" },
  { id: "online-classes", title: "Online classes can replace the classroom", kind: "education" },
  { id: "skills-over-degree", title: "Skills matter more than degrees in tech hiring", kind: "education" },
  { id: "coding-school", title: "Coding should be compulsory in school", kind: "education" },
  { id: "attendance", title: "College attendance should be optional", kind: "education" },
  { id: "social-media", title: "Social media does more harm than good to young people", kind: "social" },
  { id: "small-towns", title: "The next big companies will come from small towns", kind: "social" },
  { id: "zero", title: "Zero", kind: "abstract" },
  { id: "bridges", title: "Bridges", kind: "abstract" },
];

export interface GdPersona {
  id: "ananya" | "rohit" | "meera";
  name: string;
  /** How they take part; the AI plays them this way, and the student sees it after the GD. */
  style: string;
}

export const GD_PERSONAS: GdPersona[] = [
  { id: "ananya", name: "Ananya", style: "Confident and data-minded; brings figures and real examples, and sometimes talks over others." },
  { id: "rohit", name: "Rohit", style: "A contrarian; takes the other side to provoke debate and sometimes drifts off the topic." },
  { id: "meera", name: "Meera", style: "Calm and inclusive; builds on others' points and brings quieter people in." },
];

export type GdSpeaker = "moderator" | "student" | GdPersona["id"];

export const GD_DIMENSIONS = [
  ["content", "Ideas and content"],
  ["communication", "Communication"],
  ["listening", "Listening and building on others"],
  ["leadership", "Leadership and direction"],
  ["summary", "Summary"],
] as const;

/** The student's contributions before the moderator asks for a summary, and rounds of discussion in all. */
export const GD_MAX_CONTRIBUTIONS = 6;
export const GD_MAX_ROUNDS = 10;
/** Contributions needed for a GD to be scored. */
export const GD_MIN_CONTRIBUTIONS = 2;

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export interface GdParticipation {
  /** Times the student spoke during the discussion (the summary not included). */
  contributions: number;
  /** The student's share of words spoken by participants, in percent. */
  sharePct: number;
  /** Whether the student spoke first. */
  initiated: boolean;
  /** Whether the student gave the closing summary. */
  summarised: boolean;
}

/** How much the student took part, from the transcript. The moderator's lines don't count. */
export function gdParticipation(turns: { speaker: GdSpeaker; text: string; summary?: boolean }[]): GdParticipation {
  const spoken = turns.filter((t) => t.speaker !== "moderator");
  const mine = spoken.filter((t) => t.speaker === "student");
  const words = (list: typeof spoken) => list.reduce((n, t) => n + countWords(t.text), 0);
  const all = words(spoken.filter((t) => !t.summary));
  return {
    contributions: mine.filter((t) => !t.summary).length,
    sharePct: all ? Math.round((words(mine.filter((t) => !t.summary)) / all) * 100) : 0,
    initiated: spoken[0]?.speaker === "student",
    summarised: mine.some((t) => t.summary),
  };
}
