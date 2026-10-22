import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describeAnswer, outputsMatch, validateQuestion, type CodeLanguage } from "@playcode/core";
import { LocalRunner } from "../execution/local-runner";
import { parseSqlOutput, SQL_HARNESS } from "../execution/sql";
import type { SeedQuestion } from "./questions";

// Authoring-time check: run each question's program and compare its output
// with the stated correct answer.

const run = promisify(execFile);

export interface VerifyResult {
  id: string;
  ok: boolean;
  skipped?: string;
  problem?: string;
}

function normalize(out: string): string {
  return out
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

function programFor(q: SeedQuestion): string {
  const v = q.verify!;
  let program = v.program;
  if (!program) {
    if (q.answer.kind === "order") {
      const byId = new Map(q.body.lines!.map((l) => [l.id, l.text]));
      program = q.answer.orders[0]!.map((id) => byId.get(id)).join("\n");
    } else {
      program = q.body.code ?? "";
    }
  }
  return v.harness ? `${program}\n${v.harness}\n` : `${program}\n`;
}

function expectedFor(q: SeedQuestion): string {
  if (q.verify?.expected !== undefined) return q.verify.expected;
  if (q.answer.kind === "text") return q.answer.accepted[0]!;
  return describeAnswer(q);
}

async function hasTool(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Coding: every reference solution must pass every test. SQL: the model query must run and return rows. */
async function verifyExecutable(q: SeedQuestion, tools: Record<CodeLanguage, boolean>): Promise<VerifyResult> {
  const runner = new LocalRunner();
  if (q.answer.kind === "sql") {
    if (!tools.python) return { id: q.id, ok: true, skipped: "python not installed" };
    const [o] = await runner.run("python", SQL_HARNESS, [JSON.stringify({ schema: q.body.schema, query: q.answer.solution })]);
    const r = parseSqlOutput(o?.stdout ?? "");
    if (!r.ok) return { id: q.id, ok: false, problem: `model query failed: ${r.error}` };
    if (r.rows.length === 0) return { id: q.id, ok: false, problem: "model query returns no rows" };
    return { id: q.id, ok: true };
  }
  if (q.answer.kind !== "tests") return { id: q.id, ok: true };
  const tests = q.answer.tests;
  const missing = (q.body.languages ?? []).filter((l) => !q.solutions?.[l]);
  if (missing.length) return { id: q.id, ok: false, problem: `no reference solution for ${missing.join(", ")}` };
  const skipped: string[] = [];
  for (const [lang, source] of Object.entries(q.solutions ?? {}) as [CodeLanguage, string][]) {
    if (!tools[lang]) {
      skipped.push(lang);
      continue;
    }
    const outcomes = await runner.run(lang, source, tests.map((t) => t.input));
    const failed = tests.findIndex((t, i) => outcomes[i]?.status !== "ok" || !outputsMatch(t.output, outcomes[i]!.stdout));
    if (failed >= 0) {
      const o = outcomes[failed]!;
      return { id: q.id, ok: false, problem: `${lang} solution fails test ${failed + 1}: ${o.status} ${JSON.stringify(o.stdout.slice(0, 80))} ${o.stderr.slice(0, 200)}` };
    }
  }
  return skipped.length ? { id: q.id, ok: true, skipped: `${skipped.join(", ")} not installed` } : { id: q.id, ok: true };
}

export async function verifyQuestions(questions: SeedQuestion[]): Promise<VerifyResult[]> {
  const tools = {
    python: await hasTool("python3", ["--version"]),
    c: await hasTool("gcc", ["--version"]),
    java: await hasTool("java", ["-version"]),
  };
  const results: VerifyResult[] = [];
  for (const q of questions) {
    const problems = validateQuestion(q);
    if (problems.length) {
      results.push({ id: q.id, ok: false, problem: problems.join("; ") });
      continue;
    }
    if (q.answer.kind === "tests" || q.answer.kind === "sql") {
      results.push(await verifyExecutable(q, tools));
      continue;
    }
    if (!q.verify) {
      results.push({ id: q.id, ok: true, skipped: "no verify block" });
      continue;
    }
    if (!tools[q.verify.runner]) {
      results.push({ id: q.id, ok: true, skipped: `${q.verify.runner} not installed` });
      continue;
    }
    const dir = await mkdtemp(join(tmpdir(), "playcode-verify-"));
    try {
      const program = programFor(q);
      let stdout: string;
      if (q.verify.runner === "python") {
        await writeFile(join(dir, "main.py"), program);
        ({ stdout } = await run("python3", ["-I", join(dir, "main.py")], { timeout: 10_000 }));
      } else if (q.verify.runner === "c") {
        await writeFile(join(dir, "main.c"), program);
        await run("gcc", ["-w", "-o", join(dir, "main"), join(dir, "main.c")], { timeout: 30_000 });
        ({ stdout } = await run(join(dir, "main"), [], { timeout: 10_000 }));
      } else {
        await writeFile(join(dir, "Main.java"), program);
        ({ stdout } = await run("java", [join(dir, "Main.java")], { timeout: 60_000 }));
      }
      const expected = normalize(expectedFor(q));
      const actual = normalize(stdout);
      results.push(actual === expected ? { id: q.id, ok: true } : { id: q.id, ok: false, problem: `expected ${JSON.stringify(expected)}, program printed ${JSON.stringify(actual)}` });
    } catch (err) {
      results.push({ id: q.id, ok: false, problem: `failed to run: ${(err as Error).message.split("\n")[0]}` });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return results;
}
