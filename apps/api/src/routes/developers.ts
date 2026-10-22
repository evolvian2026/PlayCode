import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { API_SCOPES, apiClients, WEBHOOK_EVENTS, webhookDeliveries, webhooks } from "../db/schema";
import { audit } from "../lib/audit";
import { encrypt, randomToken, sha256 } from "../lib/crypto";
import { notFound } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { assertPublicUrl, deliverDue, deliveryStats } from "../services/webhooks";

/** Console: API clients and webhooks for an institution's integrations. */
export async function developerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("api.manage"));
  const idParam = z.object({ id: z.string().uuid() });

  app.get("/api-clients", async (req) => {
    const rows = await db.select().from(apiClients).where(eq(apiClients.tenantId, tenantOf(req))).orderBy(desc(apiClients.createdAt));
    return { clients: rows.map(({ secretHash: _s, ...c }) => c), scopes: API_SCOPES };
  });

  app.post("/api-clients", async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(API_SCOPES)).min(1) }), req.body);
    const clientId = `pc_${randomToken(12)}`;
    const secret = `pcs_${randomToken(32)}`;
    const [created] = await db
      .insert(apiClients)
      .values({ tenantId, name: body.name, clientId, secretHash: sha256(secret), scopes: body.scopes, createdBy: req.auth.userId })
      .returning();
    await audit(db, { tenantId, actorId: req.auth.userId, action: "api_client.create", target: created!.id, data: { name: body.name, scopes: body.scopes } });
    // The secret is shown once and never stored in plain text.
    return { client: { id: created!.id, name: created!.name, clientId, scopes: created!.scopes }, clientSecret: secret };
  });

  app.post("/api-clients/:id/revoke", async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.update(apiClients).set({ revokedAt: app.now() }).where(and(eq(apiClients.id, id), eq(apiClients.tenantId, tenantId))).returning({ id: apiClients.id });
    if (!row) throw notFound("API client");
    await audit(db, { tenantId, actorId: req.auth.userId, action: "api_client.revoke", target: id });
    return { ok: true };
  });

  app.get("/webhooks", async (req) => {
    const rows = await db.select().from(webhooks).where(eq(webhooks.tenantId, tenantOf(req))).orderBy(desc(webhooks.createdAt));
    return {
      webhooks: await Promise.all(rows.map(async ({ secretEnc: _s, ...h }) => ({ ...h, stats: await deliveryStats(db, h.id) }))),
      events: WEBHOOK_EVENTS,
    };
  });

  app.post("/webhooks", async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ url: z.string().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }), req.body);
    const url = await assertPublicUrl(body.url);
    const secret = `whsec_${randomToken(32)}`;
    const [created] = await db.insert(webhooks).values({ tenantId, url: url.toString(), secretEnc: encrypt(secret), events: body.events, createdBy: req.auth.userId }).returning();
    await audit(db, { tenantId, actorId: req.auth.userId, action: "webhook.create", target: created!.id, data: { url: created!.url, events: body.events } });
    return { webhook: { id: created!.id, url: created!.url, events: created!.events, active: true }, signingSecret: secret };
  });

  app.put("/webhooks/:id", async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ active: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional() }), req.body);
    const [row] = await db.update(webhooks).set(body).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId))).returning({ id: webhooks.id });
    if (!row) throw notFound("Webhook");
    return { ok: true };
  });

  app.delete("/webhooks/:id", async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId))).returning({ id: webhooks.id });
    if (!row) throw notFound("Webhook");
    await audit(db, { tenantId, actorId: req.auth.userId, action: "webhook.delete", target: id });
    return { ok: true };
  });

  app.get("/webhooks/:id/deliveries", async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(idParam, req.params);
    const [hook] = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
    if (!hook) throw notFound("Webhook");
    const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(50);
    return { deliveries: rows };
  });

  /** Send a test event to check the endpoint and the signature check on the receiving side. */
  app.post("/webhooks/:id/test", async (req) => {
    const tenantId = tenantOf(req);
    const { id } = parse(idParam, req.params);
    const [hook] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
    if (!hook) throw notFound("Webhook");
    const now = app.now();
    await db.insert(webhookDeliveries).values({ webhookId: hook.id, event: "webhook.test", payload: { event: "webhook.test", createdAt: now.toISOString(), data: { message: "Hello from PlayCode" } }, nextAttemptAt: now });
    const result = await deliverDue(db, now);
    return { result };
  });

  app.post("/webhooks/:id/deliveries/:deliveryId/retry", async (req) => {
    const tenantId = tenantOf(req);
    const { id, deliveryId } = parse(z.object({ id: z.string().uuid(), deliveryId: z.string().uuid() }), req.params);
    const [hook] = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
    if (!hook) throw notFound("Webhook");
    await db.update(webhookDeliveries).set({ status: "pending", nextAttemptAt: app.now() }).where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, id)));
    return { result: await deliverDue(db, app.now()) };
  });
}
