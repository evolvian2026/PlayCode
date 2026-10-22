import PDFDocument from "pdfkit";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { FEATURES, FEATURE_LABELS, formatRupees, gstSplit, PLAN_SPECS, planHas } from "@playcode/core";
import type { Db } from "../db/client";
import { aiUsage, billingProfiles, invoices, memberships, tenants, type InvoiceLine } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { aiTokensThisMonth } from "./plan";

// Plans, usage and GST invoices. Top-level customers (institutions, partners,
// companies) are invoiced monthly for their licensed seats, plus AI use beyond
// the plan's allowance where the plan bills overage. A partner's colleges
// share the partner's seats and are covered by the partner's invoice.

const SAC = "998431"; // Online software and information services
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

type InvoiceRow = typeof invoices.$inferSelect;

/** What the institution admin sees on the billing page. */
export async function usage(db: Db, tenantId: string, now: Date) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw notFound("Institution");
  const spec = PLAN_SPECS[tenant.plan];
  const [{ used } = { used: 0 }] = await db
    .select({ used: sql<number>`count(distinct ${memberships.userId})::int` })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "student")));
  return {
    plan: tenant.plan,
    planName: spec.name,
    seatPricePaise: spec.seatPricePaise,
    billedByPartner: Boolean(tenant.parentId),
    seats: { licensed: tenant.seats, used },
    validUntil: tenant.validUntil,
    ai: { tokensThisMonth: await aiTokensThisMonth(db, tenantId, now), allowance: spec.aiTokensPerMonth, overagePerMillionPaise: spec.aiOveragePerMillionPaise },
    features: FEATURES.map((f) => ({ id: f, label: FEATURE_LABELS[f], included: planHas(tenant.plan, f) })),
  };
}

export async function getProfile(db: Db, tenantId: string) {
  const [p] = await db.select().from(billingProfiles).where(eq(billingProfiles.tenantId, tenantId));
  return p ?? null;
}

export async function saveProfile(db: Db, tenantId: string, actorId: string, input: { legalName: string; gstin: string | null; address: string; stateCode: string | null; email: string }) {
  const gstin = input.gstin?.trim().toUpperCase() || null;
  if (gstin && !GSTIN_RE.test(gstin)) throw badRequest("That GSTIN is not valid (15 characters, e.g. 29ABCDE1234F1Z5)");
  // A GSTIN starts with the state code, so it wins over what was typed.
  const stateCode = gstin ? gstin.slice(0, 2) : input.stateCode?.trim() || null;
  if (stateCode && !/^\d{2}$/.test(stateCode)) throw badRequest("The state code is two digits, e.g. 29 for Karnataka");
  const values = { legalName: input.legalName.trim(), gstin, address: input.address.trim(), stateCode, email: input.email.trim().toLowerCase(), updatedAt: new Date() };
  await db.insert(billingProfiles).values({ tenantId, ...values }).onConflictDoUpdate({ target: billingProfiles.tenantId, set: values });
  await audit(db, { tenantId, actorId, action: "billing.profile", data: { gstin, stateCode } });
  return getProfile(db, tenantId);
}

/** "2026-10" -> its first instant and the first instant of the next month (UTC). */
function periodRange(period: string) {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y!, m! - 1, 1)), end: new Date(Date.UTC(y!, m!, 1)) };
}

/** Indian financial year (April to March) of a date: "2026-27". */
export function financialYear(d: Date): string {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/**
 * Issue invoices for a month to every top-level customer that has none yet
 * for it. Safe to re-run: an existing invoice for the period is left alone.
 */
export async function generateInvoices(db: Db, period: string, now: Date, actorId: string | null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest("Period must look like 2026-10");
  const { start, end } = periodRange(period);
  if (end > now) throw badRequest("That month hasn't ended yet");
  const customers = await db.select().from(tenants).where(isNull(tenants.parentId));
  const issued: InvoiceRow[] = [];
  for (const t of customers) {
    const spec = PLAN_SPECS[t.plan];
    const children = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.parentId, t.id))).map((c) => c.id);
    const [{ tokens } = { tokens: 0 }] = await db
      .select({ tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::bigint` })
      .from(aiUsage)
      .where(and(inArray(aiUsage.tenantId, [t.id, ...children]), gte(aiUsage.createdAt, start), lt(aiUsage.createdAt, end)));
    const monthName = start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    const lines: InvoiceLine[] = [
      { description: `PlayCode ${spec.name} plan, ${monthName}: ${t.seats} learner seats`, sac: SAC, quantity: t.seats, unitPricePaise: spec.seatPricePaise, amountPaise: t.seats * spec.seatPricePaise },
    ];
    const over = Number(tokens) - spec.aiTokensPerMonth;
    if (over > 0 && spec.aiOveragePerMillionPaise > 0) {
      const millions = Math.ceil((over / 1_000_000) * 100) / 100;
      lines.push({ description: `AI use beyond the ${spec.aiTokensPerMonth / 1_000_000}M tokens included (million tokens)`, sac: SAC, quantity: millions, unitPricePaise: spec.aiOveragePerMillionPaise, amountPaise: Math.round(millions * spec.aiOveragePerMillionPaise) });
    }
    const subtotal = lines.reduce((a, l) => a + l.amountPaise, 0);
    const profile = await getProfile(db, t.id);
    const billTo = profile
      ? { legalName: profile.legalName, gstin: profile.gstin, address: profile.address, stateCode: profile.stateCode, email: profile.email }
      : { legalName: t.name, gstin: null, address: "", stateCode: null, email: "" };
    const tax = gstSplit(subtotal, env.BILLING_STATE_CODE, billTo.stateCode);

    const row = await db.transaction(async (tx) => {
      // One numbering sequence per financial year, allocated under a lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('playcode-invoice-number'))`);
      const [exists] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.tenantId, t.id), eq(invoices.period, period)));
      if (exists) return null;
      const fy = financialYear(now);
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(invoices).where(sql`${invoices.number} like ${`PC/${fy}/%`}`);
      const [created] = await tx
        .insert(invoices)
        .values({
          tenantId: t.id,
          number: `PC/${fy}/${String(n + 1).padStart(4, "0")}`,
          period,
          plan: t.plan,
          lines,
          subtotalPaise: subtotal,
          cgstPaise: tax.cgst,
          sgstPaise: tax.sgst,
          igstPaise: tax.igst,
          totalPaise: subtotal + tax.cgst + tax.sgst + tax.igst,
          billTo,
          issuedAt: now,
          dueAt: new Date(now.getTime() + 15 * 86_400_000),
        })
        .returning();
      return created!;
    });
    if (row) issued.push(row);
  }
  await audit(db, { tenantId: null, actorId, action: "billing.run", data: { period, issued: issued.length } });
  return issued;
}

export async function listInvoices(db: Db, filter: { tenantId?: string; period?: string }) {
  return db
    .select({ invoice: invoices, tenant: tenants.name })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(and(filter.tenantId ? eq(invoices.tenantId, filter.tenantId) : undefined, filter.period ? eq(invoices.period, filter.period) : undefined))
    .orderBy(desc(invoices.issuedAt), desc(invoices.number));
}

export async function getInvoice(db: Db, id: string, tenantId?: string) {
  const [row] = await db.select().from(invoices).where(and(eq(invoices.id, id), tenantId ? eq(invoices.tenantId, tenantId) : undefined));
  if (!row) throw notFound("Invoice");
  return row;
}

export async function setInvoiceStatus(db: Db, id: string, status: "paid" | "void", actorId: string, now: Date) {
  const inv = await getInvoice(db, id);
  if (inv.status === "void") throw badRequest("A void invoice can't be changed; issue a new one");
  await db.update(invoices).set({ status, paidAt: status === "paid" ? now : null }).where(eq(invoices.id, id));
  await audit(db, { tenantId: inv.tenantId, actorId, action: `billing.invoice_${status}`, target: inv.number });
  return getInvoice(db, id);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}

/** Rupees in words, Indian system (lakh, crore), as printed on Indian invoices. */
export function rupeesInWords(paise: number): string {
  let n = Math.floor(paise / 100);
  const p = paise % 100;
  if (n === 0 && p === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  const rupees = parts.length ? `${parts.join(" ")} Rupees` : "";
  const paiseWords = p ? `${below1000(p)} Paise` : "";
  return `${[rupees, paiseWords].filter(Boolean).join(" and ")} Only`;
}

/** The tax invoice as a PDF. */
export function renderInvoicePdf(inv: InvoiceRow, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: opts.compress ?? true, info: { Title: `Tax invoice ${inv.number}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#1d1b2f";
  const muted = "#6b6880";
  const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

  doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text("Tax invoice", 48, 48);
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(inv.status === "void" ? "VOID" : inv.status === "paid" ? "PAID" : "", 400, 54, { width: 147, align: "right" });

  const top = 90;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text(env.BILLING_LEGAL_NAME, 48, top, { width: 240 });
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`${env.BILLING_ADDRESS}\nGSTIN ${env.BILLING_GSTIN}\nState code ${env.BILLING_STATE_CODE}`, { width: 240 });
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Invoice no.  ${inv.number}\nDate  ${date(inv.issuedAt)}\nDue  ${date(inv.dueAt)}\nPeriod  ${inv.period}`, 340, top, { width: 207, align: "right" });

  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text("Bill to", 48, top + 80);
  doc.font("Helvetica").fontSize(9).fillColor(ink).text(inv.billTo.legalName, { width: 300 });
  doc.fillColor(muted).text(
    [inv.billTo.address, inv.billTo.gstin ? `GSTIN ${inv.billTo.gstin}` : "Unregistered (no GSTIN)", inv.billTo.stateCode ? `State code ${inv.billTo.stateCode}` : ""].filter(Boolean).join("\n"),
    { width: 300 },
  );

  // Lines
  let y = Math.max(doc.y, top + 150) + 16;
  const cols = [
    { label: "Description", x: 48, w: 250, align: "left" as const },
    { label: "SAC", x: 300, w: 50, align: "left" as const },
    { label: "Qty", x: 350, w: 50, align: "right" as const },
    { label: "Rate", x: 400, w: 70, align: "right" as const },
    { label: "Amount", x: 470, w: 77, align: "right" as const },
  ];
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(muted);
  for (const c of cols) doc.text(c.label, c.x, y, { width: c.w, align: c.align });
  y += 16;
  doc.moveTo(48, y - 4).lineTo(547, y - 4).lineWidth(0.6).strokeColor("#d8d5e6").stroke();
  doc.font("Helvetica").fontSize(9).fillColor(ink);
  for (const l of inv.lines) {
    const cells = [l.description, l.sac, String(l.quantity), formatRupees(l.unitPricePaise).replace("₹", "Rs "), formatRupees(l.amountPaise).replace("₹", "Rs ")];
    const h = doc.heightOfString(l.description, { width: cols[0]!.w });
    cols.forEach((c, i) => doc.text(cells[i]!, c.x, y, { width: c.w, align: c.align }));
    y += Math.max(14, h) + 8;
  }
  doc.moveTo(48, y).lineTo(547, y).lineWidth(0.6).strokeColor("#d8d5e6").stroke();
  y += 8;

  const totals: [string, number][] = [["Taxable value", inv.subtotalPaise]];
  if (inv.cgstPaise || inv.sgstPaise) totals.push(["CGST 9%", inv.cgstPaise], ["SGST 9%", inv.sgstPaise]);
  if (inv.igstPaise) totals.push(["IGST 18%", inv.igstPaise]);
  totals.push(["Total", inv.totalPaise]);
  for (const [label, amount] of totals) {
    const bold = label === "Total";
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor(ink);
    doc.text(label, 340, y, { width: 120, align: "right" });
    doc.text(formatRupees(amount).replace("₹", "Rs "), 470, y, { width: 77, align: "right" });
    y += bold ? 18 : 14;
  }
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Amount in words: ${rupeesInWords(inv.totalPaise)}`, 48, y + 10, { width: 499 });
  doc.text("Payment within 15 days by bank transfer, quoting the invoice number. This is a computer-generated invoice and needs no signature.", 48, doc.y + 16, { width: 499 });
  doc.end();
  return done;
}
