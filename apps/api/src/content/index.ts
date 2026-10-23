import { CODING_QUESTIONS, SQL_QUESTIONS } from "./coding";
import { FUNDAMENTAL_QUESTIONS, FUNDAMENTAL_SKILLS } from "./fundamentals";
import { QUESTIONS } from "./questions";
import { SKILLS as CODE_SKILLS } from "./skills";

export { PACKS } from "./packs";
/** The syllabus: programming skills, then CS fundamentals. */
export const SKILLS = [...CODE_SKILLS, ...FUNDAMENTAL_SKILLS];
export type { SeedQuestion } from "./questions";

/** Every seeded question: quick micro-questions plus coding and SQL problems. */
export const ALL_QUESTIONS = [...QUESTIONS, ...FUNDAMENTAL_QUESTIONS, ...CODING_QUESTIONS, ...SQL_QUESTIONS];
