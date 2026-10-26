import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let faculty: string;
let riya: string;
let dev: string;
let id: string;
const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);

beforeAll(async () => {
  t = await setup();
  faculty = await t.login("faculty@demo.edu");
  riya = await t.login("student@demo.edu");
  const tpo = await t.login("tpo@demo.edu");
  const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
  await t.post(tpo, "/console/students/import", { unitId: units.find((u) => u.name === "CSE 2027 - A")!.id, csv: "Dev Live,dev.live@demo.edu,X9", defaultPassword: "student-pass-1" });
  dev = await t.login("dev.live@demo.edu", "student-pass-1");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("live classroom quizzes", () => {
  let code: string;

  it("lets a teacher host one and students join with a code", async () => {
    expect((await t.post(faculty, "/console/live", { title: "Friday quiz" })).status).toBe(400); // no mission or skill
    const res = await t.post(faculty, "/console/live", { title: "Friday quiz", packId: "mission-service-pseudocode", count: 3, secondsPerQuestion: 20 });
    expect(res.status).toBe(200);
    id = res.body.id;
    const host = (await t.get(faculty, `/console/live/${id}`)).body;
    expect(host).toMatchObject({ status: "lobby", index: -1, total: 3, players: 0, isHost: true, question: null });
    code = host.code;
    expect(code).toMatch(/^\d{6}$/);
    expect((await t.post(riya, "/student/live/join", { code: code === "999999" ? "999998" : "999999" })).status).toBe(404);
    expect((await t.post(riya, "/student/live/join", { code })).body.id).toBe(id);
    await t.post(riya, "/student/live/join", { code }); // joining twice is harmless
    await t.post(dev, "/student/live/join", { code });
    expect((await t.get(faculty, `/console/live/${id}`)).body.players).toBe(2);
    // Another college's students can't join, and students can't host.
    expect((await t.post(await t.login("sunrise.student1@sunrise.edu"), "/student/live/join", { code })).status).toBe(404);
    expect((await t.get(riya, `/console/live/${id}`)).status).toBe(403);
    expect((await t.get(riya, `/student/live/${id}`)).body).toMatchObject({ status: "lobby", question: null });
  });

  it("scores right answers by speed and refuses late or repeated ones", async () => {
    t.clock.now = at(0);
    expect((await t.post(await t.login("tpo@demo.edu"), `/console/live/${id}/next`)).status).toBe(403); // not the host
    let host = (await t.post(faculty, `/console/live/${id}/next`)).body;
    expect(host).toMatchObject({ status: "question", index: 0, answered: 0, answer: null });
    const qid = host.question.id;
    const view = (await t.get(riya, `/student/live/${id}`)).body;
    expect(view.question.id).toBe(qid);
    expect(JSON.stringify(view)).not.toContain('"answer"');

    t.clock.now = at(5);
    expect((await t.post(riya, `/student/live/${id}/answer`, { index: 0, response: rightAnswer(qid) })).body).toEqual({ received: true });
    expect((await t.post(riya, `/student/live/${id}/answer`, { index: 0, response: rightAnswer(qid) })).status).toBe(409);
    t.clock.now = at(8);
    await t.post(dev, `/student/live/${id}/answer`, { index: 0, response: wrongAnswer(qid) });
    host = (await t.get(faculty, `/console/live/${id}`)).body;
    expect(host).toMatchObject({ answered: 2, correct: null, spread: null }); // nothing revealed yet
    expect((await t.get(riya, `/student/live/${id}`)).body).toMatchObject({ answered: true, question: null, result: null });

    // Time's up: the question closes by itself.
    t.clock.now = at(21);
    expect((await t.post(dev, `/student/live/${id}/answer`, { index: 0, response: rightAnswer(qid) })).status).toBe(409);
    host = (await t.get(faculty, `/console/live/${id}`)).body;
    expect(host).toMatchObject({ status: "reveal", correct: 1 });
    expect(Object.values(host.spread).reduce((a: number, b) => a + (b as number), 0)).toBe(2);
    expect(host.leaderboard[0]).toMatchObject({ name: "Riya Kapoor", score: 875, rank: 1 });
    const mine = (await t.get(riya, `/student/live/${id}`)).body;
    expect(mine.result).toMatchObject({ correct: true, points: 875, answered: true });
    expect(mine.me).toEqual({ score: 875, rank: 1, of: 2 });
    expect((await t.get(dev, `/student/live/${id}`)).body.result).toMatchObject({ correct: false, points: 0 });
  });

  it("moves through the questions and finishes after the last", async () => {
    t.clock.now = at(30);
    let host = (await t.post(faculty, `/console/live/${id}/next`)).body;
    expect(host).toMatchObject({ status: "question", index: 1 });
    // The teacher can reveal before the timer ends.
    t.clock.now = at(33);
    await t.post(dev, `/student/live/${id}/answer`, { index: 1, response: rightAnswer(host.question.id) });
    host = (await t.post(faculty, `/console/live/${id}/next`)).body;
    expect(host.status).toBe("reveal");
    expect((await t.post(riya, `/student/live/${id}/answer`, { index: 1, response: rightAnswer(host.question.id) })).status).toBe(409);
    await t.post(faculty, `/console/live/${id}/next`); // question 3
    await t.post(faculty, `/console/live/${id}/next`); // reveal
    host = (await t.post(faculty, `/console/live/${id}/next`)).body; // past the last: finished
    expect(host.status).toBe("ended");
    expect(host.leaderboard.map((r: { name: string }) => r.name)).toEqual(["Dev Live", "Riya Kapoor"]); // 925 beats 875
    expect((await t.post(faculty, `/console/live/${id}/next`)).status).toBe(409);
    // The code is free again, and a finished quiz can't be joined.
    expect((await t.post(riya, "/student/live/join", { code })).status).toBe(404);
    expect((await t.get(faculty, "/console/live")).body.quizzes[0]).toMatchObject({ id, status: "ended", players: 2 });
  });
});
