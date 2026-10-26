import { CODING_QUESTIONS, SQL_QUESTIONS } from "./coding";
import { APTITUDE_QUESTIONS, APTITUDE_SKILLS } from "./aptitude";
import { FUNDAMENTAL_QUESTIONS, FUNDAMENTAL_SKILLS } from "./fundamentals";
import { QUESTIONS } from "./questions";
import { SKILLS as CODE_SKILLS } from "./skills";
import { VERBAL_QUESTIONS, VERBAL_SKILLS } from "./verbal";

export { PACKS } from "./packs";
/** The syllabus: programming skills, CS fundamentals, aptitude, then verbal ability. */
export const SKILLS = [...CODE_SKILLS, ...FUNDAMENTAL_SKILLS, ...APTITUDE_SKILLS, ...VERBAL_SKILLS];
export type { SeedQuestion } from "./questions";

/** Every seeded question: quick micro-questions plus coding and SQL problems. */
export const ALL_QUESTIONS = [...QUESTIONS, ...FUNDAMENTAL_QUESTIONS, ...APTITUDE_QUESTIONS, ...VERBAL_QUESTIONS, ...CODING_QUESTIONS, ...SQL_QUESTIONS];
