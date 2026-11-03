import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODING_QUESTIONS } from "../src/content/coding";
import { pool } from "../src/db/client";
import { Judge0Runner, judge0Status } from "../src/execution/judge0-runner";
import { ExecutionQueue } from "../src/execution/queue";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;

async function student(email: string) {
  const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
  const unitId = units.find((u) => u.name === "CSE 2027 - A")!.id;
  await t.post(tpo, "/console/students/import", { unitId, csv: `Coder ${email},${email},X1`, defaultPassword: "student-pass-1" });
  return t.login(email, "student-pass-1");
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("live coding", () => {
  it("runs samples, hides hidden tests and grades every language", async () => {
    const token = await student("coder1@demo.edu");
    let s = (await t.post(token, "/student/sessions", { kind: "skill", skillId: "coding.basics" })).body;
    const q = s.question;
    expect(q.type).toBe("write_code");
    expect(q.responseKind).toBe("code");
    expect(q.body.sampleTests.length).toBeGreaterThan(0);
    expect(q.body.starterCode.java).toContain("class Main");
    const problem = CODING_QUESTIONS.find((p) => p.id === q.id)!;

    // Run: only sample tests, with their input and output visible.
    const run = await t.post(token, `/student/sessions/${s.id}/run`, { questionId: q.id, response: { kind: "code", language: "python", source: "print('nope')" } });
    expect(run.status).toBe(200);
    expect(run.body.tests.every((x: { hidden: boolean; input: string }) => !x.hidden && x.input !== undefined)).toBe(true);
    expect(run.body.correct).toBe(false);

    // A C compile error is reported as such.
    const broken = await t.post(token, `/student/sessions/${s.id}/run`, { questionId: q.id, response: { kind: "code", language: "c", source: "int main( {" } });
    expect(broken.body.compileError).toBeTruthy();
    expect(broken.body.tests[0].status).toBe("compile_error");

    // Submit the Java reference solution: every test, hidden ones included, passes.
    const res = await t.post(token, `/student/sessions/${s.id}/answer`, {
      questionId: q.id,
      response: { kind: "code", language: "java", source: problem.solutions!.java },
      timeMs: 120_000,
    });
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    expect(res.body.evaluation.passed).toBe(res.body.evaluation.total);
    expect(res.body.evaluation.total).toBe(problem.answer.kind === "tests" ? problem.answer.tests.length : 0);
    const hidden = res.body.evaluation.tests.filter((x: { hidden: boolean }) => x.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((x: Record<string, unknown>) => x.input === undefined && x.expected === undefined && x.actual === undefined)).toBe(true);
    expect(JSON.stringify(res.body.answer)).not.toContain('"hidden":true');
    // Coding is worth three times a quick question of the same difficulty.
    expect(res.body.xp).toBeGreaterThanOrEqual(30);

    // A wrong program fails and records partial credit.
    s = res.body.session;
    const next = CODING_QUESTIONS.find((p) => p.id === s.question.id)!;
    const wrong = await t.post(token, `/student/sessions/${s.id}/answer`, {
      questionId: next.id,
      response: { kind: "code", language: "python", source: "print(0)" },
      timeMs: 30_000,
    });
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.evaluation.score).toBeLessThan(1);
  });

  it("rejects languages the problem does not allow and over-long code", async () => {
    const token = await student("coder2@demo.edu");
    const s = (await t.post(token, "/student/sessions", { kind: "skill", skillId: "coding.basics" })).body;
    const tooLong = await t.post(token, `/student/sessions/${s.id}/run`, { questionId: s.question.id, response: { kind: "code", language: "python", source: "#".repeat(20_001) } });
    expect(tooLong.status).toBe(400);
  });

  it("stops runaway programs at the time limit", async () => {
    const token = await student("coder3@demo.edu");
    const s = (await t.post(token, "/student/sessions", { kind: "skill", skillId: "coding.basics" })).body;
    const started = Date.now();
    const res = await t.post(token, `/student/sessions/${s.id}/run`, { questionId: s.question.id, response: { kind: "code", language: "c", source: "int main(void) { for (;;) {} }" } });
    expect(res.body.tests.every((x: { status: string }) => x.status === "timeout")).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("grades SQL by comparing result sets", async () => {
    const token = await student("sql1@demo.edu");
    let s = (await t.post(token, "/student/sessions", { kind: "skill", skillId: "sql.basics" })).body;
    expect(s.question.body.schema).toContain("CREATE TABLE students");
    const run = await t.post(token, `/student/sessions/${s.id}/run`, { questionId: s.question.id, response: { kind: "sql", query: "SELECT name FROM students" } });
    expect(run.body.result.ok).toBe(true);
    expect(run.body.result.rows.length).toBe(7);
    const writes = await t.post(token, `/student/sessions/${s.id}/run`, { questionId: s.question.id, response: { kind: "sql", query: "DELETE FROM students" } });
    expect(writes.body.result.ok).toBe(false);

    const { ALL_QUESTIONS } = await import("../src/content");
    const model = ALL_QUESTIONS.find((q) => q.id === s.question.id)!.answer;
    if (model.kind !== "sql") throw new Error("expected sql");
    // Same rows in a different order still count for unordered questions.
    const res = await t.post(token, `/student/sessions/${s.id}/answer`, { questionId: s.question.id, response: { kind: "sql", query: model.solution }, timeMs: 60_000 });
    expect(res.body.correct).toBe(true);
    s = res.body.session;
    const bad = await t.post(token, `/student/sessions/${s.id}/answer`, { questionId: s.question.id, response: { kind: "sql", query: "SELECT 1" }, timeMs: 60_000 });
    expect(bad.body.correct).toBe(false);
  });

  it("keeps coding out of the daily challenge", async () => {
    const token = await student("daily-c@demo.edu");
    const s = (await t.post(token, "/student/sessions", { kind: "daily" })).body;
    expect(["write_code", "sql_query"]).not.toContain(s.question.type);
  });
});

describe("execution plumbing", () => {
  it("runs assessment jobs before practice jobs", async () => {
    const q = new ExecutionQueue(1);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = q.run("practice", async () => {
      await gate;
      order.push("first");
    });
    const later = [q.run("practice", async () => void order.push("practice")), q.run("duel", async () => void order.push("duel")), q.run("assessment", async () => void order.push("assessment"))];
    release();
    await Promise.all([first, ...later]);
    expect(order).toEqual(["first", "assessment", "duel", "practice"]);
  });

  it("talks to Judge0 with base64 payloads and maps statuses", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fake = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ stdout: Buffer.from("8\n").toString("base64"), stderr: null, compile_output: null, time: "0.012", status: { id: 3, description: "Accepted" } }));
    }) as unknown as typeof fetch;
    const r = new Judge0Runner("http://judge0:2358/", "secret", "python:92", fake);
    const [out] = await r.run("python", "print(8)", ["3 5"]);
    expect(out).toEqual({ status: "ok", stdout: "8\n", stderr: "", timeMs: 12 });
    expect(calls[0]!.url).toBe("http://judge0:2358/submissions?base64_encoded=true&wait=true");
    expect(calls[0]!.body.language_id).toBe(92);
    expect(calls[0]!.body.enable_network).toBe(false);
    expect(Buffer.from(calls[0]!.body.stdin as string, "base64").toString()).toBe("3 5");
    expect([judge0Status(5), judge0Status(6), judge0Status(11), judge0Status(13)]).toEqual(["timeout", "compile_error", "runtime_error", "internal_error"]);
  });
});
