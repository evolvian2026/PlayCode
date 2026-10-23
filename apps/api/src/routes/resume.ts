import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requirePermission, tenantOf } from "../lib/http";
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
