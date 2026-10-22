import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";

// AI features (coach hints, question drafting, webcam snapshot review) go
// through this one provider so tests can swap in a fake and the rest of the
// code never touches the SDK. Everything is optional: with no Anthropic
// credentials the features report themselves as unavailable.

export const AI_MODEL = "claude-opus-5-5";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AiResult<T> {
  value: T;
  usage: AiUsage;
}

export interface CoachHintInput {
  typeLabel: string;
  language: string;
  stem: string;
  code?: string;
  options?: { id: string; text: string }[];
  /** The correct answer and explanation, so the hint points the right way. Never to be revealed. */
  answer: string;
  explanation: string;
  /** Hints the student has already seen for this question. */
  previousHints: string[];
  /** The student's work in progress (code or SQL), and how it did on the sample tests. */
  draft?: { source: string; feedback?: string };
}

export const draftQuestionSchema = z.object({
  stem: z.string().describe("The question, one or two sentences."),
  code: z.string().describe("The code snippet the question is about. Empty string if none."),
  options: z.array(z.object({ id: z.string(), text: z.string() })).describe("Answer options with ids a, b, c, d. Empty for typed answers."),
  correctOptionId: z.string().describe("Id of the correct option, or empty string for typed answers."),
  acceptedAnswers: z.array(z.string()).describe("Accepted typed answers (exact program output for predict-the-output). Empty when options are used."),
  buggyLines: z.array(z.number().int()).describe("Spot the bug: 1-based numbers of the faulty lines. Empty otherwise."),
  explanation: z.string().describe("Why the answer is right, in two to four sentences."),
  hints: z.array(z.string()).describe("Two hints, vaguer first, that never state the answer."),
});
export type DraftQuestion = z.infer<typeof draftQuestionSchema>;

export interface DraftInput {
  skill: string;
  typeLabel: string;
  typeGuide: string;
  language: string;
  difficulty: 1 | 2 | 3;
  count: number;
  guidance?: string;
}

const perLanguage = (what: string) =>
  z.object({
    python: z.string().describe(`${what} in Python 3.`),
    c: z.string().describe(`${what} in C (C11, stdio.h).`),
    java: z.string().describe(`${what} in Java, in a public class Main.`),
  });

export const codingProblemSchema = z.object({
  stem: z.string().describe("The problem statement, including the exact input and output format and any limits."),
  testInputs: z.array(z.object({ input: z.string().describe("Exact stdin, lines separated by \\n."), hidden: z.boolean() })).describe("2 visible sample inputs, then 4 to 6 hidden inputs including edge cases."),
  solutions: perLanguage("A correct, complete solution reading stdin and writing stdout"),
  starterCode: perLanguage("Starter code that reads the input but leaves the logic to the student"),
  explanation: z.string().describe("The approach in two to four sentences, with its time complexity."),
  hints: z.array(z.string()).describe("Two hints, vaguer first, that never give the solution."),
});
export type DraftCodingProblem = z.infer<typeof codingProblemSchema>;

export const sqlProblemSchema = z.object({
  stem: z.string().describe("The task, naming the columns and order expected in the result."),
  schema: z.string().describe("CREATE TABLE and INSERT statements (SQLite) with 5 to 15 rows per table, including rows that catch common mistakes."),
  solution: z.string().describe("A correct SQLite query."),
  ordered: z.boolean().describe("True only if the stem asks for a specific row order (ORDER BY)."),
  explanation: z.string().describe("Why the query works, in two to four sentences."),
  hints: z.array(z.string()).describe("Two hints, vaguer first, that never give the query."),
});
export type DraftSqlProblem = z.infer<typeof sqlProblemSchema>;

export interface ProblemDraftInput {
  skill: string;
  difficulty: 1 | 2 | 3;
  count: number;
  guidance?: string;
}

export const snapshotReviewSchema = z.object({
  faces: z.number().int().describe("Number of human faces visible."),
  phone: z.boolean().describe("A mobile phone or similar device is visible."),
  otherPerson: z.boolean().describe("Someone other than the test taker appears to be present or helping."),
  note: z.string().describe("One short sentence describing anything a proctor should look at, or empty."),
});
export type SnapshotReview = z.infer<typeof snapshotReviewSchema>;

export interface AiProvider {
  coachHint(input: CoachHintInput): Promise<AiResult<string>>;
  draftQuestions(input: DraftInput): Promise<AiResult<DraftQuestion[]>>;
  draftCodingProblems(input: ProblemDraftInput): Promise<AiResult<DraftCodingProblem[]>>;
  draftSqlProblems(input: ProblemDraftInput): Promise<AiResult<DraftSqlProblem[]>>;
  reviewSnapshot(input: { image: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<AiResult<SnapshotReview>>;
}

export class AiUnavailableError extends Error {}

const COACH_SYSTEM = `You are a patient coding coach inside PlayCode, a practice app for engineering students preparing for campus placements.
A student is stuck on a short practice question and asked for a hint.

Rules:
- Never state the answer, the correct option, the program's output, the faulty line number, or a full working solution. The student must still do the final step.
- Give one hint of one to three sentences. Point at the concept or the part of the code to look at, or ask a guiding question.
- Each new hint may be a little more specific than the hints the student has already seen, but must not repeat them.
- If the student shared their code, refer to it concretely (for example a variable or a loop condition), but do not rewrite it for them.
- Plain text only, no markdown headings. Use backticks for code.`;

const DRAFT_SYSTEM = `You write practice questions for PlayCode, a gamified coding practice app used by engineering colleges for placement preparation.
Questions are short (answerable in under two minutes), unambiguous, and test one idea.
Code must be complete and compile as written for the stated language (C with stdio.h, Java with a Main class, Python 3), unless the question is about a compile error.
For "predict the output" questions, the accepted answer must be exactly what the program prints, with lines separated by a single space.
Use realistic placement-test style and Indian English. Avoid trick questions that depend on undefined behaviour.`;

const SNAPSHOT_SYSTEM = `You review webcam snapshots taken during an online proctored test for a proctor. Report only what is visible.
Count human faces (including partial faces and faces on screens or photos in view). Flag a phone or similar device if one is visible.
Flag another person if someone besides the test taker appears to be present or helping. Do not guess identity, age, or any personal trait.`;

function usageOf(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }): AiUsage {
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0 };
}

class ClaudeProvider implements AiProvider {
  private client = new Anthropic({ maxRetries: 2 });

  // Server-side fallback: if a request is declined, the API retries it on the recommended model.
  private readonly common = { model: AI_MODEL, betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const };

  async coachHint(input: CoachHintInput) {
    const parts = [
      `Question type: ${input.typeLabel} (${input.language})`,
      `Question: ${input.stem}`,
      input.code ? `Code:\n${input.code}` : "",
      input.options?.length ? `Options:\n${input.options.map((o) => `${o.id}) ${o.text}`).join("\n")}` : "",
      `Correct answer (do not reveal): ${input.answer}`,
      `Explanation (do not reveal): ${input.explanation}`,
      input.previousHints.length ? `Hints already shown:\n${input.previousHints.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "No hints shown yet.",
      input.draft ? `The student's current attempt:\n${input.draft.source}${input.draft.feedback ? `\n\nSample test results: ${input.draft.feedback}` : ""}` : "",
      "Write the next hint.",
    ].filter(Boolean);
    const res = await this.client.beta.messages.create(
      {
        ...this.common,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: [{ type: "text", text: COACH_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: parts.join("\n\n") }],
      },
      { timeout: 60_000 },
    );
    if (res.stop_reason === "refusal") throw new AiUnavailableError("The coach could not help with this question");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!text) throw new AiUnavailableError("The coach had nothing to say. Try again.");
    return { value: text, usage: usageOf(res.usage) };
  }

  async draftQuestions(input: DraftInput) {
    const res = await this.client.beta.messages.parse(
      {
        ...this.common,
        max_tokens: 16000,
        output_config: { effort: "high", format: betaZodOutputFormat(z.object({ questions: z.array(draftQuestionSchema) })) },
        system: [{ type: "text", text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              `Write ${input.count} different "${input.typeLabel}" questions.`,
              `Skill: ${input.skill}. Language: ${input.language}. Difficulty: ${["", "easy", "medium", "hard"][input.difficulty]}.`,
              `Format for this type: ${input.typeGuide}`,
              input.guidance ? `Author's notes: ${input.guidance}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      { timeout: 300_000 },
    );
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new AiUnavailableError("Could not draft questions for this request");
    return { value: res.parsed_output.questions, usage: usageOf(res.usage) };
  }

  // Coding problems carry three solutions and three starters each, so they stream (long output).
  async draftCodingProblems(input: ProblemDraftInput) {
    const message = await this.client.beta.messages
      .stream(
        {
          ...this.common,
          max_tokens: 64000,
          output_config: { effort: "high", format: betaZodOutputFormat(z.object({ problems: z.array(codingProblemSchema) })) },
          system: [{ type: "text", text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: [
                `Write ${input.count} different stdin/stdout coding problems for placement tests.`,
                `Skill: ${input.skill}. Difficulty: ${["", "easy", "medium", "hard"][input.difficulty]}.`,
                "Inputs must be small enough to run in well under a second. Output must be deterministic, with no trailing spaces. The three solutions must print exactly the same thing.",
                input.guidance ? `Author's notes: ${input.guidance}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
        { timeout: 600_000 },
      )
      .finalMessage();
    if (message.stop_reason === "refusal" || !message.parsed_output) throw new AiUnavailableError("Could not draft problems for this request");
    return { value: message.parsed_output.problems, usage: usageOf(message.usage) };
  }

  async draftSqlProblems(input: ProblemDraftInput) {
    const res = await this.client.beta.messages.parse(
      {
        ...this.common,
        max_tokens: 16000,
        output_config: { effort: "high", format: betaZodOutputFormat(z.object({ problems: z.array(sqlProblemSchema) })) },
        system: [{ type: "text", text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              `Write ${input.count} different SQL query problems for placement tests, runnable on SQLite.`,
              `Skill: ${input.skill}. Difficulty: ${["", "easy", "medium", "hard"][input.difficulty]}.`,
              input.guidance ? `Author's notes: ${input.guidance}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      { timeout: 300_000 },
    );
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new AiUnavailableError("Could not draft problems for this request");
    return { value: res.parsed_output.problems, usage: usageOf(res.usage) };
  }

  async reviewSnapshot(input: { image: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" }) {
    const res = await this.client.beta.messages.parse(
      {
        ...this.common,
        max_tokens: 2000,
        output_config: { effort: "low", format: betaZodOutputFormat(snapshotReviewSchema) },
        system: [{ type: "text", text: SNAPSHOT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.image.toString("base64") } },
              { type: "text", text: "Review this snapshot." },
            ],
          },
        ],
      },
      { timeout: 60_000 },
    );
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new AiUnavailableError("Could not review this snapshot");
    return { value: res.parsed_output, usage: usageOf(res.usage) };
  }
}

let override: AiProvider | null | undefined;
let claude: ClaudeProvider | undefined;

/** Tests (and local demos) can plug in a fake provider; pass undefined to go back to the real one. */
export function setAiProvider(provider: AiProvider | null | undefined): void {
  override = provider;
}

/** The provider, or null when AI is switched off or no Anthropic credentials are configured. */
export function aiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  if (process.env.AI_ENABLED === "false") return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return (claude ??= new ClaudeProvider());
}
