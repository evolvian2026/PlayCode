import type { WebSocket } from "ws";

// In-process pub/sub from the API to signed-in browsers. Each user can have
// several sockets (phone and laptop). With more than one API instance, put
// Redis pub/sub behind publish() so events reach sockets on other instances.

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

const sockets = new Map<string, Set<WebSocket>>();

export function subscribe(userId: string, socket: WebSocket): () => void {
  const set = sockets.get(userId) ?? sockets.set(userId, new Set()).get(userId)!;
  set.add(socket);
  return () => {
    set.delete(socket);
    if (set.size === 0) sockets.delete(userId);
  };
}

export function publish(userId: string, event: RealtimeEvent): void {
  const payload = JSON.stringify(event);
  for (const s of sockets.get(userId) ?? []) {
    if (s.readyState === 1) s.send(payload);
  }
}

export function connectedUsers(): number {
  return sockets.size;
}
