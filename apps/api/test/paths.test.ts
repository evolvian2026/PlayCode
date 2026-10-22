import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let faculty: string;
let tpo: string;
let units: Record<string, string>;
let pathId: string;

async function newStudent(email: string) {
  await t.post(tpo, "/console/students/import", { unitId: units["CSE 2027 - A"], csv: `Path Learner,${email},P1`, defaultPassword: "student-pass-1" });
  return t.login(email, "student-pass-1");
}

/** Play a session to the end, answering everything right. Returns the last answer's response. */
async function playAll(token: string, start: Record<string, unknown>) {
  let s = (await t.post(token, "/student/sessions", start)).body;
  let last: { pathsCompleted?: { title: string; code: string }[] } = {};
  while (!s.finished) {
    const qid = s.question.id;
    const res = (await t.post(token, `/student/sessions/${s.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 15_000 })).body;
    last = res;
    s = res.session;
  }
  return last;
}

beforeAll(async () => {
  t = await setup();
  faculty = await t.login("faculty@demo.edu");
  tpo = await t.login("tpo@demo.edu");
  units = Object.fromEntries((await t.get(tpo, "/console/org-units")).body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("learning paths", () => {
  it("is built by staff for the units in their scope", async () => {
    const body = {
      title: "Service company prep",
      description: "Loops first, then the pseudocode mission.",
      unitIds: [units["CSE 2027 - A"]],
      steps: [
        { kind: "skill", ref: "loops.for", target: 20, dueDays: 0 },
        { kind: "pack", ref: "mission-service-pseudocode", dueDays: 14 },
      ],
      startsAt: new Date(START.getTime() - 86_400_000).toISOString(),
    };
    expect((await t.post(faculty, "/console/paths", { ...body, unitIds: [units["ECE 2027 - A"]] })).status).toBe(403);
    expect((await t.post(faculty, "/console/paths", { ...body, steps: [{ kind: "skill", ref: "nope.nope" }] })).status).toBe(400);
    const res = await t.post(faculty, "/console/paths", body);
    expect(res.status).toBe(200);
    pathId = res.body.path.id;
    expect(res.body.path.steps[0]).toMatchObject({ id: "s1", title: "Loops: For loops", target: 20 });
    expect(res.body.path.steps[1].target).toBeGreaterThan(0); // the mission's pass mark
  });

  it("unlocks steps in order and certifies the learner at the end", async () => {
    const student = await newStudent("path.learner@demo.edu");
    const mine = async () => ((await t.get(student, "/student/paths")).body.paths as { id: string }[]).find((p) => p.id === pathId) as any;
    let path = await mine();
    expect(path.steps.map((s: { state: string }) => s.state)).toEqual(["current", "locked"]);
    expect(path.steps[0].overdue).toBe(true); // due on the start day

    // Master the skill: at least 5 answers and mastery above the target.
    for (let i = 0; i < 4; i++) {
      await playAll(student, { kind: "skill", skillId: "loops.for" });
      path = await mine();
      if (path.steps[0].state === "done") break;
    }
    expect(path.steps.map((s: { state: string }) => s.state)).toEqual(["done", "current"]);
    expect(path.steps[0].value).toBeGreaterThanOrEqual(20);

    const last = await playAll(student, { kind: "pack", packId: "mission-service-pseudocode" });
    expect(last.pathsCompleted).toHaveLength(1);
    expect(last.pathsCompleted![0]!.title).toBe("Service company prep");
    path = await mine();
    expect(path.done).toBe(2);
    expect(path.certificate).toBe(last.pathsCompleted![0]!.code);
    const verify = (await t.get("", `/public/certificates/${path.certificate}`)).body;
    expect(verify).toMatchObject({ valid: true, title: "Service company prep", holder: "Path Learner" });

    // Finishing another session does not certify twice.
    expect((await playAll(student, { kind: "skill", skillId: "loops.for" })).pathsCompleted).toEqual([]);
  });

  it("shows managers who is behind", async () => {
    const list = ((await t.get(faculty, "/console/paths")).body.paths as { id: string }[]).filter((p) => p.id === pathId) as any[];
    expect(list[0]).toMatchObject({ title: "Service company prep", completed: 1 });
    expect(list[0].learners).toBeGreaterThan(5);
    const detail = (await t.get(faculty, `/console/paths/${pathId}`)).body;
    // Step 1 was due on the start day; the second isn't due yet. Seeded students who already mastered loops aren't behind.
    expect(list[0].overdue).toBe(list[0].learners - detail.summary.steps[0].done);
    expect(list[0].overdue).toBeGreaterThan(0);
    expect(detail.summary.steps.map((s: { done: number }) => s.done)[1]).toBe(1);
    expect(detail.learners.at(-1)).toMatchObject({ email: "path.learner@demo.edu", completed: true, overdue: false });
    const csv = await t.app.inject({ method: "GET", url: `/console/paths/${pathId}/export`, headers: { authorization: `Bearer ${faculty}` } });
    expect(csv.body.split("\n")[0]).toBe('"name","roll_no","email","steps_done","completed","overdue","Loops: For loops","Mission: Service Company Pseudocode"'.replace("Mission: Service Company Pseudocode", detail.summary.steps[1].title));

    const ece = await t.login("hod.cse@demo.edu");
    expect((await t.get(ece, `/console/paths/${pathId}`)).status).toBe(200);
  });

  it("disappears for students once archived", async () => {
    await t.post(faculty, `/console/paths/${pathId}/archive`, {});
    const student = await t.login("path.learner@demo.edu", "student-pass-1");
    expect(((await t.get(student, "/student/paths")).body.paths as { id: string }[]).some((p) => p.id === pathId)).toBe(false);
  });
});
