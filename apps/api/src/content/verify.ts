import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describeAnswer, validateQuestion } from "@playcode/core";
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
