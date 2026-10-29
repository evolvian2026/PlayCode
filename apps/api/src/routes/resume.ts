import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { addEntry, decideVerification, deleteEntry, myEntries, requestVerification, updateEntry, verificationQueue } from "../services/resume-entries";
import { getOwnProfile, renderResumePdf, resumeData, saveProfile, setPublic } from "../services/resume";

const url = z.string().trim().url().max(300).refine((v) => /^https:\/\//.test(v), "Use an https:// link").optional().or(z.literal("").transform(() => undefined));

/** A student's resume and public profile. */
export async function resumeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission("practice.play"));

  app.get("/student/resume", async (req) => ({ profile: await getOwnProfile(db, req.auth.userId), resume: await resumeData(db, req.auth.userId, app.now()) }));

  app.put("/student/resume", async (req) => {
    const body = parse(
      z.object({
        headline: z.string().trim().max(120).default(""),
        about: z.string().trim().max(800).default(""),
        links: z.object({ github: url, linkedin: url, portfolio: url }).default({}),
        hide: z.object({ readiness: z.boolean().optional(), interview: z.boolean().optional(), marks: z.boolean().optional() }).default({}),
      }),
      req.body,
    );
    return { profile: await saveProfile(db, { userId: req.auth.userId, tenantId: tenantOf(req), input: body, now: app.now() }) };
  });

  app.post("/student/resume/public", async (req) => {
    const body = parse(z.object({ public: z.boolean() }), req.body);
    return { profile: await setPublic(db, { userId: req.auth.userId, tenantId: tenantOf(req), public: body.public, now: app.now() }) };
  });

  app.get("/student/resume/pdf", async (req, reply) => {
    const data = await resumeData(db, req.auth.userId, app.now());
    const name = data.name.replace(/[^\w]+/g, "-").toLowerCase();
    return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${name}-resume.pdf"`).send(await renderResumePdf(data));
  });
}

const entryBody = z.object({
  kind: z.enum(["project", "internship"]),
  title: z.string().trim().min(2, "Give it a title").max(120),
  organisation: z.string().trim().max(120).default(""),
  startMonth: z.string(),
  endMonth: z.string().nullable().default(null),
  description: z.string().trim().max(800).default(""),
  link: z.string().trim().max(300).nullable().default(null).transform((v) => v || null),
});
const entryId = z.object({ id: z.string().uuid() });

/** Projects and internships: students add them; staff verify internships (under /console). */
export async function resumeEntryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const staff = requireAny("placements.manage", "assignments.manage");
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });

  app.get("/student/resume/entries", { preHandler: play }, async (req) => myEntries(db, req.auth.userId));
  app.post("/student/resume/entries", { preHandler: play }, async (req) => addEntry(db, ctx(req), parse(entryBody, req.body)));
  app.put("/student/resume/entries/:id", { preHandler: play }, async (req) => updateEntry(db, ctx(req), parse(entryId, req.params).id, parse(entryBody, req.body)));
  app.delete("/student/resume/entries/:id", { preHandler: play }, async (req) => deleteEntry(db, ctx(req), parse(entryId, req.params).id));
  app.post("/student/resume/entries/:id/verify", { preHandler: play }, async (req) => requestVerification(db, ctx(req), parse(entryId, req.params).id));

  app.get("/console/internships", { preHandler: staff }, async (req) =>
    verificationQueue(db, { ...req.auth, tenantId: tenantOf(req) }, parse(z.object({ status: z.enum(["requested", "verified", "rejected"]).default("requested") }), req.query).status),
  );
  app.post("/console/internships/:id/review", { preHandler: staff }, async (req) => {
    const decision = parse(z.object({ verify: z.boolean(), note: z.string().max(1000).nullable().default(null) }), req.body);
    return decideVerification(db, { ...req.auth, tenantId: tenantOf(req) }, parse(entryId, req.params).id, decision, app.now());
  });
}
