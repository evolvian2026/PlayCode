import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, tenantOf } from "../lib/http";
import { mailer } from "../lib/mailer";
import { getSubscription, renderReportPdf, reportData, saveSubscription, unitOptions } from "../services/reports";
import { assertFeature } from "../services/plan";

const anyAnalytics = requireAny("analytics.institution", "analytics.department", "analytics.own_units");

/** The weekly PDF report: download it now, or have it emailed every week. */
export async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", anyAnalytics);

  app.get("/console/reports/weekly.pdf", async (req, reply) => {
    tenantOf(req);
    const { unitId } = parse(z.object({ unitId: z.string().uuid().optional() }), req.query);
    const data = await reportData(db, { auth: req.auth, unitId, now: app.now() });
    const pdf = await renderReportPdf(data);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="weekly-report-${data.to}.pdf"`)
      .send(pdf);
  });

  app.get("/console/reports/subscription", async (req) => ({
    subscription: await getSubscription(db, tenantOf(req), req.auth.userId),
    units: await unitOptions(db, req.auth),
    emailConfigured: Boolean(mailer()),
  }));

  app.put("/console/reports/subscription", async (req) => {
    tenantOf(req);
    const body = parse(
      z.object({ enabled: z.boolean(), unitId: z.string().uuid().nullable(), weekday: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23) }),
      req.body,
    );
    if (body.enabled) await assertFeature(db, tenantOf(req), "reports_email");
    return { subscription: await saveSubscription(db, req.auth, body) };
  });
}
