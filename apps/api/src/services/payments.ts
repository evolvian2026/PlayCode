import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { invoices } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { badRequest, HttpError, unauthorized } from "../lib/errors";
import { getInvoice } from "./billing";
import { amountDue } from "./credit-notes";

// Online payment of invoices through Razorpay Payment Links. The customer pays
// on Razorpay's page; the invoice is marked paid when Razorpay's signed webhook
// arrives, or straight away when the browser comes back with a signed callback.
// Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.

const API = "https://api.razorpay.com/v1";

function config() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return keyId && keySecret ? { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? null } : null;
}

export const onlinePaymentsEnabled = () => config() !== null;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests replace the HTTP client; pass undefined to restore it. */
export function setPaymentFetch(f: typeof fetch | undefined) {
  fetchImpl = f ?? ((...a) => fetch(...a));
}

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
function sameHex(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The invoice's payment link, created on first use. */
export async function paymentLink(db: Db, args: { invoiceId: string; tenantId: string; actorId: string; now: Date }) {
  const cfg = config();
  if (!cfg) throw badRequest("Online payment is not set up. Pay by bank transfer as shown on the invoice.");
  const inv = await getInvoice(db, args.invoiceId, args.tenantId);
  if (inv.status !== "issued") throw badRequest(inv.status === "paid" ? "This invoice is already paid" : "This invoice is void");
  if (inv.paymentLinkUrl) return { url: inv.paymentLinkUrl };
  const due = await amountDue(db, inv);
  if (due === 0) throw badRequest("Nothing is due on this invoice after its credit notes");
  const res = await fetchImpl(`${API}/payment_links`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: due,
      currency: "INR",
      accept_partial: false,
      reference_id: inv.number,
      description: `PlayCode invoice ${inv.number} (${inv.period})`,
      customer: { name: inv.billTo.legalName, email: inv.billTo.email },
      notify: { email: true, sms: false },
      reminder_enable: true,
      notes: { invoice_id: inv.id },
      callback_url: `${env.PUBLIC_APP_URL}/console/billing/paid`,
      callback_method: "get",
    }),
  });
  if (!res.ok) throw new HttpError(502, "payment_gateway", `Could not start the payment (Razorpay ${res.status}). Try again in a moment.`);
  const link = (await res.json()) as { id: string; short_url: string };
  await db.update(invoices).set({ paymentLinkId: link.id, paymentLinkUrl: link.short_url }).where(eq(invoices.id, inv.id));
  await audit(db, { tenantId: inv.tenantId, actorId: args.actorId, action: "billing.payment_link", target: inv.number });
  return { url: link.short_url };
}

/** Refund (part of) an online payment, for a credit note. Returns Razorpay's refund id and status. */
export async function refundPayment(paymentId: string, amountPaise: number, notes: Record<string, string>) {
  const cfg = config();
  if (!cfg) throw badRequest("Online payment is not set up");
  const res = await fetchImpl(`${API}/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`, "content-type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, speed: "normal", notes }),
  });
  if (!res.ok) throw new HttpError(502, "payment_gateway", `Razorpay refused the refund (${res.status}). Nothing was changed; try again or refund from the Razorpay dashboard.`);
  const body = (await res.json()) as { id: string; status: string };
  return { id: body.id, status: body.status };
}

/** Mark the invoice behind a payment link paid. Safe to repeat: only an issued invoice changes. */
async function markPaid(db: Db, linkId: string, paymentId: string, amountPaise: number | null, now: Date) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.paymentLinkId, linkId));
  if (!inv) return null;
  if (amountPaise !== null && amountPaise !== (await amountDue(db, inv))) {
    await audit(db, { tenantId: inv.tenantId, actorId: null, action: "billing.payment_mismatch", target: inv.number, data: { amountPaise, paymentId } });
    return inv;
  }
  const [updated] = await db
    .update(invoices)
    .set({ status: "paid", paidAt: now, paidVia: "razorpay", paymentRef: paymentId })
    .where(and(eq(invoices.id, inv.id), eq(invoices.status, "issued")))
    .returning();
  if (updated) await audit(db, { tenantId: inv.tenantId, actorId: null, action: "billing.invoice_paid", target: inv.number, data: { via: "razorpay", paymentId } });
  return updated ?? inv;
}

export interface CallbackParams {
  razorpay_payment_id: string;
  razorpay_payment_link_id: string;
  razorpay_payment_link_reference_id: string;
  razorpay_payment_link_status: string;
  razorpay_signature: string;
}

/** The browser came back from Razorpay: check the signature (key secret) and record the payment. */
export async function confirmCallback(db: Db, tenantId: string, p: CallbackParams, now: Date) {
  const cfg = config();
  if (!cfg) throw badRequest("Online payment is not set up");
  const expected = hmac(cfg.keySecret, `${p.razorpay_payment_link_id}|${p.razorpay_payment_link_reference_id}|${p.razorpay_payment_link_status}|${p.razorpay_payment_id}`);
  if (!sameHex(expected, p.razorpay_signature)) throw badRequest("The payment confirmation could not be verified");
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.paymentLinkId, p.razorpay_payment_link_id), eq(invoices.tenantId, tenantId)));
  if (!inv) throw badRequest("No invoice matches this payment");
  if (p.razorpay_payment_link_status !== "paid") return { invoice: inv, paid: false };
  const updated = await markPaid(db, p.razorpay_payment_link_id, p.razorpay_payment_id, null, now);
  return { invoice: updated!, paid: updated!.status === "paid" };
}

/** Razorpay webhook: verify the signature over the raw body, then act on payment_link.paid. */
export async function handleWebhook(db: Db, rawBody: string, signature: string | undefined, now: Date) {
  const secret = config()?.webhookSecret;
  if (!secret) throw new HttpError(503, "not_configured", "Razorpay webhooks are not configured");
  if (!signature || !sameHex(hmac(secret, rawBody), signature)) throw unauthorized("Bad signature");
  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment_link?: { entity?: { id?: string; status?: string; amount_paid?: number } }; payment?: { entity?: { id?: string } } };
  };
  if (event.event !== "payment_link.paid") return { handled: false };
  const link = event.payload?.payment_link?.entity;
  const paymentId = event.payload?.payment?.entity?.id;
  if (!link?.id || !paymentId || link.status !== "paid") return { handled: false };
  const inv = await markPaid(db, link.id, paymentId, link.amount_paid ?? null, now);
  return { handled: inv !== null };
}
