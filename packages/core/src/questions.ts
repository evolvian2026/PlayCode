// Question model and server-side grading for the micro-question types.
// None of these types need code execution at answer time: answers are
// verified once at authoring time (see apps/api/src/content/verify.ts).

export const QUESTION_TYPES = [
  "predict_output",
  "spot_bug",
  "fill_blank",
  "parsons",
  "which_snippet",
  "complexity",
  "trace_variable",
  "reverse_mode",
  "pseudocode_mcq",
  "concept",
  "write_code",
  "sql_query",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  predict_output: "Predict the output",
  spot_bug: "Spot the bug",
  fill_blank: "Fill in the blank",
  parsons: "Reorder the lines",
  which_snippet: "Which snippet?",
  complexity: "Complexity",
  trace_variable: "Trace the variable",
  reverse_mode: "Reverse mode",
  pseudocode_mcq: "Pseudocode",
  concept: "Concept check",
  write_code: "Write code",
  sql_query: "SQL query",
};

/** Question types that need the code-execution service to grade. */
export const EXECUTION_TYPES: readonly QuestionType[] = ["write_code", "sql_query"];

export type CodeLanguage = "c" | "java" | "python";
/** "theory": concept questions (DBMS, operating systems, networks) with no code. */
export type Language = CodeLanguage | "pseudocode" | "sql" | "theory";

export const LANGUAGE_LABELS: Record<Language, string> = { c: "C", java: "Java", python: "Python", pseudocode: "Pseudocode", sql: "SQL", theory: "Concepts" };

export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = { c: "C", java: "Java", python: "Python" };

export type Difficulty = 1 | 2 | 3;

export interface Option {
  id: string;
  text: string;
  /** Options may be code snippets (which_snippet, reverse_mode). */
  code?: boolean;
}

export interface ParsonsLine {
  id: string;
  text: string;
}

/** What the student sees. Never contains the answer. */
export interface QuestionBody {
  stem: string;
  code?: string;
  language: Language;
  options?: Option[];
  /** Parsons: the lines to reorder (distractors included). */
  lines?: ParsonsLine[];
  /** Trace / fill blank: placeholder for the text box. */
  inputHint?: string;
  /** Reverse mode: example input/output pairs. */
  examples?: { input: string; output: string }[];
  /** Write code: languages the student may use, and the starting code for each. */
  languages?: CodeLanguage[];
  starterCode?: Partial<Record<CodeLanguage, string>>;
  /** Write code: visible tests (filled in from the answer by toStudentView). */
  sampleTests?: { input: string; output: string }[];
  /** SQL: the tables (DDL and rows) the query runs against. */
  schema?: string;
}

export interface TestCase {
  input: string;
  output: string;
  /** Hidden tests are never sent to the student. */
  hidden: boolean;
  weight?: number;
}

export type Answer =
  | { kind: "option"; optionId: string }
  | { kind: "text"; accepted: string[]; caseSensitive?: boolean }
  /** Spot the bug: 1-based line numbers of the faulty line(s). */
  | { kind: "lines"; lines: number[] }
  /** Parsons: one or more valid orders of line ids; distractors are left out. */
  | { kind: "order"; orders: string[][] }
  /** Write code: stdin/stdout tests, plus a model solution shown after answering. */
  | { kind: "tests"; tests: TestCase[]; reference?: { language: CodeLanguage; source: string } }
  /** SQL: the model query; results are compared as a set unless `ordered`. */
  | { kind: "sql"; solution: string; ordered?: boolean };

export type StudentResponse =
  | { kind: "option"; optionId: string }
  | { kind: "text"; value: string }
  | { kind: "lines"; lines: number[] }
  | { kind: "order"; ids: string[] }
  | { kind: "code"; language: CodeLanguage; source: string }
  | { kind: "sql"; query: string };

export interface Question {
  id: string;
  type: QuestionType;
  skillId: string;
  difficulty: Difficulty;
  body: QuestionBody;
  answer: Answer;
  explanation: string;
  hints: string[];
}

/** The answer kind each question type must use. */
export const ANSWER_KIND_BY_TYPE: Record<QuestionType, Answer["kind"][]> = {
  predict_output: ["option", "text"],
  spot_bug: ["lines"],
  fill_blank: ["option", "text"],
  parsons: ["order"],
  which_snippet: ["option"],
  complexity: ["option"],
  trace_variable: ["text", "option"],
  reverse_mode: ["option"],
  pseudocode_mcq: ["option"],
  concept: ["option"],
  write_code: ["tests"],
  sql_query: ["sql"],
};

/** The response kind the student sends for each answer kind. */
export function responseKindFor(answer: Answer): StudentResponse["kind"] {
  if (answer.kind === "tests") return "code";
  return answer.kind;
}

export function needsExecution(answer: Answer): boolean {
  return answer.kind === "tests" || answer.kind === "sql";
}

export function normalizeText(value: string, caseSensitive = false): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

export function grade(answer: Answer, response: StudentResponse): boolean {
  switch (answer.kind) {
    case "option":
      return response.kind === "option" && response.optionId === answer.optionId;
    case "text": {
      if (response.kind !== "text") return false;
      const given = normalizeText(response.value, answer.caseSensitive);
      return answer.accepted.some((a) => normalizeText(a, answer.caseSensitive) === given);
    }
    case "lines": {
      if (response.kind !== "lines") return false;
      const expected = [...new Set(answer.lines)].sort((a, b) => a - b);
      const given = [...new Set(response.lines)].sort((a, b) => a - b);
      return expected.length === given.length && expected.every((v, i) => v === given[i]);
    }
    case "tests":
    case "sql":
      // Graded by the execution service, never here.
      throw new Error("Code and SQL answers are graded by the execution service");
    case "order":
      return (
        response.kind === "order" &&
        answer.orders.some(
          (order) => order.length === response.ids.length && order.every((id, i) => id === response.ids[i]),
        )
      );
  }
}

/** Human-readable correct answer, shown after the student answers. */
export function describeAnswer(question: Pick<Question, "answer" | "body">): string {
  const { answer, body } = question;
  switch (answer.kind) {
    case "option":
      return body.options?.find((o) => o.id === answer.optionId)?.text ?? answer.optionId;
    case "text":
      return answer.accepted[0] ?? "";
    case "lines":
      return `Line ${answer.lines.join(", ")}`;
    case "order": {
      const byId = new Map(body.lines?.map((l) => [l.id, l.text]));
      return (answer.orders[0] ?? []).map((id) => byId.get(id) ?? id).join("\n");
    }
    case "tests":
      return answer.reference?.source ?? "Passes every test case";
    case "sql":
      return answer.solution;
  }
}

/** Deterministic PRNG (mulberry32) so a shuffle is stable for a given seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface StudentQuestionView {
  id: string;
  type: QuestionType;
  typeLabel: string;
  skillId: string;
  difficulty: Difficulty;
  body: QuestionBody;
  hintCount: number;
  responseKind: StudentResponse["kind"];
}

/**
 * Strip the answer and shuffle options and Parsons lines. The same seed
 * (e.g. session id + question id) always gives the same order, so a reload
 * does not reshuffle.
 */
export function toStudentView(question: Question, seed: string): StudentQuestionView {
  const s = hashString(`${seed}:${question.id}`);
  const body: QuestionBody = { ...question.body };
  // Complexity options read best in their authored (ascending) order.
  if (body.options && question.type !== "complexity") body.options = shuffle(body.options, s);
  if (body.lines) {
    const lines = shuffle(body.lines, s ^ 0x5bd1e995);
    // Never hand out a Parsons puzzle whose solution lines are already in order
    // (distractors in between do not count): swap the first two solution lines.
    const answer = question.answer;
    if (answer.kind === "order") {
      const solutionIds = new Set(answer.orders.flat());
      const positions = lines.flatMap((l, i) => (solutionIds.has(l.id) ? [i] : []));
      const inOrder = positions.map((i) => lines[i]!.id);
      const solved = answer.orders.some((o) => o.length === inOrder.length && o.every((id, i) => id === inOrder[i]));
      if (solved && positions.length > 1) {
        const [a, b] = [positions[0]!, positions[1]!];
        [lines[a], lines[b]] = [lines[b]!, lines[a]!];
      }
    }
    body.lines = lines;
  }
  if (question.answer.kind === "tests") {
    body.sampleTests = question.answer.tests.filter((t) => !t.hidden).map(({ input, output }) => ({ input, output }));
  }
  return {
    id: question.id,
    type: question.type,
    typeLabel: QUESTION_TYPE_LABELS[question.type],
    skillId: question.skillId,
    difficulty: question.difficulty,
    body,
    hintCount: question.hints.length,
    responseKind: responseKindFor(question.answer),
  };
}

/** Authoring-time checks. Returns a list of problems; empty means valid. */
export function validateQuestion(q: Question): string[] {
  const problems: string[] = [];
  if (!QUESTION_TYPES.includes(q.type)) problems.push(`unknown type ${q.type}`);
  if (!q.body.stem.trim()) problems.push("empty stem");
  if (!q.explanation.trim()) problems.push("missing explanation");
  if (!ANSWER_KIND_BY_TYPE[q.type]?.includes(q.answer.kind)) {
    problems.push(`answer kind ${q.answer.kind} not allowed for ${q.type}`);
  }
  const a = q.answer;
  if (a.kind === "option") {
    const ids = q.body.options?.map((o) => o.id) ?? [];
    if (ids.length < 2) problems.push("needs at least 2 options");
    if (new Set(ids).size !== ids.length) problems.push("duplicate option ids");
    const texts = q.body.options?.map((o) => normalizeText(o.text, true)) ?? [];
    if (new Set(texts).size !== texts.length) problems.push("duplicate option texts");
    if (!ids.includes(a.optionId)) problems.push(`answer option ${a.optionId} not in options`);
  }
  if (a.kind === "text" && a.accepted.length === 0) problems.push("no accepted text answers");
  if (a.kind === "lines") {
    const lineCount = (q.body.code ?? "").split("\n").length;
    if (a.lines.length === 0) problems.push("no bug lines");
    if (a.lines.some((n) => n < 1 || n > lineCount)) problems.push("bug line out of range");
  }
  if (a.kind === "tests") {
    if (!q.body.languages?.length) problems.push("no languages allowed");
    if (!a.tests.some((t) => !t.hidden)) problems.push("needs at least one sample test");
    if (!a.tests.some((t) => t.hidden)) problems.push("needs at least one hidden test");
  }
  if (a.kind === "sql") {
    if (!q.body.schema?.trim()) problems.push("missing schema");
    if (!a.solution.trim()) problems.push("missing solution query");
  }
  if (a.kind === "order") {
    const ids = new Set(q.body.lines?.map((l) => l.id) ?? []);
    if (ids.size < 3) problems.push("parsons needs at least 3 lines");
    if (a.orders.length === 0) problems.push("no valid order");
    for (const order of a.orders) {
      if (order.some((id) => !ids.has(id))) problems.push("order references unknown line");
      if (new Set(order).size !== order.length) problems.push("order repeats a line");
    }
  }
  return problems;
}
