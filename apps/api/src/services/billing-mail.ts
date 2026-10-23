import { and, eq, inArray } from "drizzle-orm";
import { formatRupees } from "@playcode/core";
import type { Db } from "../db/client";
import { billingNotices, billingProfiles, invoices, memberships, tenants, users } from "../db/schema";
import { mailer } from "../lib/mailer";
import { renderInvoicePdf } from "./billing";
import { appLink } from "./notifications";
import { onlinePaymentsEnabled } from "./payments";

// Billing emails, sent from the hourly job: each new invoice with its PDF, a
// reminder three days before it is due, a weekly reminder while it is
// overdue (four at most), and licence-renewal reminders 60, 30 and 7 days
// before a licence ends. Each notice is recorded once, so re-running is safe.

const DAY_MS = 86_400_000;
const RENEWAL_DAYS = [7, 30, 60];
const MAX_OVERDUE_REMINDERS = 4;

type Kind = (typeof billingNotices.$inferInsert)["kind"];

/** The customer's accounts email plus its admins (and, for a partner's college, the partner's admins). */
async function recipients(db: Db, tenantId: string): Promise<string[]> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return [];
  const ids = [tenantId, ...(tenant.parentId ? [tenant.parentId] : [])];
  const admins = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inArray(memberships.tenantId, ids), inArray(memberships.role, ["inst_admin", "partner_admin"]), eq(users.status, "active")));
  const [profile] = await db.select({ email: billingProfiles.email }).from(billingProfiles).where(eq(billingProfiles.tenantId, tenantId));
  return [...new Set([profile?.email, ...admins.map((a) => a.email)].filter((e): e is string => Boolean(e)))];
}

/**
 * Claim the notice, send it, and release the claim if sending fails so the
 * next run retries. Returns whether an email went out.
 */
async function sendOnce(db: Db, args: { key: string; tenantId: string; kind: Kind; now: Date; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] }) {
  const m = mailer();
  if (!m) return false;
  const to = await recipients(db, args.tenantId);
  if (to.length === 0) return false;
  const [claimed] = await db.insert(billingNotices).values({ key: args.key, tenantId: args.tenantId, kind: args.kind, recipients: to, sentAt: args.now }).onConflictDoNothing().returning();
  if (!claimed) return false;
  try {
    await m.send({ to: to.join(", "), subject: args.subject, text: args.text, attachments: args.attachments });
    return true;
  } catch (err) {
    await db.delete(billingNotices).where(eq(billingNotices.key, args.key));
    throw err;
  }
}

const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export async function sendBillingNotices(db: Db, now: Date) {
  const summary = { issued: 0, due: 0, overdue: 0, renewal: 0, failed: 0 };
  if (!mailer()) return summary;
  const pay = onlinePaymentsEnabled() ? `Pay online or download the PDF: ${appLink("/console/billing")}` : `Download the PDF and pay by bank transfer: ${appLink("/console/billing")}`;
  const attempt = async (counter: keyof typeof summary, send: () => Promise<boolean>) => {
    try {
      if (await send()) summary[counter]++;
    } catch {
      summary.failed++;
    }
  };

  for (const inv of await db.select().from(invoices).where(eq(invoices.status, "issued"))) {
    const amount = formatRupees(inv.totalPaise);
    await attempt("issued", async () =>
      sendOnce(db, {
        key: `invoice_issued:${inv.id}`,
        tenantId: inv.tenantId,
        kind: "invoice_issued",
        now,
        subject: `PlayCode invoice ${inv.number} for ${inv.period}: ${amount}`,
        text: `Hello,\n\nYour PlayCode tax invoice ${inv.number} for ${inv.period} is attached: ${amount} including GST, due by ${date(inv.dueAt)}.\n\n${pay}\n\nThank you,\nPlayCode`,
        attachments: [{ filename: `${inv.number.replace(/\//g, "-")}.pdf`, content: await renderInvoicePdf(inv), contentType: "application/pdf" }],
      }),
    );
    const untilDue = inv.dueAt.getTime() - now.getTime();
    if (untilDue > 0 && untilDue <= 3 * DAY_MS) {
      await attempt("due", () =>
        sendOnce(db, {
          key: `invoice_due:${inv.id}`,
          tenantId: inv.tenantId,
          kind: "invoice_due",
          now,
          subject: `Reminder: PlayCode invoice ${inv.number} is due on ${date(inv.dueAt)}`,
          text: `Hello,\n\nA reminder that invoice ${inv.number} (${amount}) is due on ${date(inv.dueAt)}.\n\n${pay}\n\nIf you have already paid, thank you, and please ignore this email.\n\nPlayCode`,
        }),
      );
    }
    if (untilDue < 0) {
      // One reminder per week overdue, starting the day after it fell due.
      const week = Math.floor(-untilDue / (7 * DAY_MS));
      if (week < MAX_OVERDUE_REMINDERS) {
        const daysLate = Math.max(1, Math.floor(-untilDue / DAY_MS));
        await attempt("overdue", () =>
          sendOnce(db, {
            key: `invoice_overdue:${inv.id}:${week}`,
            tenantId: inv.tenantId,
            kind: "invoice_overdue",
            now,
            subject: `Overdue: PlayCode invoice ${inv.number} (${daysLate} days)`,
            text: `Hello,\n\nInvoice ${inv.number} for ${amount} was due on ${date(inv.dueAt)} and is now ${daysLate} days overdue.\n\n${pay}\n\nIf you have already paid, please reply with the payment reference so we can match it.\n\nPlayCode`,
          }),
        );
      }
    }
  }

  for (const t of await db.select().from(tenants)) {
    if (!t.validUntil || t.type === "partner") continue;
    const ends = new Date(`${t.validUntil}T23:59:59+05:30`);
    const daysLeft = Math.ceil((ends.getTime() - now.getTime()) / DAY_MS);
    // The nearest threshold crossed; each sends once per licence end date.
    const threshold = RENEWAL_DAYS.find((d) => daysLeft >= 0 && daysLeft <= d);
    if (threshold === undefined) continue;
    await attempt("renewal", () =>
      sendOnce(db, {
        key: `licence_renewal:${t.id}:${t.validUntil}:${threshold}`,
        tenantId: t.id,
        kind: "licence_renewal",
        now,
        subject: `Your PlayCode licence for ${t.name} ends on ${date(ends)}`,
        text: `Hello,\n\nThe PlayCode licence for ${t.name} (${t.seats} seats, ${t.plan} plan) ends on ${date(ends)}, in ${daysLeft} days. After that there are 14 days of grace, then the account becomes read-only (people can still sign in and see their data) until it is renewed.\n\nTo renew, reply to this email or contact your PlayCode account manager${t.parentId ? " or training partner" : ""}.\n\nPlan and usage: ${appLink("/console/billing")}\n\nPlayCode`,
      }),
    );
  }
  return summary;
}
