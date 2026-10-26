import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { playerProfiles, skillRatings, users } from "../src/db/schema";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let student: string;
let userId: string;
const at = (hours: number) => new Date(START.getTime() + hours * 3_600_000); // START is Thursday 12:00 in India
const profile = async () => (await db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId)))[0]!;
type Pack = { id: string; questions: { id: string; skillId: string }[] };

beforeAll(async () => {
  t = await setup();
  const tpo = await t.login("tpo@demo.edu");
  const unit = ((await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[]).find((u) => u.name === "CSE 2027 - A")!.id;
  await t.post(tpo, "/console/students/import", { unitId: unit, csv: "Offline Om,offline.om@demo.edu,OF1", defaultPassword: "student-pass-1" });
  student = await t.login("offline.om@demo.edu", "student-pass-1");
  userId = (await db.select().from(users).where(eq(users.email, "offline.om@demo.edu")))[0]!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("offline practice", () => {
  let pack: Pack;
  let first: { correct: number; total: number; xp: number; results: { correct: boolean; countedOn: string; correctAnswer: string; explanation: string }[] };

  it("hands out questions without their answers", async () => {
    t.clock.now = at(0);
    pack = (await t.post(student, "/student/offline-pack")).body;
    expect(pack.questions).toHaveLength(15);
    expect(JSON.stringify(pack)).not.toMatch(/"answer"|"explanation"|"accepted"/);
    const perSkill = new Map<string, number>();
    for (const q of pack.questions) perSkill.set(q.skillId, (perSkill.get(q.skillId) ?? 0) + 1);
    expect(Math.max(...perSkill.values())).toBeLessThanOrEqual(4);
    // Asking again before syncing gives the same pack.
    expect((await t.post(student, "/student/offline-pack")).body.id).toBe(pack.id);
  });

  it("marks answers when the pack syncs, on the day they were given", async () => {
    const answers = pack.questions.slice(0, 10).map((q, i) => ({
      questionId: q.id,
      response: i < 7 ? rightAnswer(q.id) : wrongAnswer(q.id),
      answeredAt: at(20 + i / 60).toISOString(), // Friday 08:00, a minute apart
      timeMs: 30_000,
    }));
    t.clock.now = at(30); // Friday evening
    const res = await t.post(student, `/student/offline-pack/${pack.id}/sync`, { answers: [...answers, answers[0]] }); // a duplicate is ignored
    expect(res.status).toBe(200);
    first = res.body;
    expect(first).toMatchObject({ synced: true, correct: 7, total: 10 });
    expect(first.xp).toBeGreaterThan(0);
    expect(new Date(first.results[0]!.countedOn)).toEqual(at(20));
    const wrong = first.results.find((r) => !r.correct)!;
    expect(wrong.correctAnswer.length).toBeGreaterThan(0);
    expect(wrong.explanation.length).toBeGreaterThan(0);
    // It's ordinary practice now: mastery, XP and the streak (for Friday).
    expect(await db.select().from(skillRatings).where(eq(skillRatings.userId, userId))).not.toHaveLength(0);
    expect(await profile()).toMatchObject({ streakCurrent: 1, streakLastDate: "2026-10-23", xp: first.xp });
  });

  it("can be synced again safely, and only by its owner", async () => {
    const again = await t.post(student, `/student/offline-pack/${pack.id}/sync`, { answers: [] });
    expect(again.body).toEqual(first);
    expect((await profile()).xp).toBe(first.xp);
    expect((await t.post(await t.login("student@demo.edu"), `/student/offline-pack/${pack.id}/sync`, { answers: [] })).status).toBe(404);
    // The synced pack is closed, so the next download is a new one.
    expect((await t.post(student, "/student/offline-pack")).body.id).not.toBe(pack.id);
  });

  it("never counts an answer before its pack existed or before the student's latest practice day", async () => {
    t.clock.now = at(45); // Saturday 09:00
    const p2: Pack = (await t.post(student, "/student/offline-pack")).body;
    // That new pack from the last test is the open one; answer two of it on Saturday, one "before it existed".
    const [q1, q2] = [p2.questions[0]!.id, p2.questions[1]!.id];
    // Sunday: online practice first, then the sync.
    t.clock.now = at(70);
    let s = (await t.post(student, "/student/sessions", { kind: "daily" })).body;
    s = (await t.post(student, `/student/sessions/${s.id}/answer`, { questionId: s.question.id, response: rightAnswer(s.question.id), timeMs: 20_000 })).body;
    const before = await profile();
    expect(before.streakLastDate).toBe("2026-10-25");
    t.clock.now = at(71);
    const res = (
      await t.post(student, `/student/offline-pack/${p2.id}/sync`, {
        answers: [
          { questionId: q1, response: rightAnswer(q1), answeredAt: at(46).toISOString(), timeMs: 20_000 }, // Saturday, before Sunday's practice
          { questionId: q2, response: rightAnswer(q2), answeredAt: at(-100).toISOString(), timeMs: 20_000 }, // before the pack: clamped, then moved
        ],
      })
    ).body;
    // Both would land before Sunday, so they count at the sync; the streak isn't reset by an earlier day.
    expect(res.results.map((r: { countedOn: string }) => new Date(r.countedOn).getTime())).toEqual([at(71).getTime(), at(71).getTime()]);
    expect(await profile()).toMatchObject({ streakLastDate: "2026-10-25", streakCurrent: before.streakCurrent });
  });

  it("moves answers from a closed league week to the week of the sync", async () => {
    t.clock.now = at(80); // Sunday 20:00
    const p3: Pack = (await t.post(student, "/student/offline-pack")).body;
    const q = p3.questions[0]!.id;
    t.clock.now = at(92); // Monday 08:00: a new week
    const res = (await t.post(student, `/student/offline-pack/${p3.id}/sync`, { answers: [{ questionId: q, response: rightAnswer(q), answeredAt: at(82).toISOString(), timeMs: 20_000 }] })).body;
    expect(new Date(res.results[0].countedOn)).toEqual(at(92));
    // A future timestamp from a fast phone clock is clamped to the sync.
    const p4: Pack = (await t.post(student, "/student/offline-pack")).body;
    const q4 = p4.questions[0]!.id;
    const r4 = (await t.post(student, `/student/offline-pack/${p4.id}/sync`, { answers: [{ questionId: q4, response: rightAnswer(q4), answeredAt: at(500).toISOString(), timeMs: 20_000 }] })).body;
    expect(new Date(r4.results[0].countedOn)).toEqual(at(92));
  });
});
