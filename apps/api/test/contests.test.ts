import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODING_QUESTIONS } from "../src/content/coding";
import { db, pool } from "../src/db/client";
import { tenants } from "../src/db/schema";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let units: { id: string; name: string }[];
const MIN = 60_000;
const at = (minutes: number) => new Date(START.getTime() + minutes * MIN);
const solution = (id: string) => CODING_QUESTIONS.find((q) => q.id === id)!.solutions!.python!;
const code = (source: string) => ({ kind: "code", language: "python", source });

async function student(email: string, unit = "CSE 2027 - A") {
  await t.post(tpo, "/console/students/import", { unitId: units.find((u) => u.name === unit)!.id, csv: `Contest ${email.split("@")[0]} Coder,${email},X-${email}`, defaultPassword: "student-pass-1" });
  return t.login(email, "student-pass-1");
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  units = (await t.get(tpo, "/console/org-units")).body.units;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("coding contests", () => {
  let id: string;
  let ana: string;
  let ben: string;
  let cai: string;
  const submit = (token: string, questionId: string, source: string) => t.post(token, `/student/contests/${id}/submit`, { questionId, response: code(source) });

  it("lets staff set one up for chosen batches and tells the students", async () => {
    const base = { title: "CSE coding cup", problemIds: ["code-sum-two", "code-even-odd"], audienceIds: [units.find((u) => u.name === "CSE 2027 - A")!.id], startsAt: at(60), endsAt: at(180), freezeMinutes: 30 };
    expect((await t.post(tpo, "/console/contests", { ...base, problemIds: ["py-basics-ops-1"] })).status).toBe(400); // not a coding problem
    expect((await t.post(tpo, "/console/contests", { ...base, endsAt: at(70) })).status).toBe(400); // too short
    ana = await student("ana.contest@demo.edu");
    ben = await student("ben.contest@demo.edu");
    cai = await student("cai.contest@demo.edu");
    const res = await t.post(tpo, "/console/contests", base);
    expect(res.status).toBe(200);
    id = res.body.id;
    const inbox = (await t.get(ana, "/student/notifications")).body.items;
    expect(inbox[0].title).toBe("Coding contest: CSE coding cup");
    expect((await t.get(ana, "/student/contests")).body.contests[0]).toMatchObject({ id, state: "upcoming", problems: 2, solved: 0 });
    // Students outside the chosen batches can't see it.
    const ece = await student("eve.contest@demo.edu", "ECE 2027 - A");
    expect((await t.get(ece, `/student/contests/${id}`)).status).toBe(404);
  });

  it("hides the problems until the start", async () => {
    const view = (await t.get(ana, `/student/contests/${id}`)).body;
    expect(view.state).toBe("upcoming");
    expect(view.problems.map((p: { letter: string; question: unknown }) => [p.letter, p.question])).toEqual([["A", null], ["B", null]]);
    expect((await submit(ana, "code-sum-two", "print(1)")).status).toBe(400);
  });

  it("judges every submission on all tests and keeps an ICPC scoreboard", async () => {
    t.clock.now = at(65);
    const view = (await t.get(ana, `/student/contests/${id}`)).body;
    expect(view.state).toBe("live");
    expect(view.problems[0].question.body.sampleTests.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain("1000000000"); // hidden test input

    // Run checks the samples only and records nothing.
    const run = await t.post(ana, `/student/contests/${id}/run`, { questionId: "code-sum-two", response: code(solution("code-sum-two")) });
    expect(run.body.correct).toBe(true);

    let res = await submit(ana, "code-sum-two", "a, b = map(int, input().split())\nprint(a - b)");
    expect(res.body).toMatchObject({ verdict: "wrong_answer", total: 4 });
    expect((await submit(ana, "code-sum-two", "print(")).body.verdict).toBe("runtime_error");
    t.clock.now = at(70);
    res = await submit(ana, "code-sum-two", solution("code-sum-two"));
    expect(res.body).toMatchObject({ verdict: "accepted", passed: 4, total: 4 });
    t.clock.now = at(80);
    await submit(ben, "code-sum-two", solution("code-sum-two"));
    await submit(ben, "code-even-odd", solution("code-even-odd"));
    await submit(cai, "code-sum-two", solution("code-sum-two")); // the same code as ben's

    const board = (await t.get(ana, `/student/contests/${id}`)).body.scoreboard;
    expect(board.frozen).toBe(false);
    // ben: 2 solved at minute 20 (40 penalty); ana: 1 at minute 10 + 2 rejected tries (50).
    expect(board.rows.map((r: { name: string; solved: number; penalty: number; rank: number }) => [r.name, r.rank, r.solved, r.penalty])).toEqual([
      ["Contest ben.contest Coder", 1, 2, 40],
      ["Contest cai.contest Coder", 2, 1, 20],
      ["Contest ana.contest Coder", 3, 1, 50],
    ]);
    expect(board.rows.find((r: { me: boolean }) => r.me).name).toBe("Contest ana.contest Coder");
    expect(JSON.stringify(board)).not.toContain("userId");
  });

  it("freezes the public scoreboard for the last minutes, but not for staff", async () => {
    t.clock.now = at(160); // the last 30 minutes
    await submit(ana, "code-even-odd", solution("code-even-odd"));
    const view = (await t.get(ana, `/student/contests/${id}`)).body;
    expect(view.state).toBe("frozen");
    expect(view.scoreboard.frozen).toBe(true);
    const mine = view.scoreboard.rows.find((r: { me: boolean }) => r.me);
    expect(mine.solved).toBe(1);
    expect(mine.problems["code-even-odd"].pending).toBe(1);
    expect(view.problems[1].solved).toBe(true); // a student always sees their own verdicts
    const staff = (await t.get(tpo, `/console/contests/${id}`)).body;
    expect(staff.scoreboard.find((r: { name: string }) => r.name === "Contest ana.contest Coder").solved).toBe(2);
    expect(staff.problems[1]).toMatchObject({ letter: "B", solvedBy: 2 });
  });

  it("unfreezes at the end, closes submissions and checks for copied code", async () => {
    expect((await t.get(tpo, `/console/contests/${id}/similarity`)).status).toBe(409);
    t.clock.now = at(181);
    expect((await submit(ana, "code-sum-two", solution("code-sum-two"))).status).toBe(400);
    const view = (await t.get(ana, `/student/contests/${id}`)).body;
    expect(view).toMatchObject({ state: "ended", scoreboard: { frozen: false } });
    // The frozen solve now counts: ana has 2 solved, with 50 + 100 = 150 penalty minutes, behind ben's 40.
    expect(view.scoreboard.rows.map((r: { name: string; rank: number; solved: number; penalty: number }) => [r.name, r.rank, r.solved, r.penalty]).slice(0, 2)).toEqual([
      ["Contest ben.contest Coder", 1, 2, 40],
      ["Contest ana.contest Coder", 2, 2, 150],
    ]);
    const sim = (await t.get(tpo, `/console/contests/${id}/similarity`)).body.pairs;
    expect(sim.length).toBeGreaterThan(0);
    expect(sim[0]).toMatchObject({ letter: "A", similarityPct: 100 });
    expect((await t.get(tpo, "/console/contests")).body.contests[0]).toMatchObject({ id, state: "ended", participants: 3 });
  });

  it("runs inter-college contests for PlayCode, with short names across colleges", async () => {
    t.clock.now = START;
    const admin = await t.login("superadmin@playcode.dev");
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    const [acme] = await db.select().from(tenants).where(eq(tenants.slug, "acme"));
    const base = { title: "PlayCode open", problemIds: ["code-sum-two"], startsAt: at(1), endsAt: at(61), freezeMinutes: 0 };
    expect((await t.post(admin, "/console/contests", { ...base, audienceIds: [acme!.id] })).status).toBe(400); // a company isn't a college
    const res = await t.post(admin, "/console/contests", { ...base, audienceIds: [demo!.id] });
    expect(res.status).toBe(200);
    const riya = await t.login("student@demo.edu");
    expect((await t.get(riya, "/student/contests")).body.contests.some((c: { id: string; byPlayCode: boolean }) => c.id === res.body.id && c.byPlayCode)).toBe(true);
    expect((await t.get(await t.login("sunrise.student1@sunrise.edu"), `/student/contests/${res.body.id}`)).status).toBe(404);
    t.clock.now = at(5);
    await t.post(riya, `/student/contests/${res.body.id}/submit`, { questionId: "code-sum-two", response: code(solution("code-sum-two")) });
    const row = (await t.get(riya, `/student/contests/${res.body.id}`)).body.scoreboard.rows[0];
    expect(row).toMatchObject({ name: "Riya K.", college: "Demo Institute of Technology", rollNo: null });
    // The college's staff see it, with full names of their own students.
    expect((await t.get(tpo, `/console/contests/${res.body.id}`)).body.scoreboard[0].name).toBe("Riya Kapoor");
  });
});
