import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { authenticate, parse, requireAny, requirePermission, tenantOf } from "../lib/http";
import { requireFeature } from "../services/plan";
import { browseAlumni, createAlumnus, decideIntro, deleteAlumnus, introQueue, listAlumni, requestIntro, updateAlumnus, withdrawIntro } from "../services/alumni";
import { myReview, requestReview, resolveComment, reviewDetail, reviewQueue, submitReview, withdrawReview } from "../services/resume-review";

const idParam = z.object({ id: z.string().uuid() });
const sections = z.enum(["headline", "about", "education", "projects", "internships", "skills", "links", "overall"]);

/** Resume reviews and alumni connect. */
export async function resumeReviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  const play = requirePermission("practice.play");
  const reviewers = requireAny("placements.manage", "assignments.manage");
  const manage = [requirePermission("placements.manage"), requireFeature("placements")];
  const ctx = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId, now: app.now() });
  const staffAuth = (req: FastifyRequest) => ({ ...req.auth, tenantId: tenantOf(req) });
  const auth = (req: FastifyRequest) => ({ tenantId: tenantOf(req), userId: req.auth.userId });

  // ---------- Resume review ----------
  app.get("/student/resume/review", { preHandler: play }, async (req) => myReview(db, ctx(req)));
  app.post("/student/resume/review", { preHandler: play }, async (req) => requestReview(db, ctx(req), parse(z.object({ note: z.string().max(500).default("") }), req.body).note));
  app.post("/student/resume/review/withdraw", { preHandler: play }, async (req) => withdrawReview(db, ctx(req)));
  app.put("/student/resume/review/comments/:id", { preHandler: play }, async (req) => resolveComment(db, ctx(req), parse(idParam, req.params).id, parse(z.object({ resolved: z.boolean() }), req.body).resolved));

  app.get("/console/resume-reviews", { preHandler: reviewers }, async (req) => reviewQueue(db, staffAuth(req), parse(z.object({ status: z.enum(["waiting", "reviewed"]).default("waiting") }), req.query).status, app.now()));
  app.get("/console/resume-reviews/:id", { preHandler: reviewers }, async (req) => reviewDetail(db, staffAuth(req), parse(idParam, req.params).id, app.now()));
  app.post("/console/resume-reviews/:id", { preHandler: reviewers }, async (req) => {
    const input = parse(
      z.object({
        verdict: z.enum(["ready", "changes"]),
        summary: z.string().max(2000).default(""),
        comments: z.array(z.object({ section: sections, body: z.string().max(1000) })).max(30).default([]),
      }),
      req.body,
    );
    return submitReview(db, staffAuth(req), parse(idParam, req.params).id, input, app.now());
  });

  // ---------- Alumni ----------
  const alumnus = z.object({
    name: z.string().trim().min(2, "Enter their name").max(120),
    email: z.string().trim().email("Enter a valid email").max(200),
    graduationYear: z.number().int().min(1950).max(2100),
    department: z.string().max(120).default(""),
    company: z.string().trim().min(2, "Enter where they work").max(120),
    role: z.string().max(120).default(""),
    city: z.string().max(80).default(""),
    openToReferrals: z.boolean().default(false),
    openToAdvice: z.boolean().default(true),
    active: z.boolean().default(true),
  });
  app.get("/console/alumni", { preHandler: manage }, async (req) => listAlumni(db, tenantOf(req)));
  app.post("/console/alumni", { preHandler: manage }, async (req) => createAlumnus(db, auth(req), parse(alumnus, req.body), app.now()));
  app.put("/console/alumni/:id", { preHandler: manage }, async (req) => updateAlumnus(db, auth(req), parse(idParam, req.params).id, parse(alumnus, req.body)));
  app.delete("/console/alumni/:id", { preHandler: manage }, async (req) => deleteAlumnus(db, auth(req), parse(idParam, req.params).id));
  app.get("/console/alumni/intros", { preHandler: manage }, async (req) => introQueue(db, tenantOf(req), parse(z.object({ status: z.enum(["pending", "sent", "declined"]).default("pending") }), req.query).status));
  app.post("/console/alumni/intros/:id", { preHandler: manage }, async (req) => {
    const input = parse(z.object({ send: z.boolean(), note: z.string().max(1000).nullable().default(null) }), req.body);
    return decideIntro(db, auth(req), parse(idParam, req.params).id, input, app.now());
  });

  app.get("/student/alumni", { preHandler: [play, requireFeature("placements")] }, async (req) => browseAlumni(db, ctx(req)));
  app.post("/student/alumni/intros", { preHandler: [play, requireFeature("placements")] }, async (req) => {
    const input = parse(z.object({ alumnusId: z.string().uuid(), purpose: z.enum(["referral", "advice"]), message: z.string().trim().min(40, "Write a few lines: who you are and what you'd like to ask").max(1000) }), req.body);
    return requestIntro(db, ctx(req), input);
  });
  app.delete("/student/alumni/intros/:id", { preHandler: [play, requireFeature("placements")] }, async (req) => withdrawIntro(db, ctx(req), parse(idParam, req.params).id));
}
