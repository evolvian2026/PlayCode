import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { closeRequest, createRequest, listRequests, myDocuments, myFile, remindRequest, requestDetail, reviewSubmission, staffFile, upload } from "../services/documents";

const idParam = z.object({ id: z.string().uuid() });

function sendFile(reply: FastifyReply, file: { data: Buffer; contentType: string; fileName: string }, inline: boolean) {
  return reply
    .header("content-type", file.contentType)
    .header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${file.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    .header("cache-control", "private, no-store")
    .header("x-content-type-options", "nosniff")
    .send(file.data);
}

/** Document requests: staff ask a batch for files and check them (under /console). */
export async function documentConsoleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAny("placements.manage", "assignments.manage"));
  const auth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });

  app.get("/documents", async (req) => listRequests(db, auth(req), app.now()));
  app.post("/documents", async (req) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(3, "Say what to upload").max(140),
        instructions: z.string().trim().max(2000).default(""),
        unitIds: z.array(z.string().uuid()).max(50).default([]),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day"),
      }),
      req.body,
    );
    return createRequest(db, auth(req), input, app.now());
  });
  app.get("/documents/:id", async (req) => requestDetail(db, auth(req), parse(idParam, req.params).id));
  app.get("/documents/:id/files/:userId", async (req, reply) => {
    const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
    const { download } = parse(z.object({ download: z.coerce.boolean().default(false) }), req.query);
    return sendFile(reply, await staffFile(db, auth(req), id, userId), !download);
  });
  app.post("/documents/:id/review", async (req) => {
    const body = parse(z.object({ userId: z.string().uuid(), verify: z.boolean(), note: z.string().max(1000).nullable().default(null) }), req.body);
    return reviewSubmission(db, auth(req), parse(idParam, req.params).id, body.userId, { verify: body.verify, note: body.note }, app.now());
  });
  app.post("/documents/:id/remind", async (req) => remindRequest(db, auth(req), parse(idParam, req.params).id, app.now()));
  app.post("/documents/:id/close", async (req) => closeRequest(db, auth(req), parse(idParam, req.params).id, app.now()));
}

export async function documentStudentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  app.get("/student/documents", async (req) => myDocuments(db, ctx(req)));
  // A 5 MB file is about 6.7 MB as base64.
  app.put("/student/documents/:id", { bodyLimit: 7 * 1024 * 1024 + 64 * 1024 }, async (req) => {
    const input = parse(z.object({ fileName: z.string().min(1).max(200), data: z.string().min(1) }), req.body);
    return upload(db, ctx(req), parse(idParam, req.params).id, input);
  });
  app.get("/student/documents/:id/file", async (req, reply) => sendFile(reply, await myFile(db, ctx(req), parse(idParam, req.params).id), true));
}
