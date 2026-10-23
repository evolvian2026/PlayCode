import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import type { Db, DbOrTx } from "../db/client";
import { pushSubscriptions } from "../db/schema";
import { badRequest } from "../lib/errors";

// Web push: the same reminders that go to the in-app inbox, shown as phone or
// desktop notifications by the installed web app. Free to send, unlike
// WhatsApp. Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT
// (generate keys with `npx web-push generate-vapid-keys`).

/** Push services of the major browsers. Subscriptions elsewhere are refused, so the API only ever posts to these. */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];

function config() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  return publicKey && privateKey ? { publicKey, privateKey, subject: process.env.VAPID_SUBJECT ?? "mailto:support@playcode.dev" } : null;
}

export const pushConfigured = () => config() !== null;
export const vapidPublicKey = () => config()?.publicKey ?? null;

export interface PushPayload {
  title: string;
  body: string;
  link: string | null;
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;

const realSender: Sender = async (sub, payload) => {
  const cfg = config()!;
  await webpush.sendNotification(sub, payload, { TTL: 24 * 3600, vapidDetails: cfg, timeout: 10_000 });
};
let sender: Sender = realSender;
/** Tests swap in a fake push service; pass undefined to restore the real one. */
export function setPushSender(s: Sender | undefined) {
  sender = s ?? realSender;
}

export function assertPushEndpoint(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Not a push subscription");
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw badRequest("Push notifications from this browser are not supported");
}

export async function subscribe(db: Db, args: { userId: string; tenantId: string | null; endpoint: string; p256dh: string; auth: string; userAgent: string | null }) {
  assertPushEndpoint(args.endpoint);
  // An endpoint belongs to one browser; if someone else signs in on it, it moves to them.
  await db
    .insert(pushSubscriptions)
    .values(args)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: args.userId, tenantId: args.tenantId, p256dh: args.p256dh, auth: args.auth, userAgent: args.userAgent } });
}

export async function unsubscribe(db: Db, userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function subscriptionCount(db: DbOrTx, userId: string): Promise<number> {
  return (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).length;
}

/**
 * Push one notification to every device of each user. Subscriptions the push
 * service reports as gone (404/410) are removed. Returns users reached.
 */
export async function pushTo(db: Db, userIds: string[], payloadFor: (userId: string) => PushPayload, now: Date): Promise<Set<string>> {
  const reached = new Set<string>();
  if (!pushConfigured() || userIds.length === 0) return reached;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  for (const s of subs) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payloadFor(s.userId)));
      reached.add(s.userId);
      await db.update(pushSubscriptions).set({ lastPushedAt: now }).where(eq(pushSubscriptions.id, s.id));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    }
  }
  return reached;
}
