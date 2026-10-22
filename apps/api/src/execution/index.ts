import { needsExecution, outputsMatch, resultSetsMatch, type CodeLanguage, type Question, type StudentResponse } from "@playcode/core";
import { env } from "../env";
import { HttpError, badRequest } from "../lib/errors";
import { Judge0Runner } from "./judge0-runner";
import { LocalRunner } from "./local-runner";
import { ExecutionQueue, type Priority } from "./queue";
import { parseSqlOutput, SQL_HARNESS, type SqlResult } from "./sql";
import type { RunOutcome, Runner } from "./types";

export type { Priority } from "./queue";

function createRunner(): Runner {
  if (env.EXECUTION_BACKEND === "judge0") {
    if (!env.JUDGE0_URL) throw new Error("EXECUTION_BACKEND=judge0 needs JUDGE0_URL");
    return new Judge0Runner(env.JUDGE0_URL, env.JUDGE0_TOKEN, env.JUDGE0_LANGUAGE_IDS);
  }
  if (env.NODE_ENV === "production" && !env.EXECUTION_ALLOW_LOCAL) {
    throw new Error("The local runner does not isolate student code. Use EXECUTION_BACKEND=judge0 in production.");
  }
  return new LocalRunner();
}

let runner: Runner | null = null;
const queue = new ExecutionQueue(env.EXECUTION_CONCURRENCY);

export function getRunner(): Runner {
  return (runner ??= createRunner());
}

/** Tests swap in a fake runner. */
export function setRunner(r: Runner | null): void {
  runner = r;
}

export function queueDepth(): number {
  return queue.depth;
}

export const MAX_SOURCE_BYTES = 20_000;

/** Run a whole program (authoring checks): one compile, one run per stdin input. */
export function runProgram(language: CodeLanguage, source: string, inputs: string[] = [""], priority: Priority = "practice"): Promise<RunOutcome[]> {
  return queue.run(priority, () => getRunner().run(language, source, inputs));
}

export interface TestResult {
  passed: boolean;
  status: RunOutcome["status"];
  timeMs: number;
  hidden: boolean;
  /** Only for sample tests: what the student can see. */
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

export interface CodeEvaluation {
  kind: "code";
  correct: boolean;
  score: number; // 0-1, weighted share of tests passed
  passed: number;
  total: number;
  compileError?: string;
  tests: TestResult[];
}

export interface SqlEvaluation {
  kind: "sql";
  correct: boolean;
  score: number;
  result: SqlResult;
  expectedColumns?: string[];
}

export type Evaluation = CodeEvaluation | SqlEvaluation;

function checkLanguage(q: Question, language: CodeLanguage, source: string) {
  if (!q.body.languages?.includes(language)) throw badRequest(`This problem accepts ${q.body.languages?.join(", ")}`);
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw badRequest("Your code is too long (20 KB limit)");
}

async function runTests(q: Question, language: CodeLanguage, source: string, onlySamples: boolean, priority: Priority): Promise<CodeEvaluation> {
  if (q.answer.kind !== "tests") throw new Error("not a coding question");
  checkLanguage(q, language, source);
  const tests = q.answer.tests.filter((t) => !onlySamples || !t.hidden);
  const outcomes = await queue.run(priority, () => getRunner().run(language, source, tests.map((t) => t.input)));
  const results: TestResult[] = tests.map((t, i) => {
    const o = outcomes[i]!;
    const passed = o.status === "ok" && outputsMatch(t.output, o.stdout);
    const base = { passed, status: o.status, timeMs: o.timeMs, hidden: t.hidden };
    return t.hidden ? base : { ...base, input: t.input, expected: t.output, actual: o.stdout.slice(0, 2_000), stderr: o.stderr.slice(0, 1_000) };
  });
  const weight = (i: number) => tests[i]!.weight ?? 1;
  const total = tests.reduce((a, _, i) => a + weight(i), 0);
  const earned = results.reduce((a, r, i) => a + (r.passed ? weight(i) : 0), 0);
  const compile = outcomes.find((o) => o.status === "compile_error");
  return {
    kind: "code",
    correct: results.every((r) => r.passed),
    score: total ? earned / total : 0,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    compileError: compile?.stderr,
    tests: results,
  };
}

async function runSql(schema: string, query: string, priority: Priority): Promise<SqlResult> {
  if (Buffer.byteLength(query) > MAX_SOURCE_BYTES) throw badRequest("Your query is too long");
  const [o] = await queue.run(priority, () => getRunner().run("python", SQL_HARNESS, [JSON.stringify({ schema, query })]));
  if (!o || o.status !== "ok") return { ok: false, columns: [], rows: [], error: o?.status === "timeout" ? "The query took too long" : "The query could not be run" };
  return parseSqlOutput(o.stdout);
}

async function evaluateSql(q: Question, query: string, priority: Priority): Promise<SqlEvaluation> {
  if (q.answer.kind !== "sql") throw new Error("not a SQL question");
  const schema = q.body.schema ?? "";
  const [mine, expected] = await Promise.all([runSql(schema, query, priority), runSql(schema, q.answer.solution, priority)]);
  if (!expected.ok) throw new HttpError(500, "content_error", "This question's model answer failed to run");
  const correct = mine.ok && resultSetsMatch(expected.rows, mine.rows, q.answer.ordered);
  return { kind: "sql", correct, score: correct ? 1 : 0, result: { ...mine, rows: mine.rows.slice(0, 50) }, expectedColumns: expected.columns };
}

/** Grade a code or SQL answer against every test. */
export async function evaluate(q: Question, response: StudentResponse, priority: Priority): Promise<Evaluation> {
  if (!needsExecution(q.answer)) throw new Error("question does not need execution");
  if (q.answer.kind === "tests") {
    if (response.kind !== "code") throw badRequest("Send code for this question");
    return runTests(q, response.language, response.source, false, priority);
  }
  if (response.kind !== "sql") throw badRequest("Send a SQL query for this question");
  return evaluateSql(q, response.query, priority);
}

/** "Run" button: sample tests only (code) or just the student's query (SQL). Nothing is recorded. */
export async function tryRun(q: Question, response: StudentResponse): Promise<Evaluation> {
  if (q.answer.kind === "tests") {
    if (response.kind !== "code") throw badRequest("Send code for this question");
    return runTests(q, response.language, response.source, true, "practice");
  }
  if (q.answer.kind === "sql") {
    if (response.kind !== "sql") throw badRequest("Send a SQL query for this question");
    const result = await runSql(q.body.schema ?? "", response.query, "practice");
    return { kind: "sql", correct: false, score: 0, result: { ...result, rows: result.rows.slice(0, 50) } };
  }
  throw badRequest("Only code and SQL questions can be run");
}

// Simple per-user limit for the Run button: 12 runs a minute.
const runs = new Map<string, number[]>();
export function checkRunRate(userId: string, now = Date.now()): void {
  const recent = (runs.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 12) throw new HttpError(429, "rate_limited", "Too many runs. Wait a few seconds and try again.");
  recent.push(now);
  runs.set(userId, recent);
}
