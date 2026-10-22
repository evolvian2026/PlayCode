import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { env } from "../env";
import type { Db, DbOrTx } from "../db/client";
import { webhookDeliveries, webhooks, type WebhookEvent } from "../db/schema";
import { decrypt, hmacSha256 } from "../lib/crypto";
import { badRequest } from "../lib/errors";

// Webhooks: every event becomes one delivery row per subscribed endpoint, so
// a slow or failing endpoint never blocks the request that caused the event.
// Deliveries retry with exponential backoff (1, 2, 4 ... 32 minutes) and are
// signed: X-PlayCode-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>.

export const MAX_ATTEMPTS = 7;
const TIMEOUT_MS = 10_000;

export function isPrivateAddress(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Block requests to internal networks (SSRF). Checked when saving and again before every delivery. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Enter a valid URL");
  }
  if (env.WEBHOOKS_ALLOW_PRIVATE) return url;
  if (url.protocol !== "https:") throw badRequest("Webhook URLs must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw badRequest("That host cannot be resolved");
  if (addresses.some(isPrivateAddress)) throw badRequest("Webhook URLs cannot point to private networks");
  return url;
}

/** Queue an event for every active webhook of the tenant that subscribes to it. */
export async function emitEvent(db: DbOrTx, tenantId: string, event: WebhookEvent, data: Record<string, unknown>, now = new Date()) {
  const hooks = await db.select().from(webhooks).where(and(eq(webhooks.tenantId, tenantId), eq(webhooks.active, true)));
  const targets = hooks.filter((h) => h.events.includes(event));
  if (targets.length === 0) return 0;
  await db.insert(webhookDeliveries).values(
    targets.map((h) => ({ webhookId: h.id, event, payload: { event, createdAt: now.toISOString(), data }, nextAttemptAt: now })),
  );
  return targets.length;
}

export function signature(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

/** Send due deliveries. Run every minute (pnpm webhooks:deliver) and after emitting events. */
export async function deliverDue(db: Db, now: Date, opts: { limit?: number; fetchImpl?: typeof fetch } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Claim due rows with a 5-minute lease so concurrent runs never send the same delivery twice;
  // if this run crashes, the lease expires and another run retries.
  const lease = new Date(now.getTime() + 5 * 60_000);
  const claimed = await db.execute<{ id: string }>(sql`
    update ${webhookDeliveries} set next_attempt_at = ${lease}
    where id in (
      select id from ${webhookDeliveries}
      where status = 'pending' and next_attempt_at <= ${now}
      order by next_attempt_at
      limit ${opts.limit ?? 100}
      for update skip locked
    )
    returning id`);
  const ids = claimed.rows.map((r) => r.id);
  const due = ids.length
    ? await db
        .select({ d: webhookDeliveries, h: webhooks })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(inArray(webhookDeliveries.id, ids))
        .orderBy(asc(webhookDeliveries.createdAt))
    : [];
  const summary = { delivered: 0, retrying: 0, failed: 0 };
  for (const { d, h } of due) {
    const body = JSON.stringify({ id: d.id, ...d.payload });
    const ts = Math.floor(now.getTime() / 1000);
    let code: number | null = null;
    let error: string | null = null;
    try {
      await assertPublicUrl(h.url);
      const res = await fetchImpl(h.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "PlayCode-Webhooks/1",
          "x-playcode-event": d.event,
          "x-playcode-delivery": d.id,
          "x-playcode-signature": signature(decrypt(h.secretEnc), ts, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      code = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      summary.delivered++;
      await db.update(webhookDeliveries).set({ status: "delivered", attempts, lastStatusCode: code, lastError: null, deliveredAt: now }).where(eq(webhookDeliveries.id, d.id));
    } else if (attempts >= MAX_ATTEMPTS) {
      summary.failed++;
      await db.update(webhookDeliveries).set({ status: "failed", attempts, lastStatusCode: code, lastError: error }).where(eq(webhookDeliveries.id, d.id));
    } else {
      summary.retrying++;
      const next = new Date(now.getTime() + 2 ** (attempts - 1) * 60_000);
      await db.update(webhookDeliveries).set({ attempts, lastStatusCode: code, lastError: error, nextAttemptAt: next }).where(eq(webhookDeliveries.id, d.id));
    }
  }
  return summary;
}

/** Emit, then try to deliver straight away without making the caller wait. */
export function emitAndDeliver(db: Db, tenantId: string, event: WebhookEvent, data: Record<string, unknown>, now = new Date()) {
  void emitEvent(db, tenantId, event, data, now)
    .then((n) => (n > 0 ? deliverDue(db, now) : undefined))
    .catch(() => {});
}

export async function deliveryStats(db: DbOrTx, webhookId: string) {
  const [row] = await db
    .select({
      delivered: sql<number>`sum(case when ${webhookDeliveries.status} = 'delivered' then 1 else 0 end)::int`,
      pending: sql<number>`sum(case when ${webhookDeliveries.status} = 'pending' then 1 else 0 end)::int`,
      failed: sql<number>`sum(case when ${webhookDeliveries.status} = 'failed' then 1 else 0 end)::int`,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId));
  return { delivered: row?.delivered ?? 0, pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}
