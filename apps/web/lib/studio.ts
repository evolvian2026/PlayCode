import { ANSWER_KIND_BY_TYPE, type Answer, type CodeLanguage, type QuestionBody, type QuestionType } from "@playcode/core";

/** A question as the studio edits it (what POST/PUT /console/studio/questions take). */
export interface StudioInput {
  type: QuestionType;
  skillId: string;
  difficulty: 1 | 2 | 3;
  body: QuestionBody;
  answer: Answer;
  explanation: string;
  hints: string[];
  tags: string[];
  solutions?: Partial<Record<CodeLanguage, string>> | null;
  checkMode: "run" | "manual";
  origin?: "studio" | "ai";
}

export interface QuestionCheck {
  ok: boolean;
  problems: string[];
  output?: string;
  at: string;
}

export interface StudioQuestion extends Omit<StudioInput, "origin"> {
  id: string;
  typeLabel: string;
  language: string;
  status: "draft" | "live" | "retired";
  origin: "seed" | "studio" | "ai";
  version: number;
  lastCheck: QuestionCheck | null;
  attempts: number;
  accuracyPct: number | null;
  updatedAt: string;
}

/** An AI draft waiting to be opened in the editor. */
export const DRAFT_STORAGE_KEY = "playcode.studio.draft";

const IDS = "abcdefgh";

/** A blank answer of the right kind for a question type. */
export function blankAnswer(type: QuestionType, kind: Answer["kind"] = ANSWER_KIND_BY_TYPE[type][0]!): Answer {
  switch (kind) {
    case "option":
      return { kind: "option", optionId: "a" };
    case "text":
      return { kind: "text", accepted: [""] };
    case "lines":
      return { kind: "lines", lines: [] };
    case "order":
      return { kind: "order", orders: [[]] };
    case "tests":
      return { kind: "tests", tests: [{ input: "", output: "", hidden: false }, { input: "", output: "", hidden: true }] };
    case "sql":
      return { kind: "sql", solution: "" };
  }
}

export function blankInput(type: QuestionType = "predict_output", skillId = ""): StudioInput {
  const answer = blankAnswer(type);
  const language = type === "sql_query" ? "sql" : type === "pseudocode_mcq" ? "pseudocode" : "python";
  return {
    type,
    skillId,
    difficulty: 1,
    body: {
      stem: "",
      language,
      ...(answer.kind === "option" ? { options: [0, 1, 2, 3].map((i) => ({ id: IDS[i]!, text: "" })) } : {}),
      ...(type === "write_code" ? { languages: ["python"] as CodeLanguage[], starterCode: {} } : {}),
      ...(type === "sql_query" ? { schema: "" } : {}),
    },
    answer,
    explanation: "",
    hints: [],
    tags: [],
    solutions: type === "write_code" ? {} : null,
    checkMode: type === "predict_output" ? "run" : "manual",
  };
}

export const optionId = (i: number) => IDS[i]!;

/** The editable part of a saved question (what PUT takes back). */
export function toInput(q: StudioQuestion): StudioInput {
  return {
    type: q.type,
    skillId: q.skillId,
    difficulty: q.difficulty,
    body: q.body,
    answer: q.answer,
    explanation: q.explanation,
    hints: q.hints,
    tags: q.tags,
    solutions: q.solutions,
    checkMode: q.checkMode,
  };
}
