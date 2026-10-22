import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { tenants } from "../db/schema";
import { notFound } from "../lib/errors";
import { parse } from "../lib/http";
import { getObject } from "../lib/storage";
import { effectiveBranding } from "../services/branding";
import { verifyCertificate } from "../services/certificates";
import { getConnection } from "../services/sso";

/** Unauthenticated routes: branded sign-in pages, logos and certificate verification. */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/public/branding/:slug", async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(60) }), req.params);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
    if (!tenant) throw notFound("Institution");
    const sso = await getConnection(db, tenant.id);
    return { ...(await effectiveBranding(db, tenant)), sso: sso?.enabled ? { provider: sso.provider } : null };
  });

  app.get("/public/logo/:tenantId", async (req, reply) => {
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid() }), req.params);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const data = tenant?.branding.logoKey ? await getObject(tenant.branding.logoKey) : null;
    if (!tenant || !data) throw notFound("Logo");
    return reply.header("content-type", tenant.branding.logoType ?? "image/png").header("cache-control", "public, max-age=300").send(data);
  });

  app.get("/public/certificates/:code", async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Za-z0-9]{10}$/) }), req.params);
    return verifyCertificate(db, code);
  });
}
