import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { env } from "../env";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { bindLink, deletePlatform, finishLaunch, linkDetail, listLinks, listPlatforms, publicJwks, savePlatform, startLaunch, toolUrls } from "../services/lti";
import { assertUnitsInScope } from "../services/scope";

const platformInput = z.object({
  name: z.string().min(1).max(80),
  issuer: z.string().url().max(300),
  clientId: z.string().min(1).max(300),
  deploymentIds: z.array(z.string().max(300)).max(20).default([]),
  authLoginUrl: z.string().url().max(500),
  authTokenUrl: z.string().url().max(500),
  jwksUrl: z.string().url().max(500),
  autoProvisionUnitId: z.string().uuid().nullable(),
  enabled: z.boolean().default(true),
});

/** LTI 1.3 tool endpoints (called by the LMS and the browser) and their console settings. */
export async function ltiRoutes(app: FastifyInstance) {
  // The LMS posts forms (login initiation and the launch itself).
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  const appUrl = () => env.PUBLIC_APP_URL.replace(/\/$/, "");

  const login = async (req: { query: unknown; body: unknown; ip: string }, reply: { redirect: (url: string) => unknown }) => {
    rateLimit(`lti-login:${req.ip}`, 120, 60_000);
    const params = { ...(req.query as Record<string, string>), ...((req.body as Record<string, string>) ?? {}) };
    return reply.redirect(await startLaunch(db, params, app.now()));
  };
  app.get("/lti/login", login);
  app.post("/lti/login", login);

  app.post("/lti/launch", async (req, reply) => {
    rateLimit(`lti-launch:${req.ip}`, 120, 60_000);
    try {
      const { token, next } = await finishLaunch(db, (req.body as Record<string, string>) ?? {}, app.now());
      // Same hand-off as single sign-on: the token travels in the fragment, never to a server.
      return reply.redirect(`${appUrl()}/sso#token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`);
    } catch (err) {
      return reply.redirect(`${appUrl()}/login?sso_error=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
    }
  });

  app.get("/lti/jwks", async () => publicJwks(db));

  app.register(async (c) => {
    c.addHook("preHandler", authenticate);

    c.get("/console/lti", { preHandler: requirePermission("tenant.settings") }, async (req) => ({
      tool: toolUrls(),
      platforms: (await listPlatforms(db, tenantOf(req))).map((p) => ({ ...p, tenantId: undefined })),
    }));
    c.post("/console/lti/platforms", { preHandler: requirePermission("tenant.settings") }, async (req) => {
      const body = parse(platformInput, req.body);
      if (body.autoProvisionUnitId) await assertUnitsInScope(db, req.auth, [body.autoProvisionUnitId]);
      return { platform: await savePlatform(db, tenantOf(req), req.auth.userId, body) };
    });
    c.put("/console/lti/platforms/:id", { preHandler: requirePermission("tenant.settings") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const body = parse(platformInput, req.body);
      if (body.autoProvisionUnitId) await assertUnitsInScope(db, req.auth, [body.autoProvisionUnitId]);
      return { platform: await savePlatform(db, tenantOf(req), req.auth.userId, body, id) };
    });
    c.delete("/console/lti/platforms/:id", { preHandler: requirePermission("tenant.settings") }, async (req) => {
      await deletePlatform(db, tenantOf(req), req.auth.userId, parse(z.object({ id: z.string().uuid() }), req.params).id);
      return { ok: true };
    });

    c.get("/console/lti/links", { preHandler: requirePermission("assignments.manage") }, async (req) => ({ links: await listLinks(db, tenantOf(req)) }));
    c.get("/console/lti/links/:id", { preHandler: requirePermission("assignments.manage") }, async (req) => ({
      link: await linkDetail(db, tenantOf(req), parse(z.object({ id: z.string().uuid() }), req.params).id),
    }));
    c.post("/console/lti/links/:id", { preHandler: requirePermission("assignments.manage") }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const { assignmentId } = parse(z.object({ assignmentId: z.string().uuid() }), req.body);
      return { link: await bindLink(db, tenantOf(req), req.auth.userId, id, assignmentId) };
    });
  });
}
