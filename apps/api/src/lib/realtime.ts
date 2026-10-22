import { randomUUID } from "node:crypto";
import pg from "pg";
import type { WebSocket } from "ws";
import { pool } from "../db/client";
import { env } from "../env";

// Pub/sub from the API to signed-in browsers. Each user can have several
// sockets (phone and laptop), possibly connected to different API instances.
// An event is delivered to this instance's sockets at once and broadcast
// through Postgres NOTIFY; every other instance LISTENs and delivers it to
// its own sockets. One extra database connection per instance, no Redis.

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

const CHANNEL = "playcode_realtime";
const INSTANCE = randomUUID();
const sockets = new Map<string, Set<WebSocket>>();

let listener: pg.Client | null = null;
let stopped = true;
let retry: NodeJS.Timeout | undefined;

export function subscribe(userId: string, socket: WebSocket): () => void {
  const set = sockets.get(userId) ?? sockets.set(userId, new Set()).get(userId)!;
  set.add(socket);
  return () => {
    set.delete(socket);
    if (set.size === 0) sockets.delete(userId);
  };
}

function deliver(userId: string, payload: string): void {
  for (const s of sockets.get(userId) ?? []) {
    if (s.readyState === 1) s.send(payload);
  }
}

export function publish(userId: string, event: RealtimeEvent): void {
  const payload = JSON.stringify(event);
  deliver(userId, payload);
  // Jobs and scripts publish too (they have no sockets of their own), so sending doesn't depend on listening.
  if (env.REALTIME_FANOUT === "postgres") {
    // NOTIFY payloads are capped at 8000 bytes; events are small, but don't break the publisher if one isn't.
    const message = JSON.stringify({ o: INSTANCE, u: userId, e: payload });
    if (message.length < 7900) void pool.query("select pg_notify($1, $2)", [CHANNEL, message]).catch(() => {});
  }
}

async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const { o, u, e } = JSON.parse(msg.payload) as { o: string; u: string; e: string };
      if (o !== INSTANCE) deliver(u, e);
    } catch {
      // Not ours.
    }
  });
  const reconnect = () => {
    if (listener === client) listener = null;
    void client.end().catch(() => {});
    if (!stopped) retry = setTimeout(() => void listen().catch(reconnect), 1_000);
  };
  client.on("error", reconnect);
  client.on("end", () => {
    if (!stopped && listener === client) reconnect();
  });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  listener = client;
}

/** Start receiving events published by other API instances. */
export async function startFanout(): Promise<void> {
  if (!stopped) return;
  stopped = false;
  await listen();
}

export async function stopFanout(): Promise<void> {
  stopped = true;
  clearTimeout(retry);
  const client = listener;
  listener = null;
  await client?.end().catch(() => {});
}

export function connectedUsers(): number {
  return sockets.size;
}
