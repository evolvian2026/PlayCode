import type { CodeLanguage } from "@playcode/core";

export type RunStatus = "ok" | "compile_error" | "runtime_error" | "timeout" | "output_limit" | "internal_error";

export interface RunOutcome {
  status: RunStatus;
  stdout: string;
  stderr: string;
  timeMs: number;
}

export interface Limits {
  /** Wall-clock limit per test, before the per-language multiplier. */
  timeMs: number;
  memoryMb: number;
  outputBytes: number;
}

export const DEFAULT_LIMITS: Limits = { timeMs: 2_000, memoryMb: 256, outputBytes: 64 * 1024 };

/** Runs untrusted programs. One compile, then one run per stdin input. */
export interface Runner {
  readonly name: string;
  run(language: CodeLanguage, source: string, inputs: string[], limits?: Partial<Limits>): Promise<RunOutcome[]>;
}
