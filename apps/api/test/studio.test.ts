import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setAiProvider, type AiProvider, type DraftInput } from "../src/lib/ai";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let hod: string;
const draftCalls: DraftInput[] = [];

const fake: AiProvider = {
  async coachHint() {
    throw new Error("not used");
  },
  async draftQuestions(input) {
    draftCalls.push(input);
    const base = { options: [], correctOptionId: "", buggyLines: [], explanation: "range(1, 4) gives 1, 2 and 3.", hints: ["How many times does the loop run?", "range stops before its end."] };
    return {
      value: [
        { ...base, stem: "What does this print?", code: "total = 0\nfor i in range(1, 4):\n    total += i\nprint(total)", acceptedAnswers: ["6"] },
        { ...base, stem: "What does this print?", code: "print(len('placement'))", acceptedAnswers: ["8"] }, // wrong: it prints 9
      ],
      usage: { inputTokens: 2000, outputTokens: 900, cacheReadTokens: 0 },
    };
  },
  async reviewSnapshot() {
    throw new Error("not used");
  },
};

const predict = (answer: string) => ({
  type: "predict_output",
  skillId: "loops.for",
  difficulty: 1,
  body: { stem: "What does this print?", code: "for i in range(3):\n    print(i * 2, end=' ')\n", language: "python" },
  answer: { kind: "text", accepted: [answer] },
  explanation: "i takes 0, 1, 2, so it prints 0 2 4.",
  hints: ["range(3) starts at 0."],
  tags: ["Loops"],
  checkMode: "run",
});

beforeAll(async () => {
  t = await setup();
  hod = await t.login("hod.cse@demo.edu");
  setAiProvider(fake);
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("content studio", () => {
  let id: string;

  it("runs output questions before they go live", async () => {
    const created = await t.post(hod, "/console/studio/questions", predict("0 2 5"));
    expect(created.status).toBe(200);
    id = created.body.question.id;
    expect(created.body.question).toMatchObject({ status: "draft", origin: "studio", tags: ["loops"] });
    expect(id).toMatch(/^inst-loops-for-/);

    const blocked = await t.post(hod, `/console/studio/questions/${id}/status`, { status: "live" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.message).toContain('prints "0 2 4"');

    await t.put(hod, `/console/studio/questions/${id}`, predict("0 2 4"));
    const live = await t.post(hod, `/console/studio/questions/${id}/status`, { status: "live" });
    expect(live.status).toBe(200);
    expect(live.body.question.status).toBe("live");
    expect(live.body.question.lastCheck).toMatchObject({ ok: true, output: "0 2 4" });
  });

  it("keeps private questions inside the institution", async () => {
    const admin = await t.login("admin@demo.edu");
    const bank = (await t.get(admin, "/console/questions?skillId=loops.for")).body.questions as { id: string; owner: string }[];
    expect(bank.find((q) => q.id === id)?.owner).toBe("institution");

    const other = await t.login("admin@sunrise.edu");
    expect((await t.get(other, `/console/studio/questions/${id}`)).status).toBe(404);
    expect(((await t.get(other, "/console/questions?skillId=loops.for")).body.questions as { id: string }[]).some((q) => q.id === id)).toBe(false);
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, "/console/studio/questions")).status).toBe(403);
  });

  it("refuses an edit that would break a live question", async () => {
    const res = await t.put(hod, `/console/studio/questions/${id}`, predict("0 1 2"));
    expect(res.status).toBe(422);
    expect((await t.get(hod, `/console/studio/questions/${id}`)).body.question.answer.accepted).toEqual(["0 2 4"]);
    const retired = await t.post(hod, `/console/studio/questions/${id}/status`, { status: "retired" });
    expect(retired.body.question.status).toBe("retired");
  });

  it("runs reference solutions for coding problems", async () => {
    const problem = {
      type: "write_code",
      skillId: "loops.for",
      difficulty: 2,
      body: { stem: "Read n and print the sum 1 + 2 + ... + n.", language: "python", languages: ["python", "c"], starterCode: { python: "n = int(input())\n" } },
      answer: { kind: "tests", tests: [{ input: "3\n", output: "6\n", hidden: false }, { input: "10\n", output: "55\n", hidden: true }] },
      explanation: "Use a loop or n(n+1)/2.",
      solutions: { python: "n = int(input())\nprint(n * (n + 1) // 2)\n" },
    };
    const check = await t.post(hod, "/console/studio/check", problem);
    expect(check.body.check.ok).toBe(false);
    expect(check.body.check.problems).toContain("Add a reference solution in c");

    const wrong = await t.post(hod, "/console/studio/check", { ...problem, body: { ...problem.body, languages: ["python"] }, solutions: { python: "n = int(input())\nprint(n * n)\n" } });
    expect(wrong.body.check.problems.join()).toContain("python solution fails test 1");

    const ok = await t.post(hod, "/console/studio/check", { ...problem, body: { ...problem.body, languages: ["python"] } });
    expect(ok.body.check).toMatchObject({ ok: true, problems: [] });
  });

  it("drafts questions with AI and checks each one", async () => {
    const res = await t.post(hod, "/console/studio/draft", { type: "predict_output", skillId: "loops.for", language: "python", difficulty: 1, count: 2, guidance: "Use range" });
    expect(res.status).toBe(200);
    expect(draftCalls[0]).toMatchObject({ skill: "Loops: For loops", typeLabel: "Predict the output", language: "Python 3", count: 2, guidance: "Use range" });
    const [good, bad] = res.body.drafts;
    expect(good.check).toMatchObject({ ok: true, output: "6" });
    expect(good.input).toMatchObject({ origin: "ai", checkMode: "run", answer: { kind: "text", accepted: ["6"] } });
    expect(bad.check.ok).toBe(false);
    expect(bad.check.problems[0]).toContain('prints "9"');

    const saved = await t.post(hod, "/console/studio/questions", good.input);
    expect(saved.body.question.origin).toBe("ai");
    expect((await t.post(hod, "/console/studio/draft", { type: "write_code", skillId: "loops.for", language: "python", difficulty: 1 })).status).toBe(400);
  });

  it("gives the platform content team the global bank", async () => {
    const admin = await t.login("superadmin@playcode.dev");
    expect((await t.get(admin, "/console/studio")).body).toMatchObject({ bank: "global", ai: true });
    const all = (await t.get(admin, "/console/studio/questions?status=live")).body.questions as { origin: string }[];
    expect(all.length).toBeGreaterThan(40);
    expect(all.every((q) => q.origin === "seed")).toBe(true);
  });
});
