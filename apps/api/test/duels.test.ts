import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { pool } from "../src/db/client";
import { rightAnswer, setup, START, wrongAnswer, type TestApp } from "./helpers";

let t: TestApp;
let tpo: string;
let unitId: string;
let n = 0;

async function student() {
  const email = `duelist${++n}@demo.edu`;
  await t.post(tpo, "/console/students/import", { unitId, csv: `Duelist ${n},${email},D${n}`, defaultPassword: "student-pass-1" });
  const token = await t.login(email, "student-pass-1");
  const me = await t.get(token, "/me");
  return { token, id: me.body.user.id as string };
}

const at = (ms: number) => (t.clock.now = new Date(START.getTime() + ms));

/** Play all remaining questions, getting the first `right` of them right. */
async function play(token: string, duelId: string, right: number) {
  let d = (await t.get(token, `/student/duels/${duelId}`)).body;
  let i = 0;
  while (d.question) {
    const qid = d.question.id;
    const res = await t.post(token, `/student/duels/${duelId}/answer`, { questionId: qid, response: i < right ? rightAnswer(qid) : wrongAnswer(qid) });
    expect(res.status).toBe(200);
    d = res.body.duel;
    i++;
  }
  return d;
}

beforeAll(async () => {
  t = await setup();
  tpo = await t.login("tpo@demo.edu");
  const units = (await t.get(tpo, "/console/org-units")).body.units as { id: string; name: string }[];
  unitId = units.find((u) => u.name === "CSE 2027 - B")!.id;
});

afterAll(async () => {
  await t.app.close();
  await pool.end();
});

describe("duels", () => {
  it("runs a direct challenge from invite to result", async () => {
    at(0);
    const a = await student();
    const b = await student();
    const created = await t.post(a.token, "/student/duels", { opponentId: b.id });
    expect(created.body.status).toBe("waiting");
    const lobby = (await t.get(b.token, "/student/duels")).body;
    expect(lobby.invites.map((i: { id: string }) => i.id)).toContain(created.body.id);
    expect(lobby.classmates.some((c: { id: string }) => c.id === a.id)).toBe(true);

    const accepted = await t.post(b.token, `/student/duels/${created.body.id}/accept`, {});
    expect(accepted.body.status).toBe("active");
    expect(accepted.body.startsInMs).toBe(3000);
    expect(accepted.body.question).toBeNull(); // countdown first

    at(4_000);
    const aView = await play(a.token, created.body.id, 5);
    expect(aView.status).toBe("active"); // waiting for b
    expect(aView.me.finished).toBe(true);
    at(60_000);
    const done = await play(b.token, created.body.id, 2);
    expect(done.status).toBe("finished");
    expect(done.me.outcome).toBe("loss");
    expect(done.opponent.outcome).toBe("win");
    expect(done.me.ratingAfter).toBeLessThan(done.me.rating);
    expect(done.review).toHaveLength(5);

    const winner = (await t.get(a.token, `/student/duels/${created.body.id}`)).body;
    expect(winner.me.xp).toBe(30 + 5 * 4);
    const home = (await t.get(a.token, "/student/home")).body;
    expect(home.profile.xp).toBe(50);
    const aLobby = (await t.get(a.token, "/student/duels")).body;
    expect(aLobby.record.wins).toBe(1);
    expect(aLobby.recent[0].ratingChange).toBeGreaterThan(0);
  });

  it("matches two students who both look for a duel", async () => {
    at(100_000);
    const c = await student();
    const d = await student();
    const open = await t.post(c.token, "/student/duels", {});
    expect(open.body.status).toBe("waiting");
    const joined = await t.post(d.token, "/student/duels", {});
    expect(joined.body.id).toBe(open.body.id);
    expect(joined.body.status).toBe("active");
    // Asking again returns the same live duel instead of a second one.
    expect((await t.post(c.token, "/student/duels", {})).body.id).toBe(open.body.id);
  });

  it("finishes on time even if one player stops answering", async () => {
    at(200_000);
    const e = await student();
    const f = await student();
    const duel = (await t.post(e.token, "/student/duels", { opponentId: f.id })).body;
    await t.post(f.token, `/student/duels/${duel.id}/accept`, {});
    at(204_000);
    const q = (await t.get(e.token, `/student/duels/${duel.id}`)).body.question;
    await t.post(e.token, `/student/duels/${duel.id}/answer`, { questionId: q.id, response: rightAnswer(q.id) });
    at(204_000 + 200_000); // past the 3-minute clock
    const late = await t.post(f.token, `/student/duels/${duel.id}/answer`, { questionId: "x", response: { kind: "text", value: "x" } });
    expect(late.status).toBe(409);
    const result = (await t.get(f.token, `/student/duels/${duel.id}`)).body;
    expect(result.status).toBe("finished");
    expect(result.opponent.outcome).toBe("win");
  });

  it("expires unanswered challenges and blocks outsiders", async () => {
    at(500_000);
    const g = await student();
    const h = await student();
    const duel = (await t.post(g.token, "/student/duels", { opponentId: h.id })).body;
    expect((await t.get(tpo, `/student/duels/${duel.id}`)).status).toBe(403);
    const other = await student();
    expect((await t.get(other.token, `/student/duels/${duel.id}`)).status).toBe(404);
    at(500_000 + 3 * 60_000);
    expect((await t.post(h.token, `/student/duels/${duel.id}/accept`, {})).status).toBe(409);
    expect((await t.get(g.token, `/student/duels/${duel.id}`)).body.status).toBe("expired");
  });

  it("pushes invites over the WebSocket", async () => {
    at(700_000);
    const i = await student();
    const j = await student();
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (t.app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${j.token}`);
    const events: { type: string; duelId?: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("message", (m) => {
        events.push(JSON.parse(m.toString()));
        if (events.length === 1) resolve();
      });
      ws.on("error", reject);
    });
    const duel = (await t.post(i.token, "/student/duels", { opponentId: j.id })).body;
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    expect(events[0]!.type).toBe("hello");
    expect(events.some((e) => e.type === "duel_invite" && e.duelId === duel.id)).toBe(true);

    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws?token=nope`);
    const code = await new Promise<number>((r) => bad.on("close", (c) => r(c)));
    expect(code).toBe(4401);
  });
});
