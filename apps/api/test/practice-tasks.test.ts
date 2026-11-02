import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { memberships, notifications, tenants, users } from "../src/db/schema";
import { setAiProvider, type AiProvider } from "../src/lib/ai";
import { practiceTaskReminders } from "../src/services/practice-tasks";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
let faculty: string;
let section: string;
const notUsed = async () => {
  throw new Error("not used");
};
const fake: AiProvider = {
  coachHint: notUsed,
  draftQuestions: notUsed,
  draftCodingProblems: notUsed,
  draftSqlProblems: notUsed,
  reviewSnapshot: notUsed,
  interviewTurn: notUsed,
  interviewScorecard: notUsed,
  weeklyInsights: notUsed,
  reviewCode: notUsed,
  gdTurn: notUsed,
  gdScorecard: notUsed,
  writingFeedback: notUsed,
  introDraft: notUsed,
  async jamFeedback(input) {
    return {
      value: {
        // Out of range on purpose: the API keeps scores to 1-5.
        scores: { content: 4, structure: 2, language: 9 },
        overall: 3,
        strengths: ["A personal example: \"my cousin pays the vegetable seller by UPI\"."],
        improvements: ["End with a line that sums up your view.", "Give a second example.", "Slow down.", "A fourth point that should be dropped."],
        betterOpening: "Five years ago, paying a vegetable seller meant counting coins; today it takes one scan.",
        outline: ["Speed and convenience", "Small sellers joined the formal economy", "Risks: fraud and dependence on phones", "Extra"],
      },
      usage: { inputTokens: 600, outputTokens: 300, cacheReadTokens: 0 },
    };
  },
};

const TALK =
  "um UPI has changed the way we pay in India completely five years ago my family paid for everything in cash and my father always carried coins for the vegetable seller now even the vegetable seller has a QR code basically everybody from my cousin to my grandmother pays by scanning it is fast it is free and it works on any phone with an internet connection " +
  "it also helped small shop owners because every payment is recorded so they can show their income to a bank and get a loan but there are risks too people get calls from fraudsters asking for their PIN and older people find it hard to know what is safe so I think UPI is one of the best things to happen to payments in India but we need to teach people to use it safely";

const DAY = 86_400_000;
const due = (days: number) => new Date(START.getTime() + days * DAY).toISOString();

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  faculty = await t.login("faculty@demo.edu");
  setAiProvider(fake);
  const [me] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
  const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, me!.id), eq(memberships.role, "student")));
  section = m!.orgUnitId!;
});

afterAll(async () => {
  setAiProvider(undefined);
  await t.app.close();
  await pool.end();
});

describe("communication tasks", () => {
  let jamTask: string;

  it("are set for a section and announced to its students", async () => {
    expect((await t.post(faculty, "/console/practice-tasks", { kind: "jam", unitIds: [section], closeAt: due(3) })).body.error.message).toBe("Choose a JAM topic");
    expect((await t.post(faculty, "/console/practice-tasks", { kind: "read", ref: "upi", unitIds: [section], closeAt: due(3) })).status).toBe(400);
    expect((await t.post(faculty, "/console/practice-tasks", { kind: "jam", ref: "upi", unitIds: [section], closeAt: due(-1) })).status).toBe(400);
    const res = await t.post(faculty, "/console/practice-tasks", { kind: "jam", ref: "upi", note: "Give one example from your own life.", unitIds: [section], closeAt: due(3) });
    expect(res.status).toBe(200);
    jamTask = res.body.task.id;
    expect(res.body.students).toBeGreaterThan(1);
    const [me] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    const [n] = await db.select().from(notifications).where(eq(notifications.dedupeKey, `practice:${jamTask}:${me!.id}`));
    expect(n!.title).toBe("From your trainer: How UPI changed the way we pay");
    expect(n!.link!.endsWith("/play/jam?topic=upi")).toBe(true);
    expect(n!.body).toMatch(/^JAM talk\. Do it by /);
  });

  it("count the student's own attempt at the practice, in the task's window", async () => {
    const mine = async () => (await t.get(riya, "/student/practice-tasks")).body.tasks.find((x: { id: string }) => x.id === jamTask);
    expect(await mine()).toMatchObject({ subject: "How UPI changed the way we pay", note: "Give one example from your own life.", open: true, done: null, path: "/play/jam?topic=upi" });
    // A talk on another topic doesn't count.
    await t.post(riya, "/student/jam", { topicId: "silence", transcript: TALK, spokenMs: 60_000 });
    expect((await mine()).done).toBeNull();
    expect((await t.get(riya, "/student/calendar")).body.events.some((e: { title: string }) => e.title === "Due: JAM talk: How UPI changed the way we pay")).toBe(true);
    await t.post(riya, "/student/jam", { topicId: "upi", transcript: TALK, spokenMs: 58_000 });
    expect((await mine()).done).toMatchObject({ score: 3, outOf: 5 });
    // Done: off the calendar.
    expect((await t.get(riya, "/student/calendar")).body.events.some((e: { title: string }) => e.title.startsWith("Due: JAM talk"))).toBe(false);
  });

  it("show staff who has done it, with scores", async () => {
    const list = (await t.get(faculty, "/console/practice-tasks")).body.tasks;
    expect(list[0]).toMatchObject({ id: jamTask, kind: "jam", subject: "How UPI changed the way we pay", done: 1, average: 3, outOf: 5 });
    const detail = (await t.get(faculty, `/console/practice-tasks/${jamTask}`)).body;
    expect(detail.students.find((s: { name: string }) => s.name === "Riya Kapoor").done).toMatchObject({ score: 3 });
    expect(detail.students.filter((s: { done: unknown }) => !s.done).length).toBe(list[0].targeted - 1);
    expect((await t.get(await t.login("admin@sunrise.edu"), `/console/practice-tasks/${jamTask}`)).status).toBe(404);
  });

  it("take drills without AI, and refuse AI-marked tasks when AI is off", async () => {
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ settings: { ...demo!.settings, aiHints: false } }).where(eq(tenants.id, demo!.id));
    expect((await t.post(faculty, "/console/practice-tasks", { kind: "writing", ref: "email-contest", unitIds: [section], closeAt: due(3) })).body.error.message).toMatch(/Set a drill instead/);
    const drill = await t.post(faculty, "/console/practice-tasks", { kind: "read", unitIds: [section], closeAt: due(2) });
    expect(drill.status).toBe(200);
    await db.update(tenants).set({ settings: demo!.settings }).where(eq(tenants.id, demo!.id));
    await t.post(riya, "/student/speaking-drills", { kind: "read", items: [{ sentenceId: "s25", heard: "The company is looking for graduates who communicate clearly and learn quickly", spokenMs: 5000 }] });
    const tasks = (await t.get(riya, "/student/practice-tasks")).body.tasks;
    expect(tasks.find((x: { id: string }) => x.id === drill.body.task.id)).toMatchObject({ kind: "read", subject: null, path: "/play/speaking-drills?start=read", done: { score: 100, outOf: 100 } });
  });

  it("remind students who haven't done one due within a day, once", async () => {
    const soon = new Date(START.getTime() + 1.5 * DAY);
    const queued = await practiceTaskReminders(db, soon);
    expect(queued).toBeGreaterThan(0);
    const [me] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    // Riya did the drill, so she isn't reminded.
    expect((await db.select().from(notifications).where(eq(notifications.userId, me!.id))).some((n) => n.dedupeKey?.startsWith("practice-due:"))).toBe(false);
    expect(await practiceTaskReminders(db, new Date(soon.getTime() + 3_600_000))).toBe(0);
  });

  it("can be deleted by staff in scope", async () => {
    expect((await t.delete(await t.login("admin@sunrise.edu"), `/console/practice-tasks/${jamTask}`)).status).toBe(404);
    expect((await t.delete(faculty, `/console/practice-tasks/${jamTask}`)).body).toEqual({ ok: true });
    expect((await t.get(riya, "/student/practice-tasks")).body.tasks.some((x: { id: string }) => x.id === jamTask)).toBe(false);
  });
});
