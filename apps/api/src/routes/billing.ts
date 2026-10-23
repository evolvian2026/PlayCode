import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { forbidden } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { creditNotesFor, getCreditNote, issueCreditNote, renderCreditNotePdf } from "../services/credit-notes";
import { sendCreditNote } from "../services/billing-mail";
import { confirmCallback, handleWebhook, onlinePaymentsEnabled, paymentLink } from "../services/payments";
import { generateInvoices, getInvoice, getProfile, listInvoices, renderInvoicePdf, saveProfile, setInvoiceStatus, usage } from "../services/billing";

const idParam = z.object({ id: z.string().uuid() });

/** Plan, usage and invoices for institution admins; invoicing for PlayCode admins. */
export async function billingRoutes(app: FastifyInstance) {
  // Razorpay webhook: no user session; the signature covers the raw body, so keep it unparsed.
  app.register(async (hook) => {
    hook.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    hook.post("/webhooks/razorpay", async (req) => {
      const signature = req.headers["x-razorpay-signature"];
      return handleWebhook(db, String(req.body ?? ""), typeof signature === "string" ? signature : undefined, app.now());
    });
  });

  app.register(async (app2) => {
    app2.addHook("preHandler", authenticate);
    await signedInRoutes(app2);
  });
}

async function signedInRoutes(app: FastifyInstance) {
  app.get("/console/billing", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenantId = tenantOf(req);
    return {
      usage: await usage(db, tenantId, app.now()),
      onlinePayments: onlinePaymentsEnabled(),
      profile: await getProfile(db, tenantId),
      invoices: await withCredits((await listInvoices(db, { tenantId })).map((r) => r.invoice)),
    };
  });

  app.put("/console/billing/profile", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const body = parse(
      z.object({
        legalName: z.string().min(2).max(200),
        gstin: z.string().max(15).nullable(),
        address: z.string().min(5).max(500),
        stateCode: z.string().max(2).nullable(),
        email: z.string().email(),
      }),
      req.body,
    );
    return { profile: await saveProfile(db, tenantOf(req), req.auth.userId, body) };
  });

  app.post("/console/billing/invoices/:id/pay", { preHandler: requirePermission("tenant.settings") }, async (req) =>
    paymentLink(db, { invoiceId: parse(idParam, req.params).id, tenantId: tenantOf(req), actorId: req.auth.userId, now: app.now() }),
  );

  app.post("/console/billing/payments/confirm", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const body = parse(
      z.object({
        razorpay_payment_id: z.string().max(100),
        razorpay_payment_link_id: z.string().max(100),
        razorpay_payment_link_reference_id: z.string().max(100),
        razorpay_payment_link_status: z.string().max(40),
        razorpay_signature: z.string().max(200),
      }),
      req.body,
    );
    return confirmCallback(db, tenantOf(req), body, app.now());
  });

  app.get("/console/billing/credit-notes/:id/pdf", { preHandler: requirePermission("tenant.settings") }, async (req, reply) => {
    const cn = await getCreditNote(db, parse(idParam, req.params).id, tenantOf(req));
    return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${cn.number.replace(/\//g, "-")}.pdf"`).send(await renderCreditNotePdf(db, cn));
  });

  app.get("/console/billing/invoices/:id/pdf", { preHandler: requirePermission("tenant.settings") }, async (req, reply) => {
    const inv = await getInvoice(db, parse(idParam, req.params).id, tenantOf(req));
    return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${inv.number.replace(/\//g, "-")}.pdf"`).send(await renderInvoicePdf(inv));
  });

  // ---------- PlayCode admins ----------
  app.register(async (a) => {
    a.addHook("preHandler", async (req) => {
      if (!req.auth.roles.includes("super_admin")) throw forbidden("Only PlayCode admins manage billing");
    });

    a.get("/admin/billing/invoices", async (req) => {
      const q = parse(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
      return { invoices: await withCredits((await listInvoices(db, q)).map((r) => ({ ...r.invoice, tenantName: r.tenant }))) };
    });

    a.post("/admin/billing/run", async (req) => {
      const { period } = parse(z.object({ period: z.string() }), req.body);
      return { issued: (await generateInvoices(db, period, app.now(), req.auth.userId)).length };
    });

    a.post("/admin/billing/invoices/:id/status", async (req) => {
      const { status } = parse(z.object({ status: z.enum(["paid", "void"]) }), req.body);
      return { invoice: await setInvoiceStatus(db, parse(idParam, req.params).id, status, req.auth.userId, app.now()) };
    });

    a.post("/admin/billing/invoices/:id/credit-notes", async (req) => {
      const body = parse(z.object({ subtotalPaise: z.number().int().min(100), reason: z.string().trim().min(5).max(500), refund: z.boolean().default(false) }), req.body);
      const cn = await issueCreditNote(db, { invoiceId: parse(idParam, req.params).id, ...body, actorId: req.auth.userId, now: app.now() });
      const inv = await getInvoice(db, cn.invoiceId);
      void sendCreditNote(db, cn, inv.number, app.now()).catch((err) => req.log.error(err));
      return { creditNote: cn };
    });

    a.get("/admin/billing/credit-notes/:id/pdf", async (req, reply) => {
      const cn = await getCreditNote(db, parse(idParam, req.params).id);
      return reply.header("content-type", "application/pdf").send(await renderCreditNotePdf(db, cn));
    });

    a.get("/admin/billing/invoices/:id/pdf", async (req, reply) => {
      const inv = await getInvoice(db, parse(idParam, req.params).id);
      return reply.header("content-type", "application/pdf").send(await renderInvoicePdf(inv));
    });
  });
}

/** Each invoice with its credit notes and what is still due. */
async function withCredits<T extends { id: string; totalPaise: number; status: string }>(list: T[]) {
  const notes = await creditNotesFor(db, list.map((i) => i.id));
  return list.map((i) => {
    const mine = notes.filter((n) => n.invoiceId === i.id);
    const credited = mine.reduce((a, n) => a + n.totalPaise, 0);
    return {
      ...i,
      creditNotes: mine.map((n) => ({ id: n.id, number: n.number, totalPaise: n.totalPaise, reason: n.reason, refundId: n.refundId, issuedAt: n.issuedAt })),
      amountDuePaise: i.status === "issued" ? Math.max(0, i.totalPaise - credited) : 0,
    };
  });
}
