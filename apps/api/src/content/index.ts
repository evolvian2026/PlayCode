import { CODING_QUESTIONS, SQL_QUESTIONS } from "./coding";
import { QUESTIONS } from "./questions";

export { PACKS } from "./packs";
export { SKILLS } from "./skills";
export type { SeedQuestion } from "./questions";

/** Every seeded question: quick micro-questions plus coding and SQL problems. */
export const ALL_QUESTIONS = [...QUESTIONS, ...CODING_QUESTIONS, ...SQL_QUESTIONS];
