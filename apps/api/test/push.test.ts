import { eq } from "drizzle-orm";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, pushSubscriptions, tenants, users } from "../src/db/schema";
import { enqueue, processOutbox } from "../src/services/notifications";
import { setPushSender } from "../src/services/push";
import { setup, type TestApp } from "./helpers";

let t: TestApp;
let student: string;
const sent: { endpoint: string; payload: unknown }[] = [];
let failWith: number | null = null;
const fcm = "https://fcm.googleapis.com/fcm/send/abc123";
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

beforeAll(async () => {
  t = await setup();
  student = await t.login("student@demo.edu");
  setPushSender(async (sub, payload) => {
    if (failWith) throw Object.assign(new Error("gone"), { statusCode: failWith });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  });
});

afterAll(async () => {
  setPushSender(undefined);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await t.app.close();
  await pool.end();
});

async function notify(title: string) {
  const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
  await enqueue(db, [{ tenantId: u!.tenantId!, userId: u!.id, template: "announcement", title, body: "Details inside.", link: "http://localhost:3000/play", dedupeKey: `test:${title}` }]);
  return processOutbox(db, t.clock.now);
}

describe("web push", () => {
  it("is off until VAPID keys are configured", async () => {
    expect((await t.get(student, "/push")).body).toEqual({ available: false, publicKey: null, devices: 0 });
    expect((await t.post(student, "/push/subscribe", { endpoint: fcm, keys })).status).toBe(400);
    const vapid = webpush.generateVAPIDKeys();
    Object.assign(process.env, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey });
    expect((await t.get(student, "/push")).body).toMatchObject({ available: true, publicKey: vapid.publicKey });
  });

  it("only accepts subscriptions from browser push services", async () => {
    for (const endpoint of ["http://169.254.169.254/latest/meta-data", "https://evil.example.com/push", "https://fcm.googleapis.com.evil.com/x"]) {
      expect((await t.post(student, "/push/subscribe", { endpoint, keys })).status).toBe(400);
    }
    const ok = await t.post(student, "/push/subscribe", { endpoint: fcm, keys });
    expect(ok.body).toEqual({ ok: true, devices: 1 });
    // Subscribing the same browser again doesn't add a device.
    expect((await t.post(student, "/push/subscribe", { endpoint: fcm, keys })).body.devices).toBe(1);
  });

  it("pushes notifications to the student's devices", async () => {
    // The outbox also carries the seeded "company is hiring" messages for this student.
    const summary = await notify("Mock test tomorrow");
    expect(summary.pushed).toBeGreaterThanOrEqual(1);
    expect(sent).toContainEqual({ endpoint: fcm, payload: { title: "Mock test tomorrow", body: "Details inside.", link: "http://localhost:3000/play" } });
    const [n] = await db.select().from(notifications).where(eq(notifications.dedupeKey, "test:Mock test tomorrow"));
    expect(n!.pushedAt).not.toBeNull();
  });

  it("drops subscriptions the push service says are gone", async () => {
    failWith = 410;
    expect((await notify("Second message")).pushed).toBe(0);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
    failWith = null;
  });

  it("respects an institution that turned automatic nudges off", async () => {
    await t.post(student, "/push/subscribe", { endpoint: fcm, keys });
    const [demo] = await db.select().from(tenants).where(eq(tenants.slug, "demo-tech"));
    await db.update(tenants).set({ settings: { ...demo!.settings, nudges: false } }).where(eq(tenants.id, demo!.id));
    const [u] = await db.select().from(users).where(eq(users.email, "student@demo.edu"));
    await enqueue(db, [{ tenantId: demo!.id, userId: u!.id, template: "streak_at_risk", title: "Keep your streak", body: "x", dedupeKey: "test:streak" }]);
    const before = sent.length;
    await processOutbox(db, t.clock.now);
    expect(sent.length).toBe(before);
    await db.update(tenants).set({ settings: demo!.settings }).where(eq(tenants.id, demo!.id));
    expect((await t.post(student, "/push/unsubscribe", { endpoint: fcm })).body.devices).toBe(0);
  });
});
