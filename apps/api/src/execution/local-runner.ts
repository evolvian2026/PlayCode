import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodeLanguage } from "@playcode/core";
import { DEFAULT_LIMITS, type Limits, type RunOutcome, type Runner } from "./types";

// Development and test runner: compiles and runs programs on this machine
// with CPU, memory, file-size and wall-clock limits (prlimit). It does NOT
// isolate the network or filesystem, so production must use the Judge0
// runner (see judge0-runner.ts). The factory refuses it in production unless
// EXECUTION_ALLOW_LOCAL=true.

interface ProcResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  overflow: boolean;
  timeMs: number;
}

function exec(cmd: string, args: string[], opts: { cwd: string; stdin?: string; timeMs: number; outputBytes: number }): Promise<ProcResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: opts.cwd, LANG: "C.UTF-8" } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let overflow = false;
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > opts.outputBytes) {
        overflow = true;
        kill();
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 8_192) stderr += d.toString();
    });
    child.on("error", (err) => {
      stderr += err.message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: stdout.slice(0, opts.outputBytes), stderr, timedOut, overflow, timeMs: Date.now() - started });
    });
    child.stdin.on("error", () => {}); // the program may exit before reading stdin
    child.stdin.end(opts.stdin ?? "");
  });
}

const FILES: Record<CodeLanguage, string> = { c: "main.c", java: "Main.java", python: "main.py" };
// Java needs the JVM's start-up time on top of the program's own time.
const TIME_FACTOR: Record<CodeLanguage, number> = { c: 1, java: 2.5, python: 1.5 };

export class LocalRunner implements Runner {
  readonly name = "local";

  private limited(language: CodeLanguage, limits: Limits, cmd: string[]): [string, string[]] {
    const cpu = Math.ceil((limits.timeMs * TIME_FACTOR[language]) / 1000);
    // The JVM reserves far more address space than it uses; cap its heap instead.
    const as = language === "java" ? "unlimited" : String(limits.memoryMb * 1024 * 1024);
    // Soft CPU limit raises SIGXCPU (reported as a timeout); the hard limit one second later kills.
    return ["prlimit", [`--cpu=${cpu}:${cpu + 1}`, `--as=${as}`, `--fsize=${1024 * 1024}`, "--core=0", "--", ...cmd]];
  }

  async run(language: CodeLanguage, source: string, inputs: string[], partial: Partial<Limits> = {}): Promise<RunOutcome[]> {
    const limits = { ...DEFAULT_LIMITS, ...partial };
    const dir = await mkdtemp(join(tmpdir(), "playcode-run-"));
    try {
      await writeFile(join(dir, FILES[language]), source);
      let runCmd: string[];
      if (language === "c") {
        const c = await exec("gcc", ["-O2", "-std=c11", "-w", "-o", "main", "main.c", "-lm"], { cwd: dir, timeMs: 30_000, outputBytes: 16_384 });
        if (c.code !== 0) return inputs.map(() => ({ status: "compile_error", stdout: "", stderr: c.stderr.slice(0, 4_000), timeMs: 0 }));
        runCmd = ["./main"];
      } else if (language === "java") {
        const c = await exec("javac", ["-nowarn", "Main.java"], { cwd: dir, timeMs: 60_000, outputBytes: 16_384 });
        if (c.code !== 0) return inputs.map(() => ({ status: "compile_error", stdout: "", stderr: c.stderr.slice(0, 4_000), timeMs: 0 }));
        runCmd = ["java", `-Xmx${limits.memoryMb}m`, "-Xss64m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-cp", ".", "Main"];
      } else {
        runCmd = ["python3", "-I", "-S", "main.py"];
      }
      const outcomes: RunOutcome[] = [];
      for (const input of inputs) {
        const [cmd, args] = this.limited(language, limits, runCmd);
        const r = await exec(cmd, args, { cwd: dir, stdin: input, timeMs: limits.timeMs * TIME_FACTOR[language] + 500, outputBytes: limits.outputBytes });
        const cpuKilled = r.signal === "SIGXCPU" || (r.signal === "SIGKILL" && r.timeMs >= limits.timeMs * TIME_FACTOR[language] * 0.9);
        const status = r.timedOut || cpuKilled ? "timeout" : r.overflow ? "output_limit" : r.code === 0 ? "ok" : "runtime_error";
        outcomes.push({ status, stdout: r.stdout, stderr: r.stderr.slice(0, 4_000), timeMs: r.timeMs });
      }
      return outcomes;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
