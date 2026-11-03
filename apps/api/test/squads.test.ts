import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, playerProfiles, squads, users } from "../src/db/schema";
import { squadReminders, squadStreak } from "../src/services/squads";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const mates = ["aarav.sharma1@demo.edu", "aditya.das13@demo.edu", "aisha.verma30@demo.edu", "ananya.menon2@demo.edu", "anjali.joshi26@demo.edu"];
const tokens: Record<string, string> = {};
const idOf = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!.id;

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  for (const email of [...mates, "divya.iyer14@demo.edu"]) tokens[email] = await t.login(email);
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("squad streaks", () => {
  it("counts weeks in a row that hit the goal, from when the squad began", () => {
    const today = "2026-10-22"; // a Thursday in week 43
    const weeks = new Map([
      ["2026-W43", 40],
      ["2026-W42", 120],
      ["2026-W41", 100],
      ["2026-W40", 90],
      ["2026-W39", 200],
    ]);
    expect(squadStreak(weeks, 100, "2026-W43", today, "2026-W30")).toBe(2); // W42 and W41; W40 missed
    expect(squadStreak(weeks, 100, "2026-W43", today, "2026-W42")).toBe(1); // the squad began in W42
    expect(squadStreak(new Map([...weeks, ["2026-W43", 100]]), 100, "2026-W43", today, "2026-W30")).toBe(3); // this week counts once it's hit
  });
});

describe("study squads", () => {
  let code: string;

  it("lets a student start one and classmates join with its code", async () => {
    expect((await t.get(riya, "/student/squad")).body).toMatchObject({ squad: null, goals: [50, 100, 150, 200, 300] });
    expect((await t.post(riya, "/student/squad", { name: "Byte Club", weeklyGoal: 77 })).status).toBe(400);
    const created = (await t.post(riya, "/student/squad", { name: "Byte Club", weeklyGoal: 50 })).body.squad;
    expect(created).toMatchObject({ name: "Byte Club", weeklyGoal: 50, canEditGoal: true, streakWeeks: 0, members: [{ name: "Riya Kapoor", me: true }] });
    code = created.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await t.post(riya, "/student/squad", { name: "Another" })).body.error.code).toBe("already_in_squad");

    for (const email of mates) expect((await t.post(tokens[email]!, "/student/squad/join", { code: code.toLowerCase() })).status).toBe(200);
    expect((await t.post(tokens["divya.iyer14@demo.edu"]!, "/student/squad/join", { code })).body.error.code).toBe("squad_full");
    // Another college's students can't join.
    expect((await t.post(await t.login("sunrise.student1@sunrise.edu"), "/student/squad/join", { code })).status).toBe(404);
    const view = (await t.get(tokens[mates[0]!]!, "/student/squad")).body.squad;
    expect(view.members).toHaveLength(6);
    expect(view.canEditGoal).toBe(false);
    // Squadmates see effort, not scores or mastery.
    expect(Object.keys(view.members[0]).sort()).toEqual(["answersThisWeek", "id", "me", "name", "practisedToday", "streak"]);
  });

  it("adds up the squad's answers this week", async () => {
    const before = (await t.get(riya, "/student/squad")).body.squad;
    let s = (await t.post(riya, "/student/sessions", { kind: "daily" })).body;
    let n = 0;
    while (!s.finished) {
      s = (await t.post(riya, `/student/sessions/${s.id}/answer`, { questionId: s.question.id, response: rightAnswer(s.question.id), timeMs: 20_000 })).body.session;
      n++;
    }
    const after = (await t.get(riya, "/student/squad")).body.squad;
    expect(after.week.answers).toBe(before.week.answers + n);
    expect(after.members.find((m: { me: boolean }) => m.me)).toMatchObject({ practisedToday: true, answersThisWeek: before.members.find((m: { me: boolean }) => m.me).answersThisWeek + n });
    expect(after.week.daysLeft).toBe(4); // Thursday to Sunday
  });

  it("lets squadmates nudge someone who hasn't practised today, once a day", async () => {
    const aarav = await idOf(mates[0]!);
    await db.update(playerProfiles).set({ streakLastDate: "2026-10-20" }).where(eq(playerProfiles.userId, aarav));
    expect((await t.post(riya, "/student/squad/nudge", { userId: aarav })).status).toBe(200);
    expect((await t.post(riya, "/student/squad/nudge", { userId: aarav })).body.error.code).toBe("already_nudged");
    const inbox = await db.select().from(notifications).where(eq(notifications.userId, aarav));
    expect(inbox.find((x) => x.template === "squad")).toMatchObject({ title: "Riya nudged you" });
    // Riya practised today, and strangers can't be nudged.
    expect((await t.post(tokens[mates[0]!]!, "/student/squad/nudge", { userId: await idOf("student@demo.edu") })).body.error.code).toBe("already_practised");
    expect((await t.post(riya, "/student/squad/nudge", { userId: await idOf("divya.iyer14@demo.edu") })).status).toBe(404);
  });

  it("lets only the founder change the goal", async () => {
    expect((await t.put(tokens[mates[0]!]!, "/student/squad", { weeklyGoal: 100 })).status).toBe(403);
    expect((await t.put(riya, "/student/squad", { weeklyGoal: 300 })).body.squad.weeklyGoal).toBe(300);
  });

  it("reminds the squad on Friday evening when it's well short, once", async () => {
    const answers = (await t.get(riya, "/student/squad")).body.squad.week.answers;
    expect(answers).toBeLessThan(180); // under 60% of 300
    expect(await squadReminders(db, new Date(START.getTime() + 20 * 3_600_000))).toBe(0); // Friday 08:00: too early
    expect(await squadReminders(db, new Date(START.getTime() + 30 * 3_600_000))).toBe(6); // Friday 18:00
    expect(await squadReminders(db, new Date(START.getTime() + 31 * 3_600_000))).toBe(0);
    // Four squadmates do their daily challenge, taking the squad past a goal of 50: a celebration, once.
    for (const email of mates.slice(1)) {
      let s = (await t.post(tokens[email]!, "/student/sessions", { kind: "daily" })).body;
      while (!s.finished) s = (await t.post(tokens[email]!, `/student/sessions/${s.id}/answer`, { questionId: s.question.id, response: rightAnswer(s.question.id), timeMs: 20_000 })).body.session;
    }
    await t.put(riya, "/student/squad", { weeklyGoal: 50 });
    const now = (await t.get(riya, "/student/squad")).body.squad.week;
    expect(now).toMatchObject({ answers: answers + 20, reached: true });
    expect(await squadReminders(db, new Date(START.getTime() + 32 * 3_600_000))).toBe(6);
    expect(await squadReminders(db, new Date(START.getTime() + 33 * 3_600_000))).toBe(0);
    const titles = (await db.select().from(notifications).where(eq(notifications.template, "squad"))).map((n) => n.title);
    expect(titles.filter((x) => x === "Byte Club hit its goal")).toHaveLength(6);
    expect(titles.filter((x) => x === "Byte Club needs a push")).toHaveLength(6);
  });

  it("closes the squad when the last member leaves", async () => {
    for (const email of mates) await t.post(tokens[email]!, "/student/squad/leave");
    expect((await t.post(riya, "/student/squad/leave")).body.squad).toBeNull();
    expect(await db.select().from(squads)).toHaveLength(0);
  });
});
