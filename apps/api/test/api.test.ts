import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let hod: string;
let unitIds: Record<string, string>;

/** Import a fresh student into a section and sign in as them. */
async function newStudent(section: string, email: string) {
  const res = await t.post(tpo, "/console/students/import", { unitId: unitIds[section], csv: `name,email,roll\nTest ${email},${email},R-${email}`, defaultPassword: "student-pass-1" });
  expect(res.status).toBe(200);
  return t.login(email, "student-pass-1");
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  hod = await t.login("hod.cse@demo.edu");
  const units = await t.get(tpo, "/console/org-units");
  unitIds = Object.fromEntries(units.body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("auth", () => {
  it("rejects bad credentials and returns identity for good ones", async () => {
    expect((await t.post("", "/auth/login", { email: "tpo@demo.edu", password: "nope" })).status).toBe(401);
    const me = await t.get(tpo, "/me");
    expect(me.status).toBe(200);
    expect(me.body.user.roles).toEqual(["tpo"]);
    expect(me.body.home).toBe("console");
    expect((await t.get("", "/me")).status).toBe(401);
    expect((await t.get("garbage", "/me")).status).toBe(401);
  });
});

describe("student practice loop", () => {
  it("plays a daily challenge with XP, streak, mistakes and hints", async () => {
    const token = await newStudent("CSE 2027 - A", "loop1@demo.edu");
    const home = await t.get(token, "/student/home");
    expect(home.status).toBe(200);
    expect(home.body.profile.xp).toBe(0);
    expect(home.body.daily.started).toBe(false);

    let session = (await t.post(token, "/student/sessions", { kind: "daily" })).body;
    expect(session.total).toBe(5);
    expect(session.question).toBeTruthy();
    expect(JSON.stringify(session)).not.toContain('"answer"');

    // Out-of-order answers are refused.
    const wrongId = await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: "not-current", response: { kind: "text", value: "x" }, timeMs: 1000 });
    expect(wrongId.status).toBe(409);

    // First question right.
    const q1 = session.question.id;
    let res = await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: q1, response: rightAnswer(q1), timeMs: 30_000 });
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    expect(res.body.xp).toBeGreaterThan(0);
    expect(res.body.streakExtended).toBe(true);
    expect(res.body.profile.streak.days).toBe(1);
    session = res.body.session;

    // Second question: take a hint if it has one, then answer wrong.
    const q2 = session.question.id;
    if (session.question.hintCount > 0) {
      const hint = await t.post(token, `/student/sessions/${session.id}/hint`, { questionId: q2 });
      expect(hint.status).toBe(200);
      expect(hint.body.hint).toBeTruthy();
    }
    res = await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: q2, response: wrongAnswer(q2), timeMs: 30_000 });
    expect(res.body.correct).toBe(false);
    expect(res.body.xp).toBe(0);
    expect(res.body.explanation).toBeTruthy();
    session = res.body.session;

    while (!session.finished) {
      const qid = session.question.id;
      session = (await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 20_000 })).body.session;
    }
    expect(session.correctCount).toBe(4);
    expect(session.score).toBe(80);

    // Daily challenge is one per day.
    const again = await t.post(token, "/student/sessions", { kind: "daily" });
    expect(again.body.id).toBe(session.id);

    const mistakes = await t.get(token, "/student/mistakes");
    expect(mistakes.body.mistakes.map((m: { questionId: string }) => m.questionId)).toEqual([q2]);

    // The next day extends the streak.
    t.clock.now = new Date(START.getTime() + 86_400_000);
    const review = (await t.post(token, "/student/sessions", { kind: "mistakes" })).body;
    res = await t.post(token, `/student/sessions/${review.id}/answer`, { questionId: q2, response: rightAnswer(q2), timeMs: 10_000 });
    expect(res.body.correct).toBe(true);
    expect(res.body.profile.streak.days).toBe(2);
    expect((await t.get(token, "/student/mistakes")).body.mistakes).toEqual([]);
    t.clock.now = new Date(START);

    const league = await t.get(token, "/student/league");
    expect(league.body.joined).toBe(true);
    expect(league.body.members.some((m: { isMe: boolean }) => m.isMe)).toBe(true);
  });

  it("ends a skill session when hearts run out and blocks new ones", async () => {
    const token = await newStudent("CSE 2027 - A", "hearts1@demo.edu");
    let session = (await t.post(token, "/student/sessions", { kind: "skill", skillId: "complexity.bigo" })).body;
    expect(session.usesHearts).toBe(true);
    let res;
    for (let i = 0; i < 5; i++) {
      const qid = session.question.id;
      res = await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: qid, response: wrongAnswer(qid), timeMs: 5_000 });
      session = res.body.session;
    }
    expect(res!.body.profile.hearts).toBe(0);
    expect(session.finished).toBe(true);
    const blocked = await t.post(token, "/student/sessions", { kind: "skill", skillId: "loops.for" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("out_of_hearts");

    // Reviewing a mistake correctly earns a heart back.
    const review = (await t.post(token, "/student/sessions", { kind: "mistakes" })).body;
    const qid = review.question.id;
    res = await t.post(token, `/student/sessions/${review.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 5_000 });
    expect(res.body.profile.hearts).toBe(1);
    expect((await t.post(token, "/student/sessions", { kind: "skill", skillId: "loops.for" })).status).toBe(200);
  });

  it("lists the learn map and missions", async () => {
    const token = await t.login("student@demo.edu");
    const map = await t.get(token, "/student/map");
    expect(map.body.topics.length).toBeGreaterThan(5);
    const missions = await t.get(token, "/student/missions");
    expect(missions.body.missions[0].title).toContain("pseudocode");
    const profile = await t.get(token, "/student/profile");
    expect(profile.body.readiness).toHaveLength(2);
    expect(profile.body.badges.length).toBeGreaterThan(0);
  });
});

describe("console scope and permissions", () => {
  it("keeps students out of the console", async () => {
    const token = await t.login("student@demo.edu");
    expect((await t.get(token, "/console/students")).status).toBe(403);
    expect((await t.post(token, "/console/assignments", {})).status).toBe(403);
  });

  it("scopes faculty to their section and HOD to their department", async () => {
    const all = (await t.get(tpo, "/console/students")).body.students;
    const fac = (await t.get(faculty, "/console/students")).body.students;
    const hodStudents = (await t.get(hod, "/console/students")).body.students;
    expect(fac.length).toBeGreaterThan(0);
    expect(fac.every((s: { unitName: string }) => s.unitName === "CSE 2027 - A")).toBe(true);
    expect(hodStudents.every((s: { unitName: string }) => s.unitName.startsWith("CSE"))).toBe(true);
    expect(all.length).toBeGreaterThan(hodStudents.length);
    expect(hodStudents.length).toBeGreaterThan(fac.length);
    expect((await t.get(faculty, `/console/students?unitId=${unitIds["ECE 2027 - A"]}`)).status).toBe(403);
    const eceStudent = all.find((s: { unitName: string }) => s.unitName === "ECE 2027 - A");
    expect((await t.get(faculty, `/console/students/${eceStudent.id}`)).status).toBe(404);
  });

  it("refuses imports beyond the licence's seats", async () => {
    const csv = Array.from({ length: 600 }, (_, i) => `S${i},bulk${i}@demo.edu,B${i}`).join("\n");
    const res = await t.post(tpo, "/console/students/import", { unitId: unitIds["ECE 2027 - A"], csv });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("seats");
  });
});

describe("assignments", () => {
  it("reaches only the targeted section, once per student", async () => {
    const inA = await newStudent("CSE 2027 - A", "assign-a@demo.edu");
    const inEce = await newStudent("ECE 2027 - A", "assign-ece@demo.edu");
    const forbidden = await t.post(faculty, "/console/assignments", {
      title: "Not mine",
      skillIds: ["loops.for"],
      unitIds: [unitIds["ECE 2027 - A"]],
      openAt: new Date(START.getTime() - 3600_000).toISOString(),
      closeAt: new Date(START.getTime() + 86_400_000).toISOString(),
    });
    expect(forbidden.status).toBe(403);

    const created = await t.post(faculty, "/console/assignments", {
      title: "Arrays quiz",
      skillIds: ["arrays.basics", "arrays.search"],
      count: 3,
      unitIds: [unitIds["CSE 2027 - A"]],
      openAt: new Date(START.getTime() - 3600_000).toISOString(),
      closeAt: new Date(START.getTime() + 86_400_000).toISOString(),
    });
    expect(created.status).toBe(200);
    const id = created.body.assignment.id;
    expect(created.body.assignment.questionIds).toHaveLength(3);

    expect((await t.get(inEce, "/student/assignments")).body.assignments.some((a: { id: string }) => a.id === id)).toBe(false);
    expect((await t.post(inEce, "/student/sessions", { kind: "assignment", assignmentId: id })).status).toBe(403);

    const listed = (await t.get(inA, "/student/assignments")).body.assignments;
    expect(listed.find((a: { id: string }) => a.id === id).status).toBe("not_started");
    let session = (await t.post(inA, "/student/sessions", { kind: "assignment", assignmentId: id })).body;
    while (!session.finished) {
      const qid = session.question.id;
      session = (await t.post(inA, `/student/sessions/${session.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 10_000 })).body.session;
    }
    expect(session.score).toBe(100);
    expect(session.passed).toBe(true);
    expect((await t.post(inA, "/student/sessions", { kind: "assignment", assignmentId: id })).status).toBe(409);

    const report = await t.get(faculty, `/console/assignments/${id}`);
    expect(report.body.students.find((s: { name: string }) => s.name === "Test assign-a@demo.edu").score).toBe(100);
    expect(report.body.items.every((i: { correctPct: number }) => i.correctPct === 100)).toBe(true);
    const list = await t.get(faculty, "/console/assignments");
    expect(list.body.assignments.find((a: { id: string }) => a.id === id).completed).toBe(1);
  });
});

describe("analytics", () => {
  it("returns engagement, skills and readiness for the scope", async () => {
    const eng = await t.get(tpo, "/console/analytics/engagement");
    expect(eng.status, JSON.stringify(eng.body)).toBe(200);
    expect(eng.body.totalStudents).toBeGreaterThan(30);
    expect(eng.body.activeLast7Days).toBeGreaterThan(0);
    expect(eng.body.daily.length).toBeGreaterThan(0);
    const skills = await t.get(tpo, "/console/analytics/skills");
    expect(skills.body.weakest).toHaveLength(5);
    const readiness = await t.get(hod, "/console/analytics/readiness");
    expect(readiness.body.profiles.map((p: { id: string }) => p.id)).toEqual(["service", "product"]);
    const overview = await t.get(faculty, "/console/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.engagement.totalStudents).toBeLessThan(eng.body.totalStudents);
  });
});

describe("leagues and tenants", () => {
  it("closes a week once", async () => {
    const admin = await t.login("admin@demo.edu");
    t.clock.now = new Date(START.getTime() + 7 * 86_400_000);
    const first = await t.post(admin, "/admin/leagues/close-week", {});
    expect(first.status).toBe(200);
    expect(first.body.weekKey).toBe("2026-W43");
    expect(first.body.groups).toBeGreaterThan(0);
    const second = await t.post(admin, "/admin/leagues/close-week", {});
    expect(second.body.groups).toBe(0);
    t.clock.now = new Date(START);
  });

  it("lets the super admin onboard an institution", async () => {
    const sa = await t.login("superadmin@playcode.dev");
    const res = await t.post(sa, "/admin/tenants", { name: "New College", slug: "new-college", seats: 100, admin: { name: "NC Admin", email: "admin@newcollege.edu", password: "longpassword" } });
    expect(res.status).toBe(200);
    const ncAdmin = await t.login("admin@newcollege.edu", "longpassword");
    expect((await t.get(ncAdmin, "/console/students")).body.students).toEqual([]);
    expect((await t.get(tpo, "/admin/tenants")).status).toBe(403);
  });
});
