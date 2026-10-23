import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, skillRatings, users } from "../src/db/schema";
import { runNudges } from "../src/services/nudges";
import { rightAnswer, setup, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let userId: string;

beforeAll(async () => {
  t = await setup();
  [{ id: userId }] = (await db.select({ id: users.id }).from(users).where(eq(users.email, "student@demo.edu"))) as [{ id: string }];
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

async function setReview(skillId: string, values: { rating: number; reviewStep: number; reviewDueOn: string | null }) {
  await db
    .insert(skillRatings)
    .values({ userId, skillId, attempts: 10, correct: 6, lastPractisedAt: "2026-10-01", ...values })
    .onConflictDoUpdate({ target: [skillRatings.userId, skillRatings.skillId], set: values });
}

const rating = async (skillId: string) => (await db.select().from(skillRatings).where(and(eq(skillRatings.userId, userId), eq(skillRatings.skillId, skillId))))[0]!;

describe("spaced review", () => {
  beforeAll(async () => {
    // Everything fresh, then two learned skills due and one weak skill due (too weak to review).
    await db.update(skillRatings).set({ reviewDueOn: "2026-12-31" }).where(eq(skillRatings.userId, userId));
    await setReview("loops.for", { rating: 1300, reviewStep: 2, reviewDueOn: "2026-10-10" });
    await setReview("strings.basics", { rating: 1100, reviewStep: 1, reviewDueOn: "2026-10-20" });
    await setReview("recursion.basics", { rating: 700, reviewStep: 0, reviewDueOn: "2026-10-01" });
  });

  it("shows due skills on the home screen, most overdue first", async () => {
    const token = await t.login("student@demo.edu");
    const home = (await t.get(token, "/student/home")).body;
    expect(home.review.dueCount).toBe(2);
    expect(home.review.skills.map((s: { id: string }) => s.id)).toEqual(["loops.for", "strings.basics"]);
    expect(home.review.skills[0].overdueDays).toBe(12);
    const map = (await t.get(token, "/student/map")).body;
    const loops = map.topics.flatMap((tp: { skills: { id: string; reviewDue: boolean }[] }) => tp.skills).find((s: { id: string }) => s.id === "loops.for");
    expect(loops.reviewDue).toBe(true);
  });

  it("runs an interleaved review that moves skills along the ladder, without hearts", async () => {
    const token = await t.login("student@demo.edu");
    let session = (await t.post(token, "/student/sessions", { kind: "review" })).body;
    expect(session.title).toBe("Skill review");
    expect(session.total).toBe(4);
    // Starting again resumes the same session.
    expect((await t.post(token, "/student/sessions", { kind: "review" })).body.id).toBe(session.id);
    const heartsBefore = (await t.get(token, "/student/home")).body.profile.hearts;

    // First question is from the most overdue skill: remembered, so it moves up a step.
    let q = session.question.id;
    session = (await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: q, response: rightAnswer(q), timeMs: 20_000 })).body.session;
    expect(await rating("loops.for")).toMatchObject({ reviewStep: 3, reviewDueOn: "2026-11-21" });

    // Second is the other skill: forgotten, so it moves down a step and comes back sooner.
    q = session.question.id;
    session = (await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: q, response: wrongAnswer(q), timeMs: 20_000 })).body.session;
    expect(await rating("strings.basics")).toMatchObject({ reviewStep: 0, reviewDueOn: "2026-10-24" });
    expect((await t.get(token, "/student/home")).body.profile.hearts).toBe(heartsBefore);

    for (const _ of [1, 2]) {
      q = session.question.id;
      session = (await t.post(token, `/student/sessions/${session.id}/answer`, { questionId: q, response: rightAnswer(q), timeMs: 20_000 })).body.session;
    }
    expect(session.finished).toBe(true);
    // A second right answer the same day doesn't move loops.for up again.
    expect((await rating("loops.for")).reviewStep).toBe(3);
    const home = (await t.get(token, "/student/home")).body;
    expect(home.review.dueCount).toBe(0);
    expect((await t.post(token, "/student/sessions", { kind: "review" })).status).toBe(400);
  });

  it("nudges students with several fading skills once a week", async () => {
    await setReview("loops.for", { rating: 1300, reviewStep: 2, reviewDueOn: "2026-10-10" });
    await setReview("strings.basics", { rating: 1100, reviewStep: 1, reviewDueOn: "2026-10-20" });
    await setReview("arrays.basics", { rating: 1200, reviewStep: 1, reviewDueOn: "2026-10-21" });
    const first = await runNudges(db, t.clock.now, { ignoreQuietHours: true });
    expect(first.review).toBeGreaterThanOrEqual(1);
    const mine = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.template, "review_due")));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toBe("3 skills are fading");
    await runNudges(db, t.clock.now, { ignoreQuietHours: true });
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.template, "review_due")))).toHaveLength(1);
  });
});
