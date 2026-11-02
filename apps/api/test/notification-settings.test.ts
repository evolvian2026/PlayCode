import { msg } from "@playcode/core";
import { and, eq, gte } from "drizzle-orm";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, responses, users, type NotificationTemplate } from "../src/db/schema";
import { enqueue, processOutbox } from "../src/services/notifications";
import { setPushSender } from "../src/services/push";
import { weeklySummaries } from "../src/services/weekly-summary";
import { setup, START, type TestApp } from "./helpers";

let t: TestApp;
let riya: string;
const pushed: string[] = [];
const fcm = "https://fcm.googleapis.com/fcm/send/settings-test";
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

beforeAll(async () => {
  t = await setup();
  riya = await t.login("student@demo.edu");
  const vapid = webpush.generateVAPIDKeys();
  Object.assign(process.env, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey });
  setPushSender(async (_sub, payload) => {
    pushed.push(JSON.parse(payload).title);
  });
  await t.post(riya, "/push/subscribe", { endpoint: fcm, keys });
  // Deliver what the seed left in the outbox, so each test sees only its own messages.
  await processOutbox(db, t.clock.now, 5000);
  pushed.length = 0;
});

afterAll(async () => {
  setPushSender(undefined);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await t.app.close();
  await pool.end();
});

const riyaRow = async () => (await db.select().from(users).where(eq(users.email, "student@demo.edu")))[0]!;

async function notify(template: NotificationTemplate, title: string) {
  const u = await riyaRow();
  await enqueue(db, [{ tenantId: u.tenantId!, userId: u.id, template, title: msg(title), body: msg("Details inside."), dedupeKey: `settings-test:${title}` }]);
  const [n] = await db.select().from(notifications).where(eq(notifications.dedupeKey, `settings-test:${title}`));
  return n!.id;
}
const row = async (id: string) => (await db.select().from(notifications).where(eq(notifications.id, id)))[0]!;

describe("notification settings", () => {
  it("start with every category on and quiet hours from 10 pm to 7 am", async () => {
    const res = await t.get(riya, "/student/settings");
    expect(res.body).toMatchObject({ muted: [], quiet: { from: "22:00", to: "07:00" } });
  });

  it("save muted categories and quiet hours, but placements can't be muted", async () => {
    const res = await t.put(riya, "/student/settings", { muted: ["practice", "classmates"], quiet: { from: "23:00", to: "06:00" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ muted: ["practice", "classmates"], quiet: { from: "23:00", to: "06:00" } });
    expect((await t.put(riya, "/student/settings", { muted: ["placements"] })).status).toBe(400);
    expect((await t.put(riya, "/student/settings", { quiet: { from: "25:00", to: "06:00" } })).status).toBe(400);
    // Other settings are left as they were.
    expect((await t.put(riya, "/student/settings", { whatsapp: true })).body).toMatchObject({ muted: ["practice", "classmates"], quiet: { from: "23:00", to: "06:00" } });
  });

  it("keep a muted category off the phone but in Messages", async () => {
    const streak = await notify("streak_at_risk", "Keep your 4-day streak");
    const drive = await notify("placement", "Infosys is hiring");
    await processOutbox(db, t.clock.now, 5000);
    expect(pushed).toEqual(["Infosys is hiring"]);
    expect((await row(streak)).pushedAt).toBeNull();
    expect((await row(drive)).pushedAt).not.toBeNull();
    const inbox = await t.get(riya, "/student/notifications");
    expect(inbox.body.items.map((i: { title: string }) => i.title)).toContain("Keep your 4-day streak");
  });

  it("hold phone notifications in quiet hours and send them when they end", async () => {
    pushed.length = 0;
    await t.put(riya, "/student/settings", { muted: [], quiet: { from: "22:00", to: "07:00" } });
    // 11:30 pm in India.
    const night = new Date("2026-10-22T18:00:00Z");
    const id = await notify("test_open", "Test open: Arrays quiz");
    expect((await processOutbox(db, night, 5000)).held).toBe(1);
    expect(pushed).toEqual([]);
    expect((await row(id)).deliverAfter).toEqual(new Date("2026-10-23T01:30:00Z")); // 7 am
    // Still held at 6 am; sent at 7.
    await processOutbox(db, new Date("2026-10-23T00:30:00Z"), 5000);
    expect(pushed).toEqual([]);
    await processOutbox(db, new Date("2026-10-23T01:30:00Z"), 5000);
    expect(pushed).toEqual(["Test open: Arrays quiz"]);
    expect((await row(id)).pushedAt).not.toBeNull();
  });

  it("send nothing at night when quiet hours are off", async () => {
    pushed.length = 0;
    await t.put(riya, "/student/settings", { quiet: null });
    expect((await t.get(riya, "/student/settings")).body.quiet).toBeNull();
    await notify("test_open", "Test open: Strings quiz");
    expect((await processOutbox(db, new Date("2026-10-22T18:00:00Z"), 5000)).held).toBe(0);
    expect(pushed).toEqual(["Test open: Strings quiz"]);
  });
});

describe("your week", () => {
  // Sunday 25 October, 7 pm in India.
  const sunday = new Date("2026-10-25T13:30:00Z");

  it("is only sent on Sunday evening", async () => {
    expect(await weeklySummaries(db, START)).toBe(0);
    expect(await weeklySummaries(db, new Date("2026-10-25T05:30:00Z"))).toBe(0); // Sunday 11 am
  });

  it("sums up the student's week once", async () => {
    const queued = await weeklySummaries(db, sunday);
    expect(queued).toBeGreaterThan(0);
    const u = await riyaRow();
    const notes = await db.select().from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.template, "weekly_summary")));
    expect(notes).toHaveLength(1);
    const answers = (await db.select().from(responses).where(and(eq(responses.userId, u.id), gte(responses.createdAt, new Date(sunday.getTime() - 7 * 86_400_000))))).length;
    expect(notes[0]!.title).toBe(answers > 0 ? `Your week: ${answers} answers` : "Your week: no practice this week");
    expect(notes[0]!.body).toMatch(/^\d+-day streak · \d+ skills mastered · \d+ due in the next 7 days$/);
    // An hour later, nothing new.
    await weeklySummaries(db, new Date(sunday.getTime() + 3_600_000));
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.template, "weekly_summary")))).toHaveLength(1);
  });

  it("goes to students only", async () => {
    const [faculty] = await db.select().from(users).where(eq(users.email, "faculty@demo.edu"));
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, faculty!.id), eq(notifications.template, "weekly_summary")))).toHaveLength(0);
  });
});
