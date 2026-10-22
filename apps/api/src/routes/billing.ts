import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { forbidden } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { generateInvoices, getInvoice, getProfile, listInvoices, renderInvoicePdf, saveProfile, setInvoiceStatus, usage } from "../services/billing";

const idParam = z.object({ id: z.string().uuid() });

/** Plan, usage and invoices for institution admins; invoicing for PlayCode admins. */
export async function billingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/console/billing", { preHandler: requirePermission("tenant.settings") }, async (req) => {
    const tenantId = tenantOf(req);
    return {
      usage: await usage(db, tenantId, app.now()),
      profile: await getProfile(db, tenantId),
      invoices: (await listInvoices(db, { tenantId })).map((r) => r.invoice),
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
      return { invoices: (await listInvoices(db, q)).map((r) => ({ ...r.invoice, tenantName: r.tenant })) };
    });

    a.post("/admin/billing/run", async (req) => {
      const { period } = parse(z.object({ period: z.string() }), req.body);
      return { issued: (await generateInvoices(db, period, app.now(), req.auth.userId)).length };
    });

    a.post("/admin/billing/invoices/:id/status", async (req) => {
      const { status } = parse(z.object({ status: z.enum(["paid", "void"]) }), req.body);
      return { invoice: await setInvoiceStatus(db, parse(idParam, req.params).id, status, req.auth.userId, app.now()) };
    });

    a.get("/admin/billing/invoices/:id/pdf", async (req, reply) => {
      const inv = await getInvoice(db, parse(idParam, req.params).id);
      return reply.header("content-type", "application/pdf").send(await renderInvoicePdf(inv));
    });
  });
}
