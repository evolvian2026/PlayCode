import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { pool } from "../src/db/client";
import { setup, type TestApp } from "./helpers";

// Two API instances on one database: this process (A) and a real server
// process (B). Live events and rate limits must work across them.
let t: TestApp;
let b: ChildProcess;
const port = 4300 + Math.floor(Math.random() * 500);
const B = `http://127.0.0.1:${port}`;

beforeAll(async () => {
  t = await setup();
  b = spawn("npx", ["tsx", "src/server.ts"], { env: { ...process.env, PORT: String(port) }, stdio: "ignore", detached: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${B}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("instance B did not start");
}, 60_000);

afterAll(async () => {
  // The server was started in its own process group so npx and tsx both stop.
  if (b.pid) process.kill(-b.pid, "SIGTERM");
  await t.app.close();
  await pool.end();
});

describe("several API instances", () => {
  it("delivers a live event raised on A to a browser connected to B", async () => {
    const admin = await t.login("admin@demo.edu");
    const students = (await t.get(admin, "/console/students")).body.students as { id: string; email: string }[];
    const challenger = await t.login("student@demo.edu");
    const opponent = students.find((s) => s.email !== "student@demo.edu")!;
    const opponentToken = await t.login(opponent.email);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${opponentToken}`);
    const events: { type: string; duelId?: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("message", (m) => {
        events.push(JSON.parse(m.toString()));
        if (events.length === 1) resolve();
      });
      ws.on("error", reject);
    });
    const duel = (await t.post(challenger, "/student/duels", { opponentId: opponent.id })).body;
    for (let i = 0; i < 50 && !events.some((e) => e.type === "duel_invite"); i++) await new Promise((r) => setTimeout(r, 50));
    ws.close();
    expect(events.find((e) => e.type === "duel_invite")).toMatchObject({ duelId: duel.id });
  });

  it("shares rate limits between instances", async () => {
    const attempt = async (onB: boolean) => {
      const body = { email: "tpo@demo.edu", password: "wrong-password" };
      if (!onB) return (await t.post("", "/auth/login", body)).status;
      return (await fetch(`${B}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status;
    };
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push(await attempt(i % 2 === 1));
    expect(statuses.every((s) => s === 401)).toBe(true);
    // Ten tries spread over both instances use up the limit on both.
    expect(await attempt(false)).toBe(429);
    expect(await attempt(true)).toBe(429);
  });
});
