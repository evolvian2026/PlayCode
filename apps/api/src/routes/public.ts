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
import { publicProfile } from "../services/resume";
import { getSamlConnection } from "../services/saml";
import { getConnection } from "../services/sso";
import { planHas } from "@playcode/core";

/** Unauthenticated routes: branded sign-in pages, logos and certificate verification. */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/public/branding/:slug", async (req) => {
    const { slug } = parse(z.object({ slug: z.string().max(60) }), req.params);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
    if (!tenant) throw notFound("Institution");
    const [saml, sso] = await Promise.all([getSamlConnection(db, tenant.id), getConnection(db, tenant.id)]);
    const samlOn = saml?.enabled && planHas(tenant.plan, "saml");
    const ssoOn = sso?.enabled && planHas(tenant.plan, "sso");
    return { ...(await effectiveBranding(db, tenant)), sso: samlOn ? { provider: "saml" } : ssoOn ? { provider: sso!.provider } : null };
  });

  app.get("/public/logo/:tenantId", async (req, reply) => {
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid() }), req.params);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const data = tenant?.branding.logoKey ? await getObject(tenant.branding.logoKey) : null;
    if (!tenant || !data) throw notFound("Logo");
    return reply.header("content-type", tenant.branding.logoType ?? "image/png").header("cache-control", "public, max-age=300").send(data);
  });

  // A student's public profile, if they published one.
  app.get("/public/profiles/:code", async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Za-z0-9]{10}$/) }), req.params);
    return publicProfile(db, code, app.now());
  });

  app.get("/public/certificates/:code", async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Za-z0-9]{10}$/) }), req.params);
    return verifyCertificate(db, code);
  });
}
