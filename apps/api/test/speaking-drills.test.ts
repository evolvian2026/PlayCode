import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("speaking drills", () => {
  let id: string;

  it("score each sentence from the bank, not from what the page claims", async () => {
    expect((await t.get(riya, "/student/speaking-drills")).body.kinds).toEqual([
      { kind: "read", best: null, sittings: 0 },
      { kind: "repeat", best: null, sittings: 0 },
    ]);
    const res = await t.post(riya, "/student/speaking-drills", {
      kind: "read",
      items: [
        { sentenceId: "s13", heard: "the client asked for demo of new features next weak", spokenMs: 4000, accuracy: 100 },
        { sentenceId: "s25", heard: "The company is looking for graduates who communicate clearly and learn quickly", spokenMs: 5000 },
      ],
    });
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body.items.map((i: { accuracy: number }) => i.accuracy)).toEqual([75, 100]);
    expect(res.body).toMatchObject({ kind: "read", accuracy: 88 });
    // 10 + 12 words in 9 seconds.
    expect(res.body.wpm).toBe(147);
    expect(res.body.items[0].words.filter((w: { heard: boolean }) => !w.heard).map((w: { word: string }) => w.word)).toEqual(["a", "the", "week."]);
    expect((await t.get(riya, `/student/speaking-drills/${id}`)).body.items[1].text).toBe("The company is looking for graduates who communicate clearly and learn quickly.");
  });

  it("refuse sentences that aren't in the bank, or the same one twice", async () => {
    expect((await t.post(riya, "/student/speaking-drills", { kind: "repeat", items: [{ sentenceId: "zz", heard: "hello", spokenMs: 1000 }] })).status).toBe(400);
    const twice = { sentenceId: "s01", heard: "please close the door when you leave", spokenMs: 2000 };
    expect((await t.post(riya, "/student/speaking-drills", { kind: "repeat", items: [twice, twice] })).status).toBe(400);
    const ok = await t.post(riya, "/student/speaking-drills", { kind: "repeat", items: [twice] });
    expect(ok.body).toMatchObject({ accuracy: 100, wpm: null });
    expect((await t.get(riya, "/student/speaking-drills")).body.kinds).toEqual([
      { kind: "read", best: 88, sittings: 1 },
      { kind: "repeat", best: 100, sittings: 1 },
    ]);
  });

  it("show teachers each student's latest and best, within their scope", async () => {
    const faculty = await t.login("faculty@demo.edu");
    const body = (await t.get(faculty, "/console/speaking-drills")).body;
    expect(body.averages).toMatchObject({ students: 1, sittings: 2, read: 88, repeat: 100 });
    expect(body.students[0]).toMatchObject({ name: "Riya Kapoor", read: { latest: 88, best: 88 }, repeat: { latest: 100, best: 100 } });
    expect((await t.get(await t.login("admin@sunrise.edu"), "/console/speaking-drills")).body.averages).toBeNull();
    expect((await t.get(await t.login("aarav.sharma1@demo.edu"), `/student/speaking-drills/${id}`)).status).toBe(404);
  });

  it("appear in the student's data export", async () => {
    expect((await t.get(riya, "/privacy/export")).body.speakingDrills).toHaveLength(2);
  });
});
