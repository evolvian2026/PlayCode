import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CODING_QUESTIONS } from "../src/content/coding";
import { db, pool } from "../src/db/client";
import { executionJobs } from "../src/db/schema";
import { runProgram, setExecutionMode } from "../src/execution";
import { startWorker, sweepJobs } from "../src/execution/job-queue";
import { LocalRunner } from "../src/execution/local-runner";
import type { Runner } from "../src/execution/types";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let worker: ReturnType<typeof startWorker> | null = null;

beforeAll(async () => {
  t = await setup();
  setExecutionMode("queue");
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
});

afterAll(async () => {
  setExecutionMode("inline");
  await t.app.close();
  await pool.end();
});

describe("execution queue", () => {
  it("runs code on a worker and returns the outcome to the waiting request", async () => {
    worker = startWorker({ db, runner: new LocalRunner(), concurrency: 2, idleMs: 20 });
    const [out] = await runProgram("python", "print(input()[::-1])", ["queue"]);
    expect(out).toMatchObject({ status: "ok", stdout: "eueuq\n" });
    const [job] = await db.select().from(executionJobs).where(eq(executionJobs.source, "print(input()[::-1])"));
    expect(job).toMatchObject({ status: "done", attempts: 1, workerId: worker.workerId });
  });

  it("serves a student's code submission end to end", async () => {
    worker = startWorker({ db, runner: new LocalRunner(), concurrency: 2, idleMs: 20 });
    const tpo = await t.login("tpo@demo.edu");
    const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
    await t.post(tpo, "/console/students/import", { unitId: units.find((u) => u.name === "CSE 2027 - A")!.id, csv: "Queue Coder,queue.coder@demo.edu,Q1", defaultPassword: "student-pass-1" });
    const token = await t.login("queue.coder@demo.edu", "student-pass-1");
    const s = (await t.post(token, "/student/sessions", { kind: "skill", skillId: "coding.basics" })).body;
    const q = CODING_QUESTIONS.find((p) => p.id === s.question.id)!;
    const res = await t.post(token, `/student/sessions/${s.id}/answer`, { questionId: q.id, response: { kind: "code", language: "python", source: q.solutions!.python! }, timeMs: 60_000 });
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
  });

  it("takes tests and contests before duels before practice", async () => {
    await db.delete(executionJobs);
    await db.insert(executionJobs).values([
      { priority: 2, language: "python", source: "practice", inputs: [""] },
      { priority: 0, language: "python", source: "test", inputs: [""] },
      { priority: 1, language: "python", source: "duel", inputs: [""] },
    ]);
    const order: string[] = [];
    const recorder: Runner = {
      name: "recorder",
      async run(_language, source) {
        order.push(source);
        return [{ status: "ok", stdout: "", stderr: "", timeMs: 1 }];
      },
    };
    worker = startWorker({ db, runner: recorder, concurrency: 1, idleMs: 20 });
    while (order.length < 3) await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["test", "duel", "practice"]);
  });

  it("retries a job that throws, then reports the failure", async () => {
    let calls = 0;
    const broken: Runner = {
      name: "broken",
      async run() {
        calls++;
        throw new Error("sandbox unavailable");
      },
    };
    worker = startWorker({ db, runner: broken, concurrency: 1, idleMs: 20 });
    await expect(runProgram("python", "print(1)", [""])).rejects.toMatchObject({ statusCode: 503, code: "runner_failed" });
    expect(calls).toBe(3);
  });

  it("puts back jobs whose worker died, and deletes old finished ones", async () => {
    await db.delete(executionJobs);
    const old = new Date(Date.now() - 10 * 60_000);
    const [lost] = await db.insert(executionJobs).values({ priority: 2, language: "python", source: "lost", inputs: [""], status: "running", attempts: 1, startedAt: old }).returning();
    const [hopeless] = await db.insert(executionJobs).values({ priority: 2, language: "python", source: "hopeless", inputs: [""], status: "running", attempts: 3, startedAt: old }).returning();
    await db.insert(executionJobs).values({ priority: 2, language: "python", source: "old", inputs: [""], status: "done", finishedAt: new Date(Date.now() - 2 * 86_400_000) });
    expect(await sweepJobs(db)).toEqual({ requeued: 1, failed: 1, pruned: 1 });
    expect((await db.select().from(executionJobs).where(eq(executionJobs.id, lost!.id)))[0]!.status).toBe("queued");
    expect((await db.select().from(executionJobs).where(eq(executionJobs.id, hopeless!.id)))[0]!.status).toBe("failed");
  });
});
