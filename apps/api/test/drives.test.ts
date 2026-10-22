import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let hr: string;
let driveId: string;
let code: string;

beforeAll(async () => {
  t = await setup();
  const sa = await t.login("superadmin@playcode.dev");
  await t.post(sa, "/admin/tenants", { name: "Zenith Tech", slug: "zenith", type: "company", seats: 500, admin: { name: "Acme HR", email: "hr@acme.com", password: "longpassword" } });
  hr = await t.login("hr@acme.com", "longpassword");
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("hiring drives", () => {
  it("creates a drive with its own proctored test and apply link", async () => {
    const res = await t.post(hr, "/console/drives", {
      title: "Campus hiring 2027",
      roleTitle: "Graduate Engineer Trainee",
      description: "Two sections, 45 minutes.",
      durationMinutes: 45,
      openAt: new Date(START.getTime() - 60_000).toISOString(),
      closeAt: new Date(START.getTime() + 7 * 86_400_000).toISOString(),
      proctorLevel: 1,
      cutoffPct: 50,
      sections: [{ title: "Aptitude for code", skillIds: ["loops.for", "loops.while"], pick: 4, marks: 1, negative: 0 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    driveId = res.body.drive.id;
    code = res.body.drive.inviteCode;
    const pub = (await t.get("", `/public/drives/${code}`)).body;
    expect(pub).toMatchObject({ company: "Zenith Tech", roleTitle: "Graduate Engineer Trainee", accepting: true });
  });

  it("lets candidates apply, take the test and get shortlisted", async () => {
    expect((await t.post("", `/public/drives/${code}/apply`, { name: "Kiran Rao", email: "kiran@gmail.com", password: "candidate-pass", college: "Demo Institute" })).status).toBe(400); // no consent
    const applied = await t.post("", `/public/drives/${code}/apply`, { name: "Kiran Rao", email: "kiran@gmail.com", password: "candidate-pass", college: "Demo Institute", consent: true });
    expect(applied.status).toBe(200);
    const again = await t.post("", `/public/drives/${code}/apply`, { name: "Kiran Rao", email: "kiran@gmail.com", password: "candidate-pass", consent: true });
    expect(again.status).toBe(409);

    const cand = applied.body.token as string;
    const started = await t.post(cand, `/student/assessments/${applied.body.assessmentId}/start`, { deviceId: "cand-device-1" });
    expect(started.status).toBe(200);
    for (const [i, q] of started.body.questions.entries()) {
      if (i < 3) await t.put(cand, `/student/attempts/${started.body.id}/answers`, { questionId: q.question.id, response: rightAnswer(q.question.id) });
    }
    await t.post(cand, `/student/attempts/${started.body.id}/submit`, {});

    const detail = (await t.get(hr, `/console/drives/${driveId}`)).body;
    const kiran = detail.candidates[0];
    expect(kiran).toMatchObject({ name: "Kiran Rao", college: "Demo Institute", test: "submitted", score: 3, maxScore: 4, scorePct: 75, meetsCutoff: true, status: "applied" });
    const set = await t.put(hr, `/console/drives/${driveId}/candidates/${kiran.userId}`, { status: "shortlisted", notes: "Strong on loops" });
    expect(set.body.candidate.status).toBe("shortlisted");
    const list = (await t.get(hr, "/console/drives")).body.drives[0];
    expect(list).toMatchObject({ candidates: 1, tested: 1, shortlisted: 1 });
  });

  it("imports candidates and exports a safe CSV", async () => {
    const imported = await t.post(hr, `/console/drives/${driveId}/candidates/import`, { csv: "name,email,roll_no\nAsha Iyer,asha.i@outlook.com,\n=HYPERLINK(\"http://x\"),evil@example.com," });
    expect(imported.body.created).toHaveLength(2);
    const csv = await t.app.inject({ method: "GET", url: `/console/drives/${driveId}/export.csv`, headers: { authorization: `Bearer ${hr}` } });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain('"Asha Iyer"');
    expect(csv.body).toContain(`"'=HYPERLINK`);
  });

  it("closes drives and keeps them private to the company", async () => {
    await t.put(hr, `/console/drives/${driveId}`, { status: "closed" });
    expect((await t.get("", `/public/drives/${code}`)).body.accepting).toBe(false);
    expect((await t.post("", `/public/drives/${code}/apply`, { name: "Late", email: "late@gmail.com", password: "candidate-pass", consent: true })).status).toBe(409);
    const demoAdmin = await t.login("admin@demo.edu");
    expect((await t.get(demoAdmin, `/console/drives/${driveId}`)).status).toBe(404);
    const tpo = await t.login("tpo@demo.edu");
    expect((await t.get(tpo, "/console/drives")).status).toBe(403);
  });

  it("rate-limits password guessing", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await t.post("", "/auth/login", { email: "hr@acme.com", password: "wrong" })).status;
    expect(last).toBe(429);
  });
});
