import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { planHas } from "@playcode/core";
import { env } from "../env";
import type { Db, DbOrTx } from "../db/client";
import { notifications, tenants, users, type NotificationTemplate } from "../db/schema";
import { publish } from "../lib/realtime";

// Notification outbox. Every notification shows in the student's in-app
// inbox; students with a phone number and WhatsApp configured also get a
// WhatsApp message. A dedupe key makes each nudge idempotent, so the hourly
// job can re-run safely.

export interface NewNotification {
  tenantId: string;
  userId: string;
  template: NotificationTemplate;
  title: string;
  body: string;
  link?: string;
  dedupeKey: string;
  sentBy?: string;
}

/** Queue notifications; returns how many were new (duplicates are ignored). */
export async function enqueue(db: DbOrTx, items: NewNotification[]): Promise<number> {
  if (items.length === 0) return 0;
  const userIds = [...new Set(items.map((i) => i.userId))];
  const people = await db.select({ id: users.id, phone: users.phone, prefs: users.notifyPrefs }).from(users).where(inArray(users.id, userIds));
  const whatsapp = new Map(people.map((p) => [p.id, Boolean(p.phone) && p.prefs.whatsapp !== false]));
  // WhatsApp delivery is a plan feature; in-app messages always go out.
  const tenantIds = [...new Set(items.map((i) => i.tenantId))];
  const whatsappTenants = new Set((await db.select({ id: tenants.id, plan: tenants.plan }).from(tenants).where(inArray(tenants.id, tenantIds))).filter((t) => planHas(t.plan, "whatsapp")).map((t) => t.id));
  let created = 0;
  // Insert in chunks to stay under parameter limits.
  for (let i = 0; i < items.length; i += 500) {
    const rows = await db
      .insert(notifications)
      .values(
        items.slice(i, i + 500).map((n) => ({
          ...n,
          link: n.link ?? null,
          sentBy: n.sentBy ?? null,
          channel: whatsapp.get(n.userId) && whatsappTenants.has(n.tenantId) && whatsappConfigured() ? ("whatsapp" as const) : ("none" as const),
          status: "pending" as const,
        })),
      )
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ userId: notifications.userId, title: notifications.title });
    created += rows.length;
    for (const r of rows) publish(r.userId, { type: "notification", title: r.title });
  }
  return created;
}

export function whatsappConfigured(): boolean {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);
}

/**
 * Send one WhatsApp template message through the Cloud API. Templates must be
 * approved in WhatsApp Manager under the same names (playcode_<template>),
 * with two body parameters: the title and the message. The sign-in code
 * template (playcode_login_code) is an Authentication template: the code fills
 * its body and its copy-code button.
 */
export async function sendWhatsApp(phone: string, template: string, params: string[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/[^\d]/g, ""),
      type: "template",
      template: {
        name: `playcode_${template}`,
        language: { code: env.WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 900) })) },
          ...(template === "login_code" ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: params[0] }] }] : []),
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Deliver pending notifications. Run every minute (pnpm notify:send) or after enqueueing. */
export async function processOutbox(db: Db, now: Date, limit = 200, fetchImpl: typeof fetch = fetch) {
  const pending = await db
    .select({ n: notifications, phone: users.phone, nudgesOff: sql<boolean>`coalesce((${tenants.settings}->>'nudges')::boolean = false, false)` })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .innerJoin(tenants, eq(tenants.id, notifications.tenantId))
    .where(eq(notifications.status, "pending"))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  const summary = { sent: 0, skipped: 0, failed: 0 };
  for (const { n, phone, nudgesOff } of pending) {
    let status: "sent" | "skipped" | "failed" = "skipped";
    let error: string | null = null;
    // Announcements always go out; automatic nudges respect the institution's setting.
    if (n.channel === "whatsapp" && phone && !(nudgesOff && n.template !== "announcement")) {
      try {
        await sendWhatsApp(phone, n.template, [n.title, n.body], fetchImpl);
        status = "sent";
      } catch (e) {
        status = "failed";
        error = (e as Error).message;
      }
    }
    summary[status]++;
    await db.update(notifications).set({ status, error, sentAt: status === "sent" ? now : null }).where(eq(notifications.id, n.id));
  }
  return summary;
}

export async function inbox(db: Db, userId: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(30);
  return {
    unread: rows.filter((r) => !r.readAt).length,
    items: rows.map((r) => ({ id: r.id, template: r.template, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt, read: Boolean(r.readAt) })),
  };
}

export async function markRead(db: Db, userId: string, now: Date) {
  await db.update(notifications).set({ readAt: now }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { ok: true };
}

export const appLink = (path: string) => `${env.PUBLIC_APP_URL.replace(/\/$/, "")}${path}`;
