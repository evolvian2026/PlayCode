import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client";
import { notifications, peerFeedback, peerSessions, users } from "../src/db/schema";
import { setMailer, type Mail } from "../src/lib/mailer";
import { weeklyDigests } from "../src/services/digest";
import { peerJob } from "../src/services/peer";
import { setup, START, type TestApp } from "./helpers";

// START is Thursday 22 October 2026, noon in India.
let t: TestApp;
let tpo: string;
let riya: string;
let kavya: string;
let aarav: string;
const id: Record<string, string> = {};
const HOUR = 3_600_000;
const ask = (token: string, body: object) => t.post(token, "/student/peer/request", { track: "hr", mode: "online", windows: [{ date: "2026-10-23", slot: "evening" }], ...body });
type Peer = { request: unknown; upcoming: { id: string; partner: { name: string }; askFirst: boolean; questions: { q: string }[]; mode: string; place: string; startsAt: string }[]; past: { id: string; given: unknown; received: unknown }[] };
const peer = async (token: string): Promise<Peer> => (await t.get(token, "/student/peer")).body;

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  riya = await t.login("student@demo.edu");
  kavya = await t.login("kavya.singh8@demo.edu");
  aarav = await t.login("aarav.sharma1@demo.edu");
  for (const [k, email] of [["riya", "student@demo.edu"], ["kavya", "kavya.singh8@demo.edu"], ["aarav", "aarav.sharma1@demo.edu"]] as const) id[k] = (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
});

afterAll(async () => {
  setMailer(undefined);
  await t.app.close();
  await pool.end();
});

describe("peer mock interviews", () => {
  it("takes a request for times in the next week", async () => {
    expect((await ask(riya, { windows: [{ date: "2026-11-05", slot: "evening" }] })).status).toBe(400);
    expect((await ask(riya, { windows: [{ date: "2026-10-22", slot: "morning" }] })).status).toBe(400); // already past
    const res = await ask(riya, { windows: [{ date: "2026-10-22", slot: "morning" }, { date: "2026-10-23", slot: "evening" }, { date: "2026-10-24", slot: "morning" }] });
    expect(res.status).toBe(200);
    expect(res.body.request.windows).toEqual([{ date: "2026-10-23", slot: "evening" }, { date: "2026-10-24", slot: "morning" }]);
    expect(res.body.upcoming).toEqual([]);
    expect((await ask(riya, {})).status).toBe(409);
  });

  it("pairs students whose times and mode overlap", async () => {
    // Requests a minute apart, so "oldest first" has an order.
    const tick = () => (t.clock.now = new Date(t.clock.now.getTime() + 60_000));
    tick();
    // In person only: no match with Riya, who wants online.
    expect((await ask(aarav, { mode: "in_person" })).body.upcoming).toEqual([]);
    tick();
    const res = await ask(kavya, { mode: "either", windows: [{ date: "2026-10-24", slot: "morning" }, { date: "2026-10-23", slot: "evening" }] });
    const [s] = res.body.upcoming;
    expect(s).toMatchObject({ partner: { name: "Riya Kapoor" }, mode: "online", startsAt: "2026-10-23T12:30:00.000Z", askFirst: false });
    expect(s.place).toMatch(/^https:\/\/meet\.jit\.si\/PlayCode-/);
    const mine = (await peer(riya)).upcoming[0]!;
    expect(mine).toMatchObject({ partner: { name: "Kavya Singh" }, askFirst: true, place: s.place });
    expect(mine.questions).toHaveLength(4);
    expect(mine.questions.some((q) => s.questions.some((x: { q: string }) => x.q === q.q))).toBe(false);
    const notes = await db.select().from(notifications).where(and(inArray(notifications.userId, [id.riya!, id.kavya!]), like(notifications.title, "Practice partner found%")));
    expect(notes).toHaveLength(2);
    expect((await ask(riya, {})).status).toBe(409); // a session is coming up
  });

  it("collects feedback after the session, showing it once the student has given theirs", async () => {
    const sessionId = (await peer(riya)).upcoming[0]!.id;
    const rate = (token: string, body: object = {}) => t.post(token, `/student/peer/sessions/${sessionId}/feedback`, { ratings: { clarity: 4, content: 3, confidence: 4 }, comment: "Clear, but give an example for each answer.", ...body });
    expect((await rate(riya)).status).toBe(400); // not yet
    t.clock.now = new Date("2026-10-23T14:00:00Z");
    expect((await rate(riya, { ratings: null })).status).toBe(400);
    expect((await rate(riya)).status).toBe(200);
    expect((await rate(riya)).status).toBe(409);
    expect((await peer(kavya)).past[0]!.received).toBe("hidden");
    await rate(kavya, { ratings: { clarity: 5, content: 4, confidence: 3 }, comment: "Good energy." });
    const k = await peer(kavya);
    expect(k.past[0]!.received).toMatchObject({ ratings: { clarity: 4, content: 3, confidence: 4 }, comment: "Clear, but give an example for each answer." });
    expect((await t.get(kavya, "/student/peer")).body.averages).toEqual({ clarity: 4, content: 3, confidence: 4 });
  });

  it("expires requests nobody matched, and reminds partners before a session", async () => {
    // Aarav's only window (Friday evening) has passed.
    t.clock.now = new Date("2026-10-23T14:00:00Z");
    const before = await peerJob(db, t.clock.now);
    expect(before.expired).toBeGreaterThanOrEqual(1);
    expect((await peer(aarav)).request).toBeNull();
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, id.aarav!), like(notifications.title, "No practice partner this time")));
    expect(note).toBeDefined();

    await ask(aarav, { mode: "either", windows: [{ date: "2026-10-24", slot: "morning" }] });
    const second = await ask(riya, { windows: [{ date: "2026-10-24", slot: "morning" }] });
    const s = second.body.upcoming[0];
    expect(s.partner.name).toBe("Aarav Sharma");
    t.clock.now = new Date(new Date(s.startsAt).getTime() - 30 * 60_000);
    expect((await peerJob(db, t.clock.now)).reminded).toBe(1);
    expect((await peerJob(db, t.clock.now)).reminded).toBe(0);
  });

  it("lets a student call a session off, and pauses those who keep missing them", async () => {
    t.clock.now = new Date("2026-10-23T14:00:00Z");
    const s = (await peer(riya)).upcoming[0]!;
    await t.post(riya, `/student/peer/sessions/${s.id}/cancel`);
    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, id.aarav!), like(notifications.title, "Riya Kapoor called off%")));
    expect(note).toBeDefined();
    expect((await peer(riya)).upcoming).toEqual([]);

    // Two missed sessions in a month pause requests for two weeks.
    const tenantId = (await db.select().from(users).where(eq(users.id, id.aarav!)))[0]!.tenantId!;
    for (const days of [5, 2]) {
      const [x] = await db.insert(peerSessions).values({ tenantId, track: "hr", mode: "online", place: "x", startsAt: new Date(START.getTime() - days * 24 * HOUR), aId: id.riya!, bId: id.aarav!, seed: days, createdAt: START }).returning();
      await db.insert(peerFeedback).values({ sessionId: x!.id, fromId: id.riya!, toId: id.aarav!, partnerAbsent: true, createdAt: new Date(START.getTime() - days * 24 * HOUR + HOUR) });
    }
    const res = await ask(aarav, { windows: [{ date: "2026-10-25", slot: "evening" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("You can ask again from");
  });
});

describe("the placement week", () => {
  it("lists drives, offers and every queue waiting on staff", async () => {
    t.clock.now = new Date(START);
    const w = (await t.get(tpo, "/console/week")).body;
    const q = Object.fromEntries(w.queues.map((x: { key: string; count: number }) => [x.key, x.count]));
    expect(q).toMatchObject({ intros: 1, follow_ups: 2, joining: 1 });
    expect(w.waiting).toBe(w.queues.reduce((n: number, x: { count: number }) => n + x.count, 0));
    // The seeded session, and the two missed ones from the test above.
    expect(w.peer).toMatchObject({ sessions: 1, students: 2, noShows: 2 });
    expect(w.digest).toEqual({ enabled: true, emailConfigured: false });
    expect((await t.get(riya, "/console/week")).status).toBe(403);
  });

  it("emails it on Monday morning, once, to those who haven't switched it off", async () => {
    const sent: Mail[] = [];
    setMailer({ send: async (m) => void sent.push(m) });
    expect((await t.put(tpo, "/console/week/digest", { enabled: false })).body.enabled).toBe(false);
    expect(await weeklyDigests(db, new Date("2026-10-26T01:30:00Z"))).toBe(0); // Monday 07:00 in India: too early
    const monday = new Date("2026-10-26T03:30:00Z");
    const n = await weeklyDigests(db, monday);
    expect(n).toBeGreaterThan(0);
    expect(sent.map((m) => m.to)).toContain("admin@demo.edu");
    expect(sent.map((m) => m.to)).not.toContain("tpo@demo.edu");
    expect(sent.map((m) => m.to)).not.toContain("hr@acme.dev"); // a company, not an institution
    const mail = sent.find((m) => m.to === "admin@demo.edu")!;
    expect(mail.subject).toMatch(/^Demo Institute of Technology: the placement week \(\d+ waiting on you\)$/);
    expect(mail.text).toContain("Company follow-ups due");
    expect(await weeklyDigests(db, new Date(monday.getTime() + HOUR))).toBe(0);
  });
});
