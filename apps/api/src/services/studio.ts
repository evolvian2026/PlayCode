import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  ANSWER_KIND_BY_TYPE,
  initialQuestionRating,
  normalizeText,
  QUESTION_TYPE_LABELS,
  validateQuestion,
  type Answer,
  type CodeLanguage,
  type QuestionBody,
  type QuestionType,
} from "@playcode/core";
import type { Db } from "../db/client";
import { questions, skills, type QuestionCheck } from "../db/schema";
import { evaluate, runProgram } from "../execution";
import { aiProvider, AiUnavailableError, type DraftQuestion } from "../lib/ai";
import { audit } from "../lib/audit";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { recordAiUsage } from "./coach";
import { toCoreQuestion } from "./practice";
import { aiAllowed } from "./plan";

// The content studio: institutions write private questions for their own
// students, and PlayCode's content team writes the global bank. Every
// question is validated, and anything that can be run is run before it goes
// live: output questions are executed and compared with the stated answer,
// coding problems run every reference solution against every test, and SQL
// model answers must return rows.

/** Whose bank: an institution's private questions, or the global bank (tenantId null). */
export type Bank = { tenantId: string | null };

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

type Row = typeof questions.$inferSelect;

const RUNNABLE: CodeLanguage[] = ["c", "java", "python"];

const inBank = (bank: Bank) => (bank.tenantId ? eq(questions.tenantId, bank.tenantId) : isNull(questions.tenantId));

export function studioView(r: Row) {
  return {
    id: r.id,
    type: r.type,
    typeLabel: QUESTION_TYPE_LABELS[r.type],
    skillId: r.skillId,
    language: r.language,
    difficulty: r.difficulty,
    body: r.body,
    answer: r.answer,
    explanation: r.explanation,
    hints: r.hints,
    tags: r.tags,
    solutions: r.solutions,
    checkMode: r.checkMode,
    lastCheck: r.lastCheck,
    status: r.status,
    origin: r.origin,
    version: r.version,
    attempts: r.attempts,
    accuracyPct: r.attempts ? Math.round((r.correctCount / r.attempts) * 100) : null,
    updatedAt: r.updatedAt ?? r.createdAt,
  };
}

export async function listStudio(db: Db, bank: Bank, filter: { status?: "draft" | "live" | "retired"; skillId?: string; search?: string }) {
  const rows = await db
    .select()
    .from(questions)
    .where(
      and(
        inBank(bank),
        filter.status ? eq(questions.status, filter.status) : undefined,
        filter.skillId ? eq(questions.skillId, filter.skillId) : undefined,
        filter.search ? or(ilike(questions.id, `%${filter.search}%`), sql`${questions.body}->>'stem' ilike ${`%${filter.search}%`}`) : undefined,
      ),
    )
    .orderBy(desc(sql`coalesce(${questions.updatedAt}, ${questions.createdAt})`))
    .limit(500);
  return rows.map(studioView);
}

async function load(db: Db, bank: Bank, id: string) {
  const [row] = await db.select().from(questions).where(and(eq(questions.id, id), inBank(bank)));
  if (!row) throw notFound("Question");
  return row;
}

export async function getStudio(db: Db, bank: Bank, id: string) {
  return studioView(await load(db, bank, id));
}

function expectedOutput(q: Pick<StudioInput, "answer" | "body">): string | null {
  if (q.answer.kind === "text") return q.answer.accepted[0] ?? null;
  if (q.answer.kind === "option") return q.body.options?.find((o) => o.id === (q.answer as { optionId: string }).optionId)?.text ?? null;
  return null;
}

/** Validate, then run whatever can be run. Never throws for a failing check; returns the problems. */
export async function checkQuestion(q: StudioInput & { id?: string }, now: Date): Promise<QuestionCheck> {
  const problems = validateQuestion({ id: q.id ?? "new", type: q.type, skillId: q.skillId, difficulty: q.difficulty, body: q.body, answer: q.answer, explanation: q.explanation, hints: q.hints });
  const done = (extra: Partial<QuestionCheck> = {}): QuestionCheck => ({ ok: problems.length === 0, problems, at: now.toISOString(), ...extra });
  if (problems.length) return done();
  const core = { id: q.id ?? "new", type: q.type, skillId: q.skillId, difficulty: q.difficulty, body: q.body, answer: q.answer, explanation: q.explanation, hints: q.hints };

  try {
    if (q.answer.kind === "tests") {
      const langs = q.body.languages ?? [];
      const missing = langs.filter((l) => !q.solutions?.[l]?.trim());
      if (missing.length) problems.push(`Add a reference solution in ${missing.join(", ")}`);
      for (const lang of langs.filter((l) => q.solutions?.[l]?.trim())) {
        const ev = await evaluate(core, { kind: "code", language: lang, source: q.solutions![lang]! }, "practice");
        if (ev.kind === "code" && !ev.correct) {
          const failed = ev.tests.findIndex((t) => !t.passed);
          problems.push(ev.compileError ? `${lang} solution does not compile: ${ev.compileError.slice(0, 300)}` : `${lang} solution fails test ${failed + 1} (${ev.tests[failed]?.status})`);
        }
      }
      return done();
    }
    if (q.answer.kind === "sql") {
      const ev = await evaluate(core, { kind: "sql", query: q.answer.solution }, "practice");
      if (ev.kind === "sql" && !ev.result.ok) problems.push(`The model query fails: ${ev.result.error}`);
      else if (ev.kind === "sql" && ev.result.rows.length === 0) problems.push("The model query returns no rows, so any empty answer would pass");
      return done();
    }
    if (q.checkMode === "run") {
      const lang = q.body.language as CodeLanguage;
      const expected = expectedOutput(q);
      if (!RUNNABLE.includes(lang) || !q.body.code?.trim()) problems.push("Only complete C, Java or Python programs can be run. Switch the check to manual review.");
      else if (expected === null) problems.push("Running the code only checks typed answers or the text of the correct option");
      else {
        const [o] = await runProgram(lang, q.body.code);
        const output = (o?.stdout ?? "").trim();
        if (o?.status !== "ok") problems.push(`The program did not run: ${o?.status}${o?.stderr ? ` (${o.stderr.slice(0, 300)})` : ""}`);
        else if (normalizeText(output, true) !== normalizeText(expected, true)) problems.push(`The program prints "${output.slice(0, 200)}" but the answer says "${expected}"`);
        return done({ output: output.slice(0, 2000) });
      }
    }
  } catch (err) {
    if (err instanceof HttpError) problems.push(err.message);
    else throw err;
  }
  return done();
}

function sanitize(input: StudioInput): StudioInput {
  if (!ANSWER_KIND_BY_TYPE[input.type].includes(input.answer.kind)) throw badRequest(`A ${QUESTION_TYPE_LABELS[input.type]} question can't use a ${input.answer.kind} answer`);
  return {
    ...input,
    hints: input.hints.map((h) => h.trim()).filter(Boolean),
    tags: [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    // Solutions only make sense for coding problems.
    solutions: input.answer.kind === "tests" ? (input.solutions ?? {}) : null,
  };
}

async function assertSkill(db: Db, skillId: string) {
  const [s] = await db.select({ id: skills.id }).from(skills).where(eq(skills.id, skillId));
  if (!s) throw badRequest("Unknown skill");
}

export async function createQuestion(db: Db, bank: Bank, actorId: string, raw: StudioInput, now: Date) {
  const input = sanitize(raw);
  await assertSkill(db, input.skillId);
  const id = `${bank.tenantId ? "inst" : "pc"}-${input.skillId.replace(/[^a-z0-9]+/g, "-")}-${randomBytes(4).toString("hex")}`;
  const [row] = await db
    .insert(questions)
    .values({
      id,
      tenantId: bank.tenantId,
      type: input.type,
      skillId: input.skillId,
      language: input.body.language,
      difficulty: input.difficulty,
      body: input.body,
      answer: input.answer,
      explanation: input.explanation,
      hints: input.hints,
      tags: input.tags,
      solutions: input.solutions,
      checkMode: input.checkMode,
      status: "draft",
      origin: input.origin ?? "studio",
      rating: initialQuestionRating(input.difficulty),
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await audit(db, { tenantId: bank.tenantId, actorId, action: "content.create", target: id, data: { type: input.type, origin: input.origin ?? "studio" } });
  return studioView(row!);
}

export async function updateQuestion(db: Db, bank: Bank, actorId: string, id: string, raw: StudioInput, now: Date) {
  const row = await load(db, bank, id);
  const input = sanitize(raw);
  await assertSkill(db, input.skillId);
  let lastCheck = row.lastCheck;
  // A live question changes under students' feet, so it must pass its check before the edit is saved.
  if (row.status === "live") {
    lastCheck = await checkQuestion({ ...input, id }, now);
    if (!lastCheck.ok) throw new HttpError(422, "check_failed", `This question is live, so the edit must pass its check first: ${lastCheck.problems.join("; ")}`);
  }
  const [updated] = await db
    .update(questions)
    .set({
      type: input.type,
      skillId: input.skillId,
      language: input.body.language,
      difficulty: input.difficulty,
      body: input.body,
      answer: input.answer,
      explanation: input.explanation,
      hints: input.hints,
      tags: input.tags,
      solutions: input.solutions,
      checkMode: input.checkMode,
      lastCheck: row.status === "live" ? lastCheck : null,
      version: sql`${questions.version} + 1`,
      updatedAt: now,
    })
    .where(eq(questions.id, id))
    .returning();
  await audit(db, { tenantId: bank.tenantId, actorId, action: "content.update", target: id, data: { status: row.status } });
  return studioView(updated!);
}

export async function runCheck(db: Db, bank: Bank, id: string, now: Date) {
  const row = await load(db, bank, id);
  const check = await checkQuestion({ ...toCoreQuestion(row), tags: row.tags, solutions: row.solutions, checkMode: row.checkMode }, now);
  await db.update(questions).set({ lastCheck: check }).where(eq(questions.id, id));
  return check;
}

export async function setStatus(db: Db, bank: Bank, actorId: string, id: string, status: "live" | "retired" | "draft", now: Date) {
  const row = await load(db, bank, id);
  if (status === "live") {
    const check = await runCheck(db, bank, id, now);
    if (!check.ok) throw new HttpError(422, "check_failed", `Fix these before publishing: ${check.problems.join("; ")}`);
  }
  if (row.status === status) return getStudio(db, bank, id);
  if (status === "draft" && row.status === "live") throw conflict("live", "Retire a live question instead of moving it back to draft");
  await db.update(questions).set({ status, updatedAt: now }).where(eq(questions.id, id));
  await audit(db, { tenantId: bank.tenantId, actorId, action: `content.${status === "live" ? "publish" : status === "retired" ? "retire" : "draft"}`, target: id });
  return getStudio(db, bank, id);
}

// ---------- AI drafting ----------

export const DRAFTABLE: QuestionType[] = ["predict_output", "spot_bug", "complexity", "trace_variable", "pseudocode_mcq", "fill_blank", "which_snippet"];

const TYPE_GUIDE: Partial<Record<QuestionType, string>> = {
  predict_output: "A complete program in `code`; the student types what it prints. Put the exact output in acceptedAnswers. No options.",
  spot_bug: "A program of 6 to 15 lines in `code` with exactly one faulty line (a logic error, not a typo). Put its 1-based line number in buggyLines. No options.",
  complexity: "A function or loop in `code`; four options in Big-O notation such as O(n log n), one correct.",
  trace_variable: "A complete program in `code`; the stem asks for the final value of one named variable, which the program also prints as its only output. Put the value in acceptedAnswers. No options.",
  pseudocode_mcq: "Pseudocode in `code` in the style of placement aptitude tests (BEGIN/END, SET, WHILE, PRINT); four options, one correct.",
  fill_blank: "A program in `code` with one blank written as ____; four options for what fills the blank so the program does what the stem says, one correct.",
  which_snippet: "No `code`; four short code snippets as options, exactly one of which does what the stem asks.",
};

/** Turn an AI draft into a studio question (not saved). Code and SQL types are not drafted. */
export function draftToInput(d: DraftQuestion, meta: { type: QuestionType; skillId: string; language: string; difficulty: 1 | 2 | 3 }): StudioInput {
  const options = d.options.filter((o) => o.text.trim()).map((o, i) => ({ id: "abcdefgh"[i]!, text: o.text, ...(meta.type === "which_snippet" ? { code: true } : {}) }));
  const correctIndex = d.options.findIndex((o) => o.id === d.correctOptionId);
  let answer: Answer;
  if (meta.type === "spot_bug") answer = { kind: "lines", lines: d.buggyLines };
  else if (options.length >= 2 && correctIndex >= 0 && ANSWER_KIND_BY_TYPE[meta.type].includes("option")) answer = { kind: "option", optionId: options[correctIndex]!.id };
  else answer = { kind: "text", accepted: d.acceptedAnswers.filter((a) => a.trim()) };
  const runnable = ["c", "java", "python"].includes(meta.language) && ["predict_output", "trace_variable"].includes(meta.type);
  return {
    type: meta.type,
    skillId: meta.skillId,
    difficulty: meta.difficulty,
    body: { stem: d.stem, ...(d.code.trim() ? { code: d.code } : {}), language: meta.language as QuestionBody["language"], ...(answer.kind === "option" ? { options } : {}) },
    answer,
    explanation: d.explanation,
    hints: d.hints,
    tags: ["ai-drafted"],
    checkMode: runnable ? "run" : "manual",
    origin: "ai",
  };
}

export async function draftWithAi(
  db: Db,
  args: { tenantId: string | null; actorId: string; type: QuestionType; skillId: string; language: string; difficulty: 1 | 2 | 3; count: number; guidance?: string; now: Date },
) {
  const provider = aiProvider();
  if (!provider) throw badRequest("AI drafting is not set up on this server");
  if (args.tenantId) {
    const allowed = await aiAllowed(db, args.tenantId, "ai_drafting", args.now);
    if (!allowed.ok) throw new HttpError(402, "plan_upgrade", allowed.reason);
  }
  if (!DRAFTABLE.includes(args.type)) throw badRequest("AI can draft quick question types only. Write coding and SQL problems by hand.");
  const [skill] = await db.select().from(skills).where(eq(skills.id, args.skillId));
  if (!skill) throw badRequest("Unknown skill");
  let res;
  try {
    res = await provider.draftQuestions({
      skill: `${skill.topicName}: ${skill.name}`,
      typeLabel: QUESTION_TYPE_LABELS[args.type],
      typeGuide: TYPE_GUIDE[args.type]!,
      language: args.language === "pseudocode" ? "pseudocode" : ({ c: "C", java: "Java", python: "Python 3" } as Record<string, string>)[args.language] ?? args.language,
      difficulty: args.difficulty,
      count: args.count,
      guidance: args.guidance,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(502, "ai_unavailable", err.message);
    throw new HttpError(503, "ai_unavailable", "The AI service did not respond. Try again in a minute.");
  }
  await recordAiUsage(db, { tenantId: args.tenantId, userId: args.actorId, feature: "question_draft", usage: res.usage, now: args.now });
  const drafts = [];
  // Check every draft (running the code where possible) so the author sees which ones hold up.
  for (const d of res.value.slice(0, args.count)) {
    const input = draftToInput(d, args);
    drafts.push({ input, check: await checkQuestion(input, args.now) });
  }
  return drafts;
}
