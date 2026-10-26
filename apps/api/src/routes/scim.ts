import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { scimConnections } from "../db/schema";
import { env } from "../env";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { HttpError, notFound } from "../lib/errors";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
import { rateLimit } from "../lib/rate-limit";
import { assertWritable } from "../services/licence";
import { hasFeature, requireFeature } from "../services/plan";
import {
  createGroup,
  createUser,
  deleteGroup,
  deleteUser,
  getGroup,
  getUser,
  listGroups,
  listUsers,
  patchGroup,
  patchUser,
  replaceGroup,
  replaceUser,
  resourceTypes,
  SCIM,
  ScimError,
  scimConnectionFor,
  serviceProviderConfig,
  type ScimContext,
} from "../services/scim";
import { tenantUnits } from "../services/scope";

const BASE = "/scim/v2";
const baseUrl = () => `${env.API_PUBLIC_URL.replace(/\/$/, "")}${BASE}`;

declare module "fastify" {
  interface FastifyRequest {
    scim: ScimContext;
  }
}

/** SCIM 2.0 endpoints for identity providers, authenticated by the connection's bearer token. */
export async function scimRoutes(app: FastifyInstance) {
  await app.register(
    async (scim) => {
      scim.addContentTypeParser(["application/scim+json", "application/json"], { parseAs: "string" }, (_req, body, done) => {
        try {
          done(null, String(body).trim() ? JSON.parse(String(body)) : {});
        } catch {
          done(new ScimError(400, "The request body is not valid JSON", "invalidSyntax"), undefined);
        }
      });

      scim.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
        const status = err instanceof HttpError ? err.statusCode : err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
        if (status >= 500) req.log.error(err);
        return reply
          .status(status)
          .type("application/scim+json")
          .send({
            schemas: [SCIM.error],
            status: String(status),
            scimType: err instanceof ScimError ? err.scimType : undefined,
            detail: status >= 500 ? `Something went wrong. Reference ${req.id}.` : err.message,
          });
      });
      scim.setNotFoundHandler((_req, reply) => reply.status(404).type("application/scim+json").send({ schemas: [SCIM.error], status: "404", detail: "No such SCIM endpoint" }));

      scim.addHook("preHandler", async (req) => {
        const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? "";
        const now = app.now();
        const conn = await scimConnectionFor(db, token.trim(), now);
        if (!conn) throw new ScimError(401, "Send the bearer token from PlayCode's console (Settings → Directory sync)");
        if (!(await hasFeature(db, conn.tenantId, "scim"))) throw new ScimError(403, "Directory sync (SCIM) is not included in this institution's plan");
        await rateLimit(`scim:${conn.tenantId}`, 1200, 60_000, now, "Too many SCIM requests");
        // An expired licence still lets the directory switch accounts off; it can't add new ones.
        if (req.method === "POST") await assertWritable(db, { tenantId: conn.tenantId, method: req.method, url: req.url, superAdmin: false, now });
        req.scim = { db, tenantId: conn.tenantId, defaultUnitId: conn.defaultUnitId, now, baseUrl: baseUrl() };
      });

      scim.addHook("onSend", async (_req, reply, payload) => {
        if (String(reply.getHeader("content-type") ?? "").startsWith("application/json")) reply.type("application/scim+json; charset=utf-8");
        return payload;
      });

      const id = (req: FastifyRequest) => (req.params as { id: string }).id;
      const created = (reply: FastifyReply, body: { meta: { location: string } }) => reply.status(201).header("location", body.meta.location).send(body);

      scim.get("/ServiceProviderConfig", async () => serviceProviderConfig(baseUrl()));
      scim.get("/ResourceTypes", async () => resourceTypes(baseUrl()));
      scim.get("/Schemas", async () => ({ schemas: [SCIM.list], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] }));

      scim.get("/Users", async (req) => listUsers(req.scim, req.query));
      scim.post("/Users", async (req, reply) => created(reply, await createUser(req.scim, req.body)));
      scim.get("/Users/:id", async (req) => getUser(req.scim, id(req)));
      scim.put("/Users/:id", async (req) => replaceUser(req.scim, id(req), req.body));
      scim.patch("/Users/:id", async (req) => patchUser(req.scim, id(req), req.body));
      scim.delete("/Users/:id", async (req, reply) => {
        await deleteUser(req.scim, id(req));
        return reply.status(204).send();
      });

      scim.get("/Groups", async (req) => listGroups(req.scim, req.query));
      scim.post("/Groups", async (req, reply) => created(reply, await createGroup(req.scim, req.body)));
      scim.get("/Groups/:id", async (req) => getGroup(req.scim, id(req), req.query));
      scim.put("/Groups/:id", async (req) => replaceGroup(req.scim, id(req), req.body));
      scim.patch("/Groups/:id", async (req) => patchGroup(req.scim, id(req), req.body));
      scim.delete("/Groups/:id", async (req, reply) => {
        await deleteGroup(req.scim, id(req));
        return reply.status(204).send();
      });
    },
    { prefix: BASE },
  );
}

/** Console: connect the identity provider (token, default batch). */
export async function scimConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("tenant.settings"));
  app.addHook("preHandler", requireFeature("scim"));

  app.get("/scim", async (req) => {
    const [c] = await db.select().from(scimConnections).where(eq(scimConnections.tenantId, tenantOf(req)));
    return {
      baseUrl: baseUrl(),
      connection: c ? { defaultUnitId: c.defaultUnitId, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt } : null,
    };
  });

  const unitBody = z.object({ defaultUnitId: z.string().uuid().nullable().optional() });
  const assertUnit = async (tenantId: string, unitId: string | null | undefined) => {
    if (unitId && !(await tenantUnits(db, tenantId)).some((u) => u.id === unitId)) throw notFound("Org unit");
  };

  /** Create or rotate the token. It is shown once; the old one stops working at once. */
  app.post("/scim/token", async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(unitBody, req.body ?? {});
    await assertUnit(tenantId, body.defaultUnitId);
    const token = `scim_${randomToken(32)}`;
    const values = { tenantId, tokenHash: sha256(token), createdBy: req.auth.userId, createdAt: app.now(), lastUsedAt: null };
    const [existing] = await db.select({ tenantId: scimConnections.tenantId }).from(scimConnections).where(eq(scimConnections.tenantId, tenantId));
    await db
      .insert(scimConnections)
      .values({ ...values, defaultUnitId: body.defaultUnitId ?? null })
      .onConflictDoUpdate({ target: scimConnections.tenantId, set: { ...values, ...(body.defaultUnitId !== undefined ? { defaultUnitId: body.defaultUnitId } : {}) } });
    await audit(db, { tenantId, actorId: req.auth.userId, action: existing ? "scim.token.rotate" : "scim.connect" });
    return { token, baseUrl: baseUrl() };
  });

  app.put("/scim", async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(unitBody.required(), req.body);
    await assertUnit(tenantId, body.defaultUnitId);
    const [row] = await db.update(scimConnections).set({ defaultUnitId: body.defaultUnitId }).where(eq(scimConnections.tenantId, tenantId)).returning();
    if (!row) throw notFound("Directory sync connection");
    await audit(db, { tenantId, actorId: req.auth.userId, action: "scim.settings", data: { defaultUnitId: body.defaultUnitId } });
    return { ok: true };
  });

  app.delete("/scim", async (req) => {
    const tenantId = tenantOf(req);
    const [row] = await db.delete(scimConnections).where(eq(scimConnections.tenantId, tenantId)).returning();
    if (!row) throw notFound("Directory sync connection");
    await audit(db, { tenantId, actorId: req.auth.userId, action: "scim.disconnect" });
    return { ok: true };
  });
}
