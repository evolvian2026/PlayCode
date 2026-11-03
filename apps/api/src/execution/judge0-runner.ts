import type { CodeLanguage } from "@playcode/core";
import { DEFAULT_LIMITS, type Limits, type RunOutcome, type RunStatus, type Runner } from "./types";

// Production runner backed by a self-hosted Judge0 (https://judge0.com),
// which runs every submission in an isolated sandbox with no network.
// Language ids match Judge0 CE defaults; override with JUDGE0_LANGUAGE_IDS
// (e.g. "c:50,java:62,python:71") if your instance differs.

const DEFAULT_IDS: Record<CodeLanguage, number> = { c: 50, java: 62, python: 71 };

interface Judge0Response {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null;
  status: { id: number; description: string };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

export function judge0Status(id: number): RunStatus {
  // 3 Accepted, 4 Wrong Answer (no expected output given, so not used), 5 TLE,
  // 6 Compilation Error, 7-12 runtime errors, 13 internal error, 14 exec format error.
  if (id === 3 || id === 4) return "ok";
  if (id === 5) return "timeout";
  if (id === 6) return "compile_error";
  if (id >= 7 && id <= 12) return "runtime_error";
  return "internal_error";
}

export class Judge0Runner implements Runner {
  readonly name = "judge0";
  private ids: Record<CodeLanguage, number>;

  constructor(
    private baseUrl: string,
    private token?: string,
    languageIds?: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.ids = { ...DEFAULT_IDS };
    for (const pair of languageIds?.split(",") ?? []) {
      const [lang, id] = pair.split(":");
      if (lang && id && lang in this.ids) this.ids[lang as CodeLanguage] = Number(id);
    }
  }

  async run(language: CodeLanguage, source: string, inputs: string[], partial: Partial<Limits> = {}): Promise<RunOutcome[]> {
    const limits = { ...DEFAULT_LIMITS, ...partial };
    return Promise.all(
      inputs.map(async (stdin): Promise<RunOutcome> => {
        const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/submissions?base64_encoded=true&wait=true`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(this.token ? { "X-Auth-Token": this.token } : {}) },
          body: JSON.stringify({
            language_id: this.ids[language],
            source_code: b64(source),
            stdin: b64(stdin),
            cpu_time_limit: limits.timeMs / 1000,
            wall_time_limit: (limits.timeMs * 3) / 1000,
            memory_limit: limits.memoryMb * 1024,
            enable_network: false,
          }),
        });
        if (!res.ok) return { status: "internal_error", stdout: "", stderr: `Judge0 returned ${res.status}`, timeMs: 0 };
        const body = (await res.json()) as Judge0Response;
        const stdout = unb64(body.stdout);
        return {
          status: stdout.length > limits.outputBytes ? "output_limit" : judge0Status(body.status.id),
          stdout: stdout.slice(0, limits.outputBytes),
          stderr: (unb64(body.compile_output) + unb64(body.stderr)).slice(0, 4_000),
          timeMs: Math.round(Number(body.time ?? 0) * 1000),
        };
      }),
    );
  }
}
