import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { env } from "../env";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { acsUrl, finishSaml, getSamlConnection, parseIdpMetadata, saveSamlConnection, spEntityId, spMetadata } from "../services/saml";
import { assertUnitsInScope } from "../services/scope";
import { getTenant } from "../services/tenant";

/** SAML 2.0: service-provider metadata, the assertion consumer service, and console settings. */
export async function samlRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  const slugParam = z.object({ slug: z.string().min(1).max(60) });

  app.get("/auth/saml/:slug/metadata", async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    return reply.header("content-type", "application/samlmetadata+xml").send(await spMetadata(db, slug));
  });

  app.post("/auth/saml/:slug/acs", async (req, reply) => {
    await rateLimit(`saml:${req.ip}`, 60, 60_000);
    const { slug } = parse(slugParam, req.params);
    const appUrl = env.PUBLIC_APP_URL.replace(/\/$/, "");
    try {
      const token = await finishSaml(db, slug, (req.body as Record<string, string>) ?? {}, app.now());
      return reply.redirect(`${appUrl}/sso#token=${encodeURIComponent(token)}`);
    } catch (err) {
      return reply.redirect(`${appUrl}/login?org=${encodeURIComponent(slug)}&sso_error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
    }
  });

  app.register(async (c) => {
    c.addHook("preHandler", authenticate);
    c.addHook("preHandler", requirePermission("tenant.settings"));

    c.get("/console/saml", async (req) => {
      const tenant = await getTenant(db, tenantOf(req));
      const conn = await getSamlConnection(db, tenant.id);
      return {
        connection: conn && { ...conn, tenantId: undefined },
        sp: { entityId: spEntityId(tenant.slug), acsUrl: acsUrl(tenant.slug), metadataUrl: `${spEntityId(tenant.slug)}/metadata` },
      };
    });

    c.post("/console/saml/metadata", async (req) => parseIdpMetadata(parse(z.object({ xml: z.string().min(1).max(200_000) }), req.body).xml));

    c.put("/console/saml", async (req) => {
      const body = parse(
        z.object({
          idpEntityId: z.string().min(1).max(500),
          ssoUrl: z.string().url().max(500),
          certificates: z.array(z.string().min(1).max(10_000)).min(1).max(4),
          emailAttribute: z.string().max(200).nullable(),
          emailDomains: z.array(z.string().regex(/^@?[a-z0-9.-]+\.[a-z]{2,}$/i, "Use domains like college.edu")).min(1).max(20),
          autoProvisionUnitId: z.string().uuid().nullable(),
          enabled: z.boolean(),
        }),
        req.body,
      );
      if (body.autoProvisionUnitId) await assertUnitsInScope(db, req.auth, [body.autoProvisionUnitId]);
      await saveSamlConnection(db, tenantOf(req), req.auth.userId, body);
      return { ok: true };
    });
  });
}
