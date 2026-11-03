import PDFDocument from "pdfkit";
import { eq, inArray, sql } from "drizzle-orm";
import { formatRupees, gstSplit } from "@playcode/core";
import type { Db, DbOrTx } from "../db/client";
import { creditNotes, invoices } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { badRequest, HttpError } from "../lib/errors";
import { financialYear, getInvoice, rupeesInWords } from "./billing";
import { refundPayment } from "./payments";

// GST credit notes: the way to correct an invoice once it is issued (wrong
// seat count, a goodwill discount, a cancelled month). A credit note carries
// the same kind of tax as its invoice, its own number series, and, for an
// invoice paid online, can refund the money through Razorpay.

type CreditNote = typeof creditNotes.$inferSelect;

/** Credited so far, per invoice. */
export async function creditedByInvoice(db: DbOrTx, invoiceIds: string[]): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await db
    .select({ invoiceId: creditNotes.invoiceId, total: sql<number>`sum(${creditNotes.totalPaise})::int` })
    .from(creditNotes)
    .where(inArray(creditNotes.invoiceId, invoiceIds))
    .groupBy(creditNotes.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, Number(r.total)]));
}

/** What is still owed on an invoice after its credit notes. */
export async function amountDue(db: DbOrTx, inv: typeof invoices.$inferSelect): Promise<number> {
  return Math.max(0, inv.totalPaise - ((await creditedByInvoice(db, [inv.id])).get(inv.id) ?? 0));
}

export async function issueCreditNote(db: Db, args: { invoiceId: string; subtotalPaise: number; reason: string; refund: boolean; actorId: string; now: Date }) {
  const inv = await getInvoice(db, args.invoiceId);
  if (inv.status === "void") throw badRequest("A void invoice can't be credited");
  const existing = await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv.id));
  const creditedSubtotal = existing.reduce((a, c) => a + c.subtotalPaise, 0);
  if (args.subtotalPaise > inv.subtotalPaise - creditedSubtotal) {
    throw badRequest(`At most ${formatRupees(inv.subtotalPaise - creditedSubtotal)} (before GST) is left to credit on this invoice`);
  }
  // Same kind of tax as the invoice: CGST + SGST, or IGST.
  const tax = gstSplit(args.subtotalPaise, "same", inv.igstPaise > 0 ? null : "same");
  const total = args.subtotalPaise + tax.cgst + tax.sgst + tax.igst;

  let refund: { id: string; status: string } | null = null;
  if (args.refund) {
    if (inv.status !== "paid" || inv.paidVia !== "razorpay" || !inv.paymentRef) throw badRequest("Only invoices paid online can be refunded here; refund bank transfers by bank");
    refund = await refundPayment(inv.paymentRef, total, { invoice: inv.number, reason: args.reason.slice(0, 200) });
  }

  const note = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('playcode-credit-note-number'))`);
    const fy = financialYear(args.now);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(creditNotes).where(sql`${creditNotes.number} like ${`PC/CN/${fy}/%`}`);
    const [row] = await tx
      .insert(creditNotes)
      .values({
        tenantId: inv.tenantId,
        invoiceId: inv.id,
        number: `PC/CN/${fy}/${String(n + 1).padStart(4, "0")}`,
        reason: args.reason,
        subtotalPaise: args.subtotalPaise,
        cgstPaise: tax.cgst,
        sgstPaise: tax.sgst,
        igstPaise: tax.igst,
        totalPaise: total,
        refundId: refund?.id ?? null,
        refundStatus: refund?.status ?? null,
        issuedAt: args.now,
        createdBy: args.actorId,
      })
      .returning();
    return row!;
  });
  await audit(db, { tenantId: inv.tenantId, actorId: args.actorId, action: "billing.credit_note", target: note.number, data: { invoice: inv.number, totalPaise: total, refund: refund?.id ?? null } });
  return note;
}

export async function creditNotesFor(db: DbOrTx, invoiceIds: string[]): Promise<CreditNote[]> {
  if (invoiceIds.length === 0) return [];
  return db.select().from(creditNotes).where(inArray(creditNotes.invoiceId, invoiceIds));
}

export async function getCreditNote(db: DbOrTx, id: string, tenantId?: string) {
  const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
  if (!row || (tenantId && row.tenantId !== tenantId)) throw new HttpError(404, "not_found", "Credit note not found");
  return row;
}

export async function renderCreditNotePdf(db: Db, cn: CreditNote, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const inv = await getInvoice(db, cn.invoiceId);
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: opts.compress ?? true, info: { Title: `Credit note ${cn.number}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ink = "#1d1b2f";
  const muted = "#6b6880";
  const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const rs = (p: number) => formatRupees(p).replace("₹", "Rs ");

  doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text("Credit note", 48, 48);
  const top = 90;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text(env.BILLING_LEGAL_NAME, 48, top, { width: 240 });
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`${env.BILLING_ADDRESS}\nGSTIN ${env.BILLING_GSTIN}\nState code ${env.BILLING_STATE_CODE}`, { width: 240 });
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Credit note no.  ${cn.number}\nDate  ${date(cn.issuedAt)}\nAgainst invoice  ${inv.number}\nInvoice date  ${date(inv.issuedAt)}`, 320, top, { width: 227, align: "right" });

  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text("Issued to", 48, top + 80);
  doc.font("Helvetica").fontSize(9).fillColor(ink).text(inv.billTo.legalName, { width: 300 });
  doc.fillColor(muted).text([inv.billTo.address, inv.billTo.gstin ? `GSTIN ${inv.billTo.gstin}` : "Unregistered (no GSTIN)", inv.billTo.stateCode ? `State code ${inv.billTo.stateCode}` : ""].filter(Boolean).join("\n"), { width: 300 });

  let y = Math.max(doc.y, top + 150) + 16;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(ink).text("Reason", 48, y);
  doc.font("Helvetica").fontSize(9).fillColor(ink).text(cn.reason, 48, doc.y + 2, { width: 499 });
  y = doc.y + 16;
  const totals: [string, number][] = [["Taxable value reduced", cn.subtotalPaise]];
  if (cn.cgstPaise || cn.sgstPaise) totals.push(["CGST 9%", cn.cgstPaise], ["SGST 9%", cn.sgstPaise]);
  if (cn.igstPaise) totals.push(["IGST 18%", cn.igstPaise]);
  totals.push(["Total credit", cn.totalPaise]);
  for (const [label, amount] of totals) {
    const bold = label === "Total credit";
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor(ink);
    doc.text(label, 300, y, { width: 160, align: "right" });
    doc.text(rs(amount), 470, y, { width: 77, align: "right" });
    y += bold ? 18 : 14;
  }
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Amount in words: ${rupeesInWords(cn.totalPaise)}`, 48, y + 10, { width: 499 });
  doc.text(
    cn.refundId ? `Refunded to the original payment (Razorpay refund ${cn.refundId}).` : inv.status === "paid" ? "To be refunded or adjusted against the next invoice." : "Reduces the amount payable on the invoice above.",
    48,
    doc.y + 8,
    { width: 499 },
  );
  doc.text("This is a computer-generated credit note and needs no signature.", 48, doc.y + 8, { width: 499 });
  doc.end();
  return done;
}
