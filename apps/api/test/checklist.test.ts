import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, studentProfiles, users } from "../src/db/schema";
import { setMailer, type Mail } from "../src/lib/mailer";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let riya: string;
let riyaId: string;
const DAY = 86_400_000;
const sent: Mail[] = [];

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  riyaId = (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!.id;
});

afterAll(async () => {
  setMailer(undefined);
  await t.app.close();
  await pool.end();
});

type Item = { key: string; status: "done" | "missing" | "n/a" };

describe("placement readiness checklist", () => {
  it("tells a student what's left, and updates as they fix it", async () => {
    const before = (await t.get(riya, "/student/checklist")).body;
    expect(before.items.map((i: Item) => i.key)).toEqual(["record", "profile", "documents", "mock_interview", "practice", "training"]);
    expect(before.items.find((i: Item) => i.key === "record").status).toBe("done");
    expect(before.total).toBe(before.items.filter((i: Item) => i.status !== "n/a").length);
    expect(before.done + before.missing.length).toBe(before.total);

    await db
      .insert(studentProfiles)
      .values({ userId: riyaId, tenantId: (await db.select().from(users).where(eq(users.id, riyaId)))[0]!.tenantId!, headline: "Final-year CSE student who likes backend work", about: "I build small web apps in Python and enjoy SQL puzzles." })
      .onConflictDoUpdate({ target: studentProfiles.userId, set: { headline: "Final-year CSE student who likes backend work", about: "I build small web apps in Python and enjoy SQL puzzles." } });
    const after = (await t.get(riya, "/student/checklist")).body;
    expect(after.items.find((i: Item) => i.key === "profile").status).toBe("done");
  });

  it("shows the placement cell who is missing what, and who is sitting the season out", async () => {
    const res = await t.get(tpo, "/console/readiness");
    expect(res.status).toBe(200);
    const { students, summary } = res.body;
    expect(summary.students).toBe(students.length);
    expect(summary.ready).toBe(students.filter((s: { missing: string[] }) => s.missing.length === 0).length);
    expect(summary.missing.profile).toBe(students.filter((s: { missing: string[] }) => s.missing.includes("profile")).length);
    for (const s of students) expect(s.sittingOut).toBe(s.drives.eligible >= 2 && s.drives.registered === 0);
    const me = students.find((s: { id: string }) => s.id === riyaId);
    expect(me.drives.registered).toBe(1); // Zoho
    // Least ready first.
    const share = (s: { done: number; total: number }) => s.done / (s.total || 1);
    expect(share(students[0])).toBeLessThanOrEqual(share(students.at(-1)));

    const faculty = await t.login("faculty@demo.edu");
    expect((await t.get(faculty, "/console/readiness")).body.students.length).toBeLessThan(students.length);
    expect((await t.get(riya, "/console/readiness")).status).toBe(403);
  });

  it("nudges students, once a day", async () => {
    const tpoId = (await db.select().from(users).where(eq(users.email, "tpo@demo.edu")))[0]!.id;
    expect((await t.post(tpo, "/console/readiness/nudge", { userIds: [tpoId], about: "drives" })).status).toBe(400);
    expect((await t.post(await t.login("faculty@demo.edu"), "/console/readiness/nudge", { userIds: [riyaId], about: "drives" })).status).toBe(403);
    expect((await t.post(tpo, "/console/readiness/nudge", { userIds: [riyaId], about: "drives" })).body).toEqual({ sent: 1 });
    expect((await t.post(tpo, "/console/readiness/nudge", { userIds: [riyaId], about: "drives" })).body).toEqual({ sent: 0 });
    const missing = (await t.get(riya, "/student/checklist")).body.missing as string[];
    expect((await t.post(tpo, "/console/readiness/nudge", { userIds: [riyaId], about: "checklist" })).body).toEqual({ sent: missing.length ? 1 : 0 });
    const notes = await db.select().from(notifications).where(and(eq(notifications.userId, riyaId), like(notifications.title, "Drives you're eligible for%")));
    expect(notes).toHaveLength(1);
  });
});

describe("recruiter feedback", () => {
  let pastDrive: string;
  let token: string;

  it("sends the company a private link, once the drive has happened", async () => {
    const future = (await t.get(tpo, "/console/placements")).body.drives.find((d: { company: string }) => d.company === "Accenture").id;
    expect((await t.post(tpo, `/console/placements/${future}/feedback`, { email: null })).status).toBe(400);
    pastDrive = (
      await t.post(tpo, "/console/placements", {
        company: "Capgemini",
        companyType: "service",
        roleTitle: "Analyst",
        ctcRupees: 400_000,
        driveDate: "2026-10-20",
        registerBy: new Date(START.getTime() + 3_600_000).toISOString(),
        criteria: { unitIds: [], allowPlaced: true },
        rounds: ["Test", "Interview"],
      })
    ).body.drive.id;
    expect((await t.get(tpo, `/console/placements/${pastDrive}/feedback`)).body.feedback).toBeNull();
    setMailer(null);
    expect((await t.post(tpo, `/console/placements/${pastDrive}/feedback`, { email: "campus@capgemini.example" })).status).toBe(400);
    setMailer({ send: async (m) => void sent.push(m) });
    const res = await t.post(tpo, `/console/placements/${pastDrive}/feedback`, { email: "campus@capgemini.example" });
    expect(res.status).toBe(200);
    expect(res.body.feedback).toMatchObject({ sentTo: "campus@capgemini.example", submittedAt: null });
    token = res.body.link.split("/feedback/")[1];
    expect(sent[0]).toMatchObject({ to: "campus@capgemini.example" });
    expect(sent[0]!.text).toContain(res.body.link);
    // A new link replaces the old one.
    const again = await t.post(tpo, `/console/placements/${pastDrive}/feedback`, { email: null });
    expect((await t.get("", `/public/feedback/${token}`)).status).toBe(404);
    token = again.body.link.split("/feedback/")[1];
  });

  it("takes the company's answers without an account", async () => {
    const form = (await t.get("", `/public/feedback/${token}`)).body;
    expect(form).toMatchObject({ institution: "Demo Institute of Technology", company: "Capgemini", answers: { submittedAt: null } });
    expect(form.dimensions.map((d: { key: string }) => d.key)).toEqual(["aptitude", "technical", "communication", "preparedness"]);
    const answer = { ratings: { aptitude: 4, technical: 4, communication: 2, preparedness: 3 }, wentWell: "Good coding round.", gaps: "Hesitant in the communication assessment.", returnNextYear: "maybe", plannedHires: 10, respondentName: "Kiran", respondentRole: "Campus lead" };
    expect((await t.post("", `/public/feedback/${token}`, { ...answer, ratings: { ...answer.ratings, technical: 6 } })).status).toBe(400);
    const res = await t.post("", `/public/feedback/${token}`, answer);
    expect(res.body.answers).toMatchObject({ returnLabel: "May come back", plannedHires: 10, submittedAt: START.toISOString() });
    expect((await t.get(tpo, `/console/placements/${pastDrive}/feedback`)).body.feedback.ratings).toEqual(answer.ratings);
    expect((await t.post(tpo, `/console/placements/${pastDrive}/feedback`, { email: null })).status).toBe(400); // already answered
    expect((await t.get("", "/public/feedback/not-a-real-token-at-all-xyz")).status).toBe(404);
    // Links stop working after 30 days.
    t.clock.now = new Date(START.getTime() + 31 * DAY);
    expect((await t.get("", `/public/feedback/${token}`)).status).toBe(404);
    t.clock.now = new Date(START);
  });

  it("adds up the season and says where training should focus", async () => {
    const s = (await t.get(tpo, "/console/recruiter-feedback")).body;
    expect(s).toMatchObject({ responses: 3, waiting: 1, plannedHires: 55, returning: { yes: 2, maybe: 1, no: 0 } });
    expect(s.companies).toEqual({ aptitude: 4, technical: 3.3, communication: 2.3, preparedness: 2.7 });
    expect(s.priorities.map((p: { dimension: string; priority: boolean; trainingLabel: string }) => [p.dimension, p.priority, p.trainingLabel])).toEqual([
      ["communication", true, "Soft skills"],
      ["preparedness", true, "Mock drive"],
      ["technical", true, "Technical"],
      ["aptitude", false, "Aptitude and reasoning"],
    ]);
    expect(s.comments[0]).toMatchObject({ company: "Capgemini", respondent: "Kiran, Campus lead" });
    expect((await t.get(await t.login("faculty@demo.edu"), "/console/recruiter-feedback")).status).toBe(200);
    expect((await t.get(riya, "/console/recruiter-feedback")).status).toBe(403);
  });
});
