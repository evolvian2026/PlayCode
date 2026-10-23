import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let units: Record<string, string>;
let n = 0;

async function student(section: string) {
  const email = `engage${++n}@demo.edu`;
  const res = await t.post(tpo, "/console/students/import", { unitId: units[section], csv: `Engager ${n},${email},G${n},+91 98765 4321${n % 10}`, defaultPassword: "student-pass-1" });
  expect(res.body.created[0].phone).toMatch(/^\+91/);
  return t.login(email, "student-pass-1");
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  units = Object.fromEntries((await t.get(tpo, "/console/org-units")).body.units.map((u: { name: string; id: string }) => [u.name, u.id]));
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("events", () => {
  it("ranks sections by XP per member during the event", async () => {
    t.clock.now = new Date(START);
    const ev = await t.post(tpo, "/console/competitions", {
      title: "Section showdown",
      unitIds: [units["CSE 2027 - A"], units["CSE 2027 - B"]],
      startsAt: START.toISOString(),
      endsAt: new Date(START.getTime() + 7 * 86_400_000).toISOString(),
    });
    expect(ev.status).toBe(200);
    const s = await student("CSE 2027 - B");
    t.clock.now = new Date(START.getTime() + 60_000);
    let session = (await t.post(s, "/student/sessions", { kind: "daily" })).body;
    while (!session.finished) {
      const qid = session.question.id;
      session = (await t.post(s, `/student/sessions/${session.id}/answer`, { questionId: qid, response: rightAnswer(qid), timeMs: 20_000 })).body.session;
    }
    const board = (await t.get(tpo, `/console/competitions/${ev.body.event.id}`)).body.leaderboard;
    expect(board[0].name).toBe("CSE 2027 - B");
    expect(board[0].totalXp).toBe(session.xpEarned);
    expect(board[1].totalXp).toBe(0);
    const mine = (await t.get(s, "/student/competitions")).body.events.find((e: { id: string }) => e.id === ev.body.event.id);
    expect(mine.myTeam.rank).toBe(1);
    expect(mine.state).toBe("live");
    // ECE students are not in this event.
    const ece = await student("ECE 2027 - A");
    expect((await t.get(ece, "/student/competitions")).body.events.some((e: { id: string }) => e.id === ev.body.event.id)).toBe(false);
    expect((await t.get(s, "/console/competitions")).status).toBe(403);
  });

  it("lets PlayCode run an inter-college event", async () => {
    const sa = await t.login("superadmin@playcode.dev");
    const other = await t.post(sa, "/admin/tenants", { name: "Rival College", slug: "rival", admin: { name: "R", email: "admin@rival.edu", password: "longpassword" } });
    const me = (await t.get(tpo, "/me")).body;
    const ev = await t.post(sa, "/admin/competitions", {
      title: "Inter-college cup",
      tenantIds: [me.tenant.id, other.body.tenant.id],
      startsAt: START.toISOString(),
      endsAt: new Date(START.getTime() + 86_400_000).toISOString(),
    });
    expect(ev.status).toBe(200);
    const list = (await t.get(tpo, "/console/competitions")).body.events;
    const cup = list.find((e: { title: string }) => e.title === "Inter-college cup");
    expect(cup.leaderboard.map((r: { name: string }) => r.name).sort()).toEqual(["Demo Institute of Technology", "Rival College"]);
    expect((await t.post(tpo, "/admin/competitions", {})).status).toBe(403);
  });
});

describe("nudges and notifications", () => {
  it("queues automatic nudges once each", async () => {
    t.clock.now = new Date(START);
    const first = await t.post(tpo, "/admin/nudges/run", { ignoreQuietHours: true });
    expect(first.status).toBe(200);
    // The seed has an open test for CSE 2027 and students who practised yesterday.
    expect(first.body.queued.test).toBeGreaterThan(0);
    expect(first.body.queued.streak).toBeGreaterThan(0);
    // Without WhatsApp configured, delivery is in-app only.
    expect(first.body.delivered.sent).toBe(0);
    const again = await t.post(tpo, "/admin/nudges/run", { ignoreQuietHours: true });
    // History also lists other messages (e.g. placement drives); count the automatic nudges.
    const automatic = ["streak_at_risk", "review_due", "assignment_due", "test_open"];
    const totalAgain = (await t.get(tpo, "/console/nudges")).body.history
      .filter((h: { template: string }) => automatic.includes(h.template))
      .reduce((a: number, h: { total: number }) => a + h.total, 0);
    const totalFirst = Object.values(first.body.queued as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(again.status).toBe(200);
    expect(totalAgain).toBe(totalFirst);
  });

  it("sends announcements to a filtered audience and shows them in the inbox", async () => {
    const quiet = await student("CSE 2027 - A");
    const preview = await t.post(tpo, "/console/nudges/preview", { unitId: units["CSE 2027 - A"], audience: "inactive_7d" });
    expect(preview.body.count).toBeGreaterThan(0);
    const sent = await t.post(tpo, "/console/nudges", { unitId: units["CSE 2027 - A"], audience: "inactive_7d", title: "Mock drive on Friday", message: "Practise 10 minutes a day this week." });
    expect(sent.body.sent).toBe(preview.body.count);
    const box = (await t.get(quiet, "/student/notifications")).body;
    expect(box.items.some((i: { title: string }) => i.title === "Mock drive on Friday")).toBe(true);
    expect(box.unread).toBeGreaterThan(0);
    await t.post(quiet, "/student/notifications/read", {});
    expect((await t.get(quiet, "/student/notifications")).body.unread).toBe(0);
    const faculty = await t.login("faculty@demo.edu");
    expect((await t.post(faculty, "/console/nudges/preview", { unitId: units["ECE 2027 - A"], audience: "all" })).status).toBe(403);
    expect((await t.post(quiet, "/console/nudges", {})).status).toBe(403);
  });

  it("lets students manage WhatsApp and turns automatic nudges off per institution", async () => {
    const s = await student("CSE 2027 - B");
    expect((await t.put(s, "/student/settings", { phone: "+91 90000 11111", whatsapp: false })).body).toEqual({ phone: "+919000011111", whatsapp: false, locale: "en" });
    expect((await t.put(s, "/student/settings", { phone: "call me" })).status).toBe(400);
    // Interface language is saved on the account and comes back with /me.
    expect((await t.put(s, "/student/settings", { locale: "hi" })).body.locale).toBe("hi");
    expect((await t.get(s, "/me")).body.user.locale).toBe("hi");
    expect((await t.put(s, "/student/settings", { locale: "fr" })).status).toBe(400);
    const admin = await t.login("admin@demo.edu");
    expect((await t.put(admin, "/console/settings/nudges", { enabled: false })).body.enabled).toBe(false);
    t.clock.now = new Date(START.getTime() + 2 * 86_400_000);
    const run = await t.post(tpo, "/admin/nudges/run", { ignoreQuietHours: true });
    expect(run.body.queued).toEqual({ streak: 0, review: 0, assignment: 0, test: 0 });
  });

  it("notifies a challenged student", async () => {
    t.clock.now = new Date(START.getTime() + 3 * 86_400_000);
    const a = await student("CSE 2027 - A");
    const b = await student("CSE 2027 - A");
    const bId = (await t.get(b, "/me")).body.user.id;
    await t.post(a, "/student/duels", { opponentId: bId });
    const box = (await t.get(b, "/student/notifications")).body;
    expect(box.items[0].template).toBe("duel_invite");
  });
});
