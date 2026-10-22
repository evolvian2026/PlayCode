import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CODING_QUESTIONS } from "../src/content/coding";
import { pool } from "../src/db/client";
import { setAiProvider, type SnapshotReview } from "../src/lib/ai";
import { settleSnapshotReviews } from "../src/services/snapshot-review";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let faculty: string;
let units: Record<string, string>;
let n = 0;

async function student(section = "CSE 2027 - A") {
  const email = `exam${++n}@demo.edu`;
  await t.post(tpo, "/console/students/import", { unitId: units[section], csv: `Examinee ${n},${email},E${n}`, defaultPassword: "student-pass-1" });
  return t.login(email, "student-pass-1");
}

const at = (ms: number) => (t.clock.now = new Date(START.getTime() + ms));
const MIN = 60_000;

async function createTest(body: Record<string, unknown> = {}) {
  const res = await t.post(faculty, "/console/assessments", {
    title: "Mock drive 1",
    durationMinutes: 30,
    openAt: new Date(START.getTime() - MIN).toISOString(),
    closeAt: new Date(START.getTime() + 120 * MIN).toISOString(),
    unitIds: [units["CSE 2027 - A"]],
    sections: [
      { title: "Aptitude for code", skillIds: ["loops.for", "loops.while", "arrays.basics"], pick: 4, marks: 1, negative: 0.25 },
      { title: "Coding", questionIds: ["code-sum-two"], pick: 1, marks: 10, negative: 0 },
    ],
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.assessment.id as string;
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  units = Object.fromEntries((await t.get(tpo, "/console/org-units")).body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("proctored assessments", () => {
  it("runs a test from start to released results", async () => {
    at(0);
    const id = await createTest();
    const s1 = await student();
    const list = (await t.get(s1, "/student/assessments")).body.assessments;
    expect(list.find((a: { id: string }) => a.id === id).state).toBe("open");

    const started = await t.post(s1, `/student/assessments/${id}/start`, { deviceId: "device-aaaa" });
    expect(started.status).toBe(200);
    expect(started.body.questions).toHaveLength(5);
    expect(started.body.timeLeftMs).toBe(30 * MIN);
    expect(JSON.stringify(started.body)).not.toContain('"answer"');
    const attemptId = started.body.id;

    // Answer three quick ones right, one wrong; the coding question right.
    const quick = started.body.questions.filter((q: { section: number }) => q.section === 0);
    for (const [i, q] of quick.entries()) {
      const qid = q.question.id;
      const res = await t.put(s1, `/student/attempts/${attemptId}/answers`, { questionId: qid, response: i < 3 ? rightAnswer(qid) : wrongAnswer(qid) });
      expect(res.status).toBe(200);
    }
    const code = CODING_QUESTIONS.find((q) => q.id === "code-sum-two")!;
    const run = await t.post(s1, `/student/attempts/${attemptId}/run`, { questionId: code.id, response: { kind: "code", language: "c", source: code.solutions!.c } });
    expect(run.body.correct).toBe(true);
    await t.put(s1, `/student/attempts/${attemptId}/answers`, { questionId: code.id, response: { kind: "code", language: "c", source: code.solutions!.c } });

    // Saved answers come back on reload.
    const reload = (await t.get(s1, `/student/attempts/${attemptId}`)).body;
    expect(reload.questions.filter((q: { saved: unknown }) => q.saved)).toHaveLength(5);

    await t.post(s1, `/student/attempts/${attemptId}/events`, { events: [{ type: "tab_hidden" }, { type: "tab_hidden" }, { type: "paste" }, { type: "made_up" }] });

    at(10 * MIN);
    const submitted = await t.post(s1, `/student/attempts/${attemptId}/submit`, {});
    expect(submitted.body.status).toBe("submitted");
    expect(submitted.body.resultsPending).toBe(true); // manual release
    expect(submitted.body.result).toBeNull();
    expect((await t.put(s1, `/student/attempts/${attemptId}/answers`, { questionId: code.id, response: null })).status).toBe(409);
    expect((await t.post(s1, `/student/assessments/${id}/start`, { deviceId: "device-aaaa" })).status).toBe(409);

    const mon = (await t.get(faculty, `/console/assessments/${id}/monitor`)).body;
    const row = mon.students.find((s: { attemptId: string }) => s.attemptId === attemptId);
    expect(row.status).toBe("submitted");
    expect(row.integrity).toEqual({ tab_hidden: 2, paste: 1 });
    expect(row.riskScore).toBe(15); // 8*1.5 + 6*0.5
    expect(row.score).toBe(12.75); // 3 - 0.25 + 10

    await t.post(faculty, `/console/assessments/${id}/release`, {});
    const after = (await t.get(s1, `/student/attempts/${attemptId}`)).body;
    expect(after.result.score).toBe(12.75);
    expect(after.result.maxScore).toBe(14);
    expect(after.result.sections[0]).toMatchObject({ correct: 3, wrong: 1 });
  });

  it("auto-submits when time runs out and lets proctors extend time", async () => {
    at(0);
    const id = await createTest({ title: "Timed", durationMinutes: 10 });
    const s2 = await student();
    const s3 = await student();
    const a2 = (await t.post(s2, `/student/assessments/${id}/start`, { deviceId: "device-2222" })).body.id;
    const a3 = (await t.post(s3, `/student/assessments/${id}/start`, { deviceId: "device-3333" })).body.id;
    expect((await t.post(faculty, `/console/attempts/${a3}/extend`, { minutes: 15 })).status).toBe(200);
    at(12 * MIN);
    // s2 is past the deadline and grace period: answers are refused and the attempt closes.
    expect((await t.put(s2, `/student/attempts/${a2}/answers`, { questionId: "x", response: null })).status).toBe(409);
    const mon = (await t.get(faculty, `/console/assessments/${id}/monitor`)).body;
    expect(mon.students.find((s: { attemptId: string }) => s.attemptId === a2).status).toBe("auto_submitted");
    expect(mon.students.find((s: { attemptId: string }) => s.attemptId === a3).status).toBe("in_progress");
    // Force submit ends it immediately.
    await t.post(faculty, `/console/attempts/${a3}/force-submit`, {});
    expect((await t.get(s3, `/student/attempts/${a3}`)).body.status).toBe("submitted");
  });

  it("locks strict tests to one device and stores webcam snapshots", async () => {
    at(0);
    const id = await createTest({ title: "Strict", proctorLevel: 2, releasePolicy: "immediate" });
    const s4 = await student();
    const attempt = (await t.post(s4, `/student/assessments/${id}/start`, { deviceId: "laptop-1111" })).body.id;
    const other = await t.post(s4, `/student/assessments/${id}/start`, { deviceId: "phone-22222" });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe("device_locked");
    // 1x1 transparent PNG
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    expect((await t.post(s4, `/student/attempts/${attempt}/snapshot`, { image: png })).status).toBe(200);
    expect((await t.post(s4, `/student/attempts/${attempt}/snapshot`, { image: "data:text/html;base64,PGgxPg==" })).status).toBe(400);
    const detail = (await t.get(faculty, `/console/attempts/${attempt}`)).body;
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("device_changed");
    expect(detail.snapshots).toHaveLength(1);
    const img = await t.app.inject({ method: "GET", url: `/console/attempts/${attempt}/snapshots/${detail.snapshots[0].id}`, headers: { authorization: `Bearer ${faculty}` } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    // The proctor allows a switch.
    await t.post(faculty, `/console/attempts/${attempt}/reset-device`, {});
    expect((await t.post(s4, `/student/assessments/${id}/start`, { deviceId: "phone-22222" })).status).toBe(200);
    // Immediate release: the score shows right after submitting.
    expect((await t.post(s4, `/student/attempts/${attempt}/submit`, {})).body.result.maxScore).toBe(14);
  });

  it("flags copied code across students", async () => {
    at(0);
    const id = await createTest({ title: "Coding only", sections: [{ title: "Coding", questionIds: ["code-even-odd"], pick: 1, marks: 10, negative: 0 }] });
    const original = "n = int(input())\nnumbers = list(map(int, input().split()))\nevens = 0\nfor value in numbers:\n    if value % 2 == 0:\n        evens += 1\nprint(evens, n - evens)";
    const renamed = "count = int(input())\narr = list(map(int, input().split()))\ne = 0\nfor x in arr:\n    if x % 2 == 0:\n        e += 1\nprint(e, count - e)";
    const ids: string[] = [];
    for (const source of [original, renamed]) {
      const tok = await student();
      const attempt = (await t.post(tok, `/student/assessments/${id}/start`, { deviceId: `dev-${ids.length}-xxxx` })).body.id;
      await t.put(tok, `/student/attempts/${attempt}/answers`, { questionId: "code-even-odd", response: { kind: "code", language: "python", source } });
      await t.post(tok, `/student/attempts/${attempt}/submit`, {});
      ids.push(attempt);
    }
    const report = (await t.get(faculty, `/console/assessments/${id}/results`)).body;
    expect(report.plagiarism).toHaveLength(1);
    expect(report.plagiarism[0].flagged).toBe(true);
    expect(report.rows.every((r: { riskScore: number; score: number }) => r.riskScore >= 40 && r.score === 10)).toBe(true);
  });

  it("keeps tests inside the right scope", async () => {
    at(0);
    const id = await createTest({ title: "Scoped" });
    const ece = await student("ECE 2027 - A");
    expect((await t.post(ece, `/student/assessments/${id}/start`, { deviceId: "device-ece1" })).status).toBe(403);
    const bad = await t.post(faculty, "/console/assessments", {
      title: "Not mine",
      durationMinutes: 30,
      openAt: START.toISOString(),
      closeAt: new Date(START.getTime() + 60 * MIN).toISOString(),
      unitIds: [units["ECE 2027 - A"]],
      sections: [{ title: "x", skillIds: ["loops.for"], pick: 1, marks: 1, negative: 0 }],
    });
    expect(bad.status).toBe(403);
    expect((await t.get(ece, `/console/assessments/${id}/monitor`)).status).toBe(403);
  });

  it("reviews level 3 webcam snapshots with AI and raises the risk score", async () => {
    const reviews: SnapshotReview[] = [
      { faces: 1, phone: false, otherPerson: false, note: "" },
      { faces: 2, phone: true, otherPerson: false, note: "A second person is beside the student" },
    ];
    const seen: Buffer[] = [];
    setAiProvider({
      coachHint: async () => { throw new Error("not used"); },
      draftQuestions: async () => { throw new Error("not used"); },
      draftCodingProblems: async () => { throw new Error("not used"); },
      draftSqlProblems: async () => { throw new Error("not used"); },
      reviewSnapshot: async ({ image }) => {
        seen.push(image);
        return { value: reviews.shift()!, usage: { inputTokens: 1600, outputTokens: 80, cacheReadTokens: 300 } };
      },
    });
    try {
      at(0);
      const id = await createTest({ title: "L3", proctorLevel: 3 });
      const s5 = await student();
      const attempt = (await t.post(s5, `/student/assessments/${id}/start`, { deviceId: "laptop-5555" })).body.id;
      const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      await t.post(s5, `/student/attempts/${attempt}/snapshot`, { image: png });
      at(MIN);
      await t.post(s5, `/student/attempts/${attempt}/snapshot`, { image: png });
      await settleSnapshotReviews();
      expect(seen).toHaveLength(2);
      expect(seen[0]!.subarray(1, 4).toString()).toBe("PNG");

      // The browser can't report camera findings itself.
      await t.post(s5, `/student/attempts/${attempt}/events`, { events: [{ type: "no_face" }, { type: "tab_hidden" }] });

      const detail = (await t.get(faculty, `/console/attempts/${attempt}`)).body;
      const types = detail.events.map((e: { type: string }) => e.type).sort();
      expect(types).toEqual(["multiple_faces", "phone_visible", "tab_hidden"]);
      expect(detail.events.find((e: { type: string }) => e.type === "phone_visible").detail).toContain(`[${detail.snapshots[1].id}]`);
      expect(detail.snapshots[0].review).toMatchObject({ faces: 1, phone: false });
      expect(detail.snapshots[1].review).toMatchObject({ faces: 2, phone: true });
      expect(detail.riskScore).toBe(27); // multiple_faces 20*0.5 + phone 25*0.5 + tab 8*0.5 = 26.5
    } finally {
      setAiProvider(undefined);
    }
  });
});
